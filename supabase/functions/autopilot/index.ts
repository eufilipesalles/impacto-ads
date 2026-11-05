// Impacto Ads — piloto automático (fase 1)
//
// Ações aceitas (POST, corpo JSON):
//   { action: "evaluate", protective_only?: bool, client_id?: uuid }  → analisa e cria/executa ações
//   { action: "decide", id, decision: "approve" | "reject" }          → aprovação humana (executa na hora)
//   { action: "undo", id }                                             → desfaz uma ação executada
//   { action: "pause_all", paused: bool }                              → botão geral "parar tudo"
//   { action: "create_ad", client_id, ad_account_id, adset_id, template_ad_id, asset_id, name?, activate? }
//   { action: "check" }                                                → permissões do token no Meta
//
// Chamadas: pg_cron (header x-cron-secret) ou usuário da equipe logado (Authorization: Bearer <jwt>).
//
// Regras (todas comparam com a meta de custo do cliente ou, sem meta, com a média dos últimos 14 dias):
//   pause_no_result  — anúncio gastou 2x a meta em 7 dias sem nenhum resultado            (protege a verba)
//   pause_expensive  — anúncio com custo 2,5x a meta e outro anúncio do conjunto indo bem  (protege a verba)
//   scale_down       — campanha com custo 1,6x a meta em 7 dias e ruim também em 3 dias    (protege a verba)
//   monthly_cap      — ritmo de gasto vai estourar o teto do mês                           (protege a verba)
//   scale_up         — campanha 20% mais barata que a meta, estável e limitada pelo orçamento (aumenta gasto)
// Travas: nunca pausa o último anúncio ativo de um conjunto; uma mudança de orçamento por campanha a cada 3 dias;
// aumento máximo configurável (padrão 20%); orçamento mínimo de R$ 10/dia; teto mensal respeitado.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";

const API_VERSION = Deno.env.get("META_API_VERSION") ?? "v25.0";
const GRAPH = `https://graph.facebook.com/${API_VERSION}`;
const clean = (v: string | undefined) => (v ?? "").trim().replace(/^["']|["']$/g, "");
const RAW_TOKEN = clean(Deno.env.get("META_ACCESS_TOKEN"));
const RAW_SECRET = clean(Deno.env.get("META_APP_SECRET"));
const SWAPPED = !RAW_TOKEN.startsWith("EAA") && RAW_SECRET.startsWith("EAA");
const TOKEN = SWAPPED ? RAW_SECRET : RAW_TOKEN;
const APP_SECRET = SWAPPED ? RAW_TOKEN : RAW_SECRET;

const MIN_DAILY_BUDGET = 10;      // R$/dia: nunca reduz abaixo disso
const BUDGET_COOLDOWN_DAYS = 3;   // uma mudança de orçamento por campanha a cada 3 dias (fase de aprendizado)
const PROPOSAL_TTL_HOURS = 36;    // proposta não decidida expira (os números já mudaram)

type Json = Record<string, unknown>;
type Kind = "purchase" | "conversation" | "lead" | "click";

// ---------------- Graph API ----------------
let proof = "";
async function appSecretProof() {
  if (!APP_SECRET) return "";
  if (proof) return proof;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(APP_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(TOKEN));
  proof = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return proof;
}

async function graph(path: string, params: Record<string, string> = {}, method: "GET" | "POST" = "GET"): Promise<Json> {
  const url = new URL(`${GRAPH}/${path}`);
  const body = new URLSearchParams(params);
  body.set("access_token", TOKEN);
  const p = await appSecretProof();
  if (p) body.set("appsecret_proof", p);
  for (let attempt = 0; ; attempt++) {
    const res = method === "GET"
      ? await fetch(`${url}?${body}`)
      : await fetch(url, { method: "POST", body });
    const json = await res.json().catch(() => ({}));
    if (res.ok) return json as Json;
    const err = (json as { error?: { message?: string; error_user_msg?: string; code?: number; is_transient?: boolean } }).error ?? {};
    const retryable = err.is_transient || [1, 2, 4, 17, 32, 613].includes(err.code ?? 0);
    if (retryable && attempt < 3) { await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt)); continue; }
    throw new Error(`Meta (${err.code ?? res.status}): ${err.error_user_msg ?? err.message ?? res.statusText}`);
  }
}

// ---------------- helpers ----------------
const num = (v: unknown) => (v === undefined || v === null || v === "" ? 0 : Number(v));
const ymd = (d: Date) => d.toISOString().slice(0, 10);
function brDate(offsetDays: number) {
  const d = new Date(Date.now() - 3 * 3600_000);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return ymd(d);
}
const money = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const nowIso = () => new Date().toISOString();

const EXPLICIT: Record<string, Kind | null> = {
  vendas: "purchase", conversas_whatsapp: "conversation", leads: "lead", trafego: "click", reconhecimento: null,
};
const KIND_TEXT: Record<Kind, { one: string; many: string; cost: string }> = {
  purchase: { one: "venda", many: "vendas", cost: "custo por venda" },
  conversation: { one: "conversa", many: "conversas", cost: "custo por conversa" },
  lead: { one: "lead", many: "leads", cost: "custo por lead" },
  click: { one: "clique", many: "cliques", cost: "custo por clique" },
};
const resultOf = (r: Json, k: Kind) =>
  k === "purchase" ? num(r.purchases) : k === "conversation" ? num(r.conversations) : k === "lead" ? num(r.leads) : num(r.link_clicks);

type Stat = { spend: number; res: number; days: number };
const empty = (): Stat => ({ spend: 0, res: 0, days: 0 });

async function selectAll<T>(build: (from: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

// ---------------- análise ----------------
interface Proposal {
  client_id: string; ad_account_id: string; rule: string; kind: string; protective: boolean;
  object_type: string; object_id: string; object_name: string | null; campaign_name: string | null;
  title: string; reason: string; evidence: Json; params: Json;
}

async function evaluate(sb: SupabaseClient, opts: { protectiveOnly: boolean; clientId?: string }) {
  const ref = brDate(-1);                       // ontem: último dia completo
  const d14 = brDate(-14), d7 = brDate(-7), d3 = brDate(-3);
  const monthStart = `${brDate(0).slice(0, 7)}-01`;
  const today = brDate(0);
  const [y, m] = today.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const remainingDays = daysInMonth - Number(today.slice(8)) + 1;

  // Expira propostas antigas
  await sb.from("autopilot_actions").update({ status: "expired", decided_at: nowIso() })
    .eq("status", "proposed").lt("created_at", new Date(Date.now() - PROPOSAL_TTL_HOURS * 3600_000).toISOString());

  let cq = sb.from("clients").select("id, name, objective, monthly_budget, ad_accounts(id, account_status)").eq("active", true);
  if (opts.clientId) cq = cq.eq("id", opts.clientId);
  const { data: clients, error: cErr } = await cq;
  if (cErr) throw new Error(cErr.message);
  const { data: settingsRows } = await sb.from("autopilot_settings").select("*");
  const settings = new Map((settingsRows ?? []).map((s) => [s.client_id as string, s]));
  const { data: global } = await sb.from("autopilot_global").select("paused").eq("id", 1).single();
  const paused = !!global?.paused;

  const proposals: Proposal[] = [];
  const skipped: Json[] = [];

  for (const c of clients ?? []) {
    const accIds = ((c.ad_accounts as { id: string; account_status: number | null }[]) ?? []).filter((a) => a.account_status === 1).map((a) => a.id);
    if (!accIds.length) continue;
    const st = settings.get(c.id);

    const [campaigns, adsets, ads, rows] = await Promise.all([
      selectAll<Json>((f) => sb.from("campaigns").select("id, ad_account_id, name, objective, effective_status, daily_budget").in("ad_account_id", accIds).range(f, f + 999)),
      selectAll<Json>((f) => sb.from("adsets").select("id, campaign_id, name, effective_status, daily_budget").in("ad_account_id", accIds).range(f, f + 999)),
      selectAll<Json>((f) => sb.from("ads").select("id, ad_account_id, campaign_id, adset_id, name, effective_status").in("ad_account_id", accIds).range(f, f + 999)),
      selectAll<Json>((f) => sb.from("insights_daily")
        .select("level, object_id, ad_account_id, campaign_id, date, spend, conversations, leads, purchases, purchase_value, link_clicks")
        .in("ad_account_id", accIds).gte("date", monthStart < d14 ? monthStart : d14).lte("date", today)
        .order("date").order("object_id").range(f, f + 999)),
    ]);
    const campById = new Map(campaigns.map((x) => [x.id as string, x]));

    // Resultado do cliente: objetivo definido em Configurações, ou o que as campanhas mais geram
    let clientKind: Kind | null | undefined = EXPLICIT[c.objective as string];
    if (clientKind === undefined) {
      const t = { conversation: 0, lead: 0, purchase: 0 };
      for (const r of rows) if (r.level === "account" && (r.date as string) >= d14 && (r.date as string) <= ref) {
        t.conversation += num(r.conversations); t.lead += num(r.leads); if (num(r.purchase_value) > 0) t.purchase += num(r.purchases);
      }
      const best = (Object.entries(t) as [Kind, number][]).sort((a, b) => b[1] - a[1])[0];
      clientKind = best[1] > 0 ? best[0] : null;
    }
    const kindOfCampaign = (id: string): Kind | null => {
      const o = String(campById.get(id)?.objective ?? "");
      if (["OUTCOME_TRAFFIC", "LINK_CLICKS"].includes(o)) return "click";
      if (["OUTCOME_AWARENESS", "REACH", "BRAND_AWARENESS", "VIDEO_VIEWS"].includes(o)) return null;
      return clientKind ?? null;
    };

    // Agregados
    const add = (map: Map<string, { s14: Stat; s7: Stat; s3: Stat }>, id: string, r: Json, k: Kind) => {
      const e = map.get(id) ?? { s14: empty(), s7: empty(), s3: empty() };
      const d = r.date as string, sp = num(r.spend), rs = resultOf(r, k);
      for (const [from, s] of [[d14, e.s14], [d7, e.s7], [d3, e.s3]] as [string, Stat][]) {
        if (d >= from && d <= ref) { s.spend += sp; s.res += rs; if (sp > 0) s.days++; }
      }
      map.set(id, e);
    };
    const campStats = new Map<string, { s14: Stat; s7: Stat; s3: Stat }>();
    const adStats = new Map<string, { s14: Stat; s7: Stat; s3: Stat }>();
    let monthSpend = 0;
    for (const r of rows) {
      if (r.level === "account" && (r.date as string) >= monthStart) monthSpend += num(r.spend);
      const k = kindOfCampaign(r.campaign_id as string ?? (r.level === "campaign" ? r.object_id as string : ""));
      if (!k) continue;
      if (r.level === "campaign") add(campStats, r.object_id as string, r, k);
      if (r.level === "ad") add(adStats, r.object_id as string, r, k);
    }

    // Meta de custo por tipo de resultado: a do cliente (Configurações) ou a média dos últimos 14 dias
    const targetFor = new Map<Kind, { value: number; source: string }>();
    for (const k of ["purchase", "conversation", "lead", "click"] as Kind[]) {
      if (st?.target_cost && k === clientKind) { targetFor.set(k, { value: Number(st.target_cost), source: "meta definida" }); continue; }
      let sp = 0, rs = 0;
      for (const [id, s] of campStats) if (kindOfCampaign(id) === k) { sp += s.s14.spend; rs += s.s14.res; }
      if (rs >= 5) targetFor.set(k, { value: sp / rs, source: "média do cliente em 14 dias" });
    }

    const base = (o: Omit<Proposal, "client_id" | "ad_account_id"> & { ad_account_id: string }) => proposals.push({ client_id: c.id, ...o });
    const ev = (s: Stat, k: Kind) => ({ gasto: Math.round(s.spend * 100) / 100, resultados: s.res, custo: s.res ? Math.round((s.spend / s.res) * 100) / 100 : null, dias: s.days, tipo: k });

    // ---- anúncios ----
    const activeAds = ads.filter((a) => a.effective_status === "ACTIVE");
    const pausingInAdset = new Map<string, number>();
    const remainingActive = (adsetId: string, except: string) =>
      activeAds.filter((a) => a.adset_id === adsetId && a.id !== except && (adStats.get(a.id as string)?.s7.spend ?? 0) > 0).length
      - (pausingInAdset.get(adsetId) ?? 0);

    for (const a of activeAds.sort((x, y) => (adStats.get(y.id as string)?.s7.spend ?? 0) - (adStats.get(x.id as string)?.s7.spend ?? 0))) {
      const k = kindOfCampaign(a.campaign_id as string);
      const t = k ? targetFor.get(k) : undefined;
      const s = adStats.get(a.id as string);
      if (!k || !t || !s) continue;
      const camp = campById.get(a.campaign_id as string);
      const common = { ad_account_id: a.ad_account_id as string, kind: "pause", protective: true, object_type: "ad", object_id: a.id as string,
        object_name: a.name as string, campaign_name: (camp?.name as string) ?? null, params: { status: "PAUSED" } };
      const K = KIND_TEXT[k];

      if (s.s7.res === 0 && s.s7.spend >= 2 * t.value && s.s7.days >= 3) {
        if (remainingActive(a.adset_id as string, a.id as string) < 1) { skipped.push({ ad: a.id, why: "último anúncio ativo do conjunto" }); continue; }
        pausingInAdset.set(a.adset_id as string, (pausingInAdset.get(a.adset_id as string) ?? 0) + 1);
        base({ ...common, rule: "pause_no_result",
          title: `Pausar anúncio "${a.name}"`,
          reason: `Gastou ${money(s.s7.spend)} em 7 dias sem nenhuma ${K.one} — o dobro da meta de ${money(t.value)} por ${K.one} (${t.source}). Outros anúncios do conjunto seguem rodando.`,
          evidence: { ...ev(s.s7, k), meta: Math.round(t.value * 100) / 100 } });
        continue;
      }
      if (s.s7.res > 0 && s.s7.spend >= 3 * t.value && s.s7.spend / s.s7.res >= 2.5 * t.value) {
        const better = activeAds.some((o) => o.adset_id === a.adset_id && o.id !== a.id && (() => {
          const os = adStats.get(o.id as string); return !!os && os.s7.res > 0 && os.s7.spend / os.s7.res <= 1.2 * t.value;
        })());
        if (!better || remainingActive(a.adset_id as string, a.id as string) < 1) continue;
        pausingInAdset.set(a.adset_id as string, (pausingInAdset.get(a.adset_id as string) ?? 0) + 1);
        base({ ...common, rule: "pause_expensive",
          title: `Pausar anúncio "${a.name}"`,
          reason: `${K.cost[0].toUpperCase()}${K.cost.slice(1)} de ${money(s.s7.spend / s.s7.res)} em 7 dias, 2,5x acima da meta de ${money(t.value)} (${t.source}). Há anúncio no mesmo conjunto entregando dentro da meta, que recebe a verba.`,
          evidence: { ...ev(s.s7, k), meta: Math.round(t.value * 100) / 100 } });
      }
    }

    // ---- orçamento das campanhas ----
    const since3 = new Date(Date.now() - BUDGET_COOLDOWN_DAYS * 86400_000).toISOString();
    const { data: recent } = await sb.from("autopilot_actions").select("object_id")
      .eq("client_id", c.id).eq("kind", "set_budget").in("status", ["done", "executing", "approved"]).gte("executed_at", since3);
    const cooled = new Set((recent ?? []).map((r) => r.object_id as string));

    const holders = (campId: string) => {
      const cp = campById.get(campId)!;
      if (num(cp.daily_budget) > 0) return [{ type: "campaign", id: campId, name: cp.name as string, budget: num(cp.daily_budget) }];
      return adsets.filter((s) => s.campaign_id === campId && s.effective_status === "ACTIVE" && num(s.daily_budget) > 0)
        .map((s) => ({ type: "adset", id: s.id as string, name: s.name as string, budget: num(s.daily_budget) }));
    };
    const activeCamps = campaigns.filter((cp) => cp.effective_status === "ACTIVE");
    const dailyTotal = activeCamps.reduce((t, cp) => t + holders(cp.id as string).reduce((x, h) => x + h.budget, 0), 0);
    const cap = st?.monthly_cap ? Number(st.monthly_cap) : c.monthly_budget ? Number(c.monthly_budget) : null;
    const maxUp = (st?.max_increase_pct ?? 20) / 100;

    // Teto do mês: o ritmo atual estoura?
    let capHandled = false;
    if (cap && dailyTotal > 0) {
      const projected = monthSpend + dailyTotal * remainingDays;
      if (projected > cap * 1.05) {
        const factor = Math.max(0.3, Math.min(0.95, (cap - monthSpend) / (dailyTotal * remainingDays)));
        for (const cp of activeCamps) {
          const hs = holders(cp.id as string);
          if (!hs.length || cooled.has(cp.id as string)) continue;
          base({ ad_account_id: cp.ad_account_id as string, rule: "monthly_cap", kind: "set_budget", protective: true,
            object_type: "campaign", object_id: cp.id as string, object_name: cp.name as string, campaign_name: cp.name as string,
            title: `Reduzir orçamento de "${cp.name}" em ${Math.round((1 - factor) * 100)}%`,
            reason: `No ritmo atual o mês fecha em ${money(projected)}, acima do teto de ${money(cap)} (já gasto: ${money(monthSpend)}, faltam ${remainingDays} dias).`,
            evidence: { gasto_mes: Math.round(monthSpend * 100) / 100, projecao: Math.round(projected), teto: cap, orcamento_diario_total: dailyTotal, fator: factor },
            params: { factor, targets: hs.map((h) => ({ type: h.type, id: h.id, name: h.name })) } });
        }
        capHandled = true;
      }
    }

    for (const cp of activeCamps) {
      if (capHandled) break;
      const k = kindOfCampaign(cp.id as string);
      const t = k ? targetFor.get(k) : undefined;
      const s = campStats.get(cp.id as string);
      const hs = holders(cp.id as string);
      if (!k || !t || !s || !hs.length || cooled.has(cp.id as string)) continue;
      const budget = hs.reduce((x, h) => x + h.budget, 0);
      const K = KIND_TEXT[k];
      const cpr7 = s.s7.res ? s.s7.spend / s.s7.res : Infinity, cpr3 = s.s3.res ? s.s3.spend / s.s3.res : Infinity;
      const common = { ad_account_id: cp.ad_account_id as string, kind: "set_budget", object_type: "campaign", object_id: cp.id as string,
        object_name: cp.name as string, campaign_name: cp.name as string };

      // Reduzir: caro na semana e continua caro nos últimos 3 dias
      const bad7 = s.s7.spend >= 3 * t.value && cpr7 >= 1.6 * t.value;
      const bad3 = s.s3.res === 0 ? s.s3.spend >= t.value : cpr3 >= 1.4 * t.value;
      if (bad7 && bad3) {
        const targets = hs.filter((h) => h.budget * 0.8 >= MIN_DAILY_BUDGET);
        if (targets.length) base({ ...common, rule: "scale_down", protective: true,
          title: `Reduzir orçamento de "${cp.name}" em 20%`,
          reason: `${K.cost[0].toUpperCase()}${K.cost.slice(1)} de ${s.s7.res ? money(cpr7) : "— (nenhuma " + K.one + ")"} em 7 dias, acima de 1,6x a meta de ${money(t.value)} (${t.source}), e sem melhora nos últimos 3 dias.`,
          evidence: { semana: ev(s.s7, k), ultimos_3_dias: ev(s.s3, k), meta: Math.round(t.value * 100) / 100, orcamento_diario: budget },
          params: { factor: 0.8, targets: targets.map((h) => ({ type: h.type, id: h.id, name: h.name })) } });
        continue;
      }

      // Aumentar: barato, estável e gastando quase todo o orçamento
      if (opts.protectiveOnly) continue;
      const good = s.s7.res >= 5 && cpr7 <= 0.8 * t.value && s.s3.res >= 2 && cpr3 <= 0.9 * t.value;
      const limited = s.s3.spend / 3 >= 0.85 * budget;
      if (good && limited) {
        const increase = budget * maxUp;
        if (cap && monthSpend + (dailyTotal + increase) * remainingDays > cap) {
          skipped.push({ campaign: cp.id, why: "aumento estouraria o teto do mês" });
          continue;
        }
        base({ ...common, rule: "scale_up", protective: false,
          title: `Aumentar orçamento de "${cp.name}" em ${Math.round(maxUp * 100)}%`,
          reason: `${K.cost[0].toUpperCase()}${K.cost.slice(1)} de ${money(cpr7)} em 7 dias e ${money(cpr3)} nos últimos 3, abaixo da meta de ${money(t.value)} (${t.source}). A campanha usa ${Math.round((s.s3.spend / 3 / budget) * 100)}% do orçamento: tem espaço para crescer.`,
          evidence: { semana: ev(s.s7, k), ultimos_3_dias: ev(s.s3, k), meta: Math.round(t.value * 100) / 100, orcamento_diario: budget, novo_orcamento: Math.round(budget * (1 + maxUp) * 100) / 100 },
          params: { factor: 1 + maxUp, targets: hs.map((h) => ({ type: h.type, id: h.id, name: h.name })) } });
      }
    }
  }

  // Grava sem repetir: mesma regra no mesmo objeto já pendente, ou já executada nos últimos 3 dias
  const created: Json[] = [];
  for (const p of proposals) {
    const { data: dup } = await sb.from("autopilot_actions").select("id")
      .eq("object_id", p.object_id).eq("rule", p.rule)
      .or(`status.in.(proposed,approved,executing),and(status.eq.done,executed_at.gte."${new Date(Date.now() - 3 * 86400_000).toISOString()}")`)
      .limit(1);
    if (dup?.length) continue;
    const { data: row, error } = await sb.from("autopilot_actions").insert(p).select("*").single();
    if (error) throw new Error(error.message);
    const level = Number(settings.get(p.client_id)?.level ?? 0);
    const auto = !paused && ((p.protective && level >= 1) || (p.rule === "scale_up" && level >= 2));
    if (auto) {
      await execute(sb, row, "piloto automático", true);
    }
    created.push({ id: row.id, rule: p.rule, auto });
  }
  return { proposals: created.length, auto_executed: created.filter((c) => c.auto).length, paused, created, skipped };
}

// ---------------- execução ----------------
async function execute(sb: SupabaseClient, a: Json, who: string, auto = false) {
  await sb.from("autopilot_actions").update({ status: "executing", decided_at: a.decided_at ?? nowIso(), decided_by: a.decided_by ?? who, auto }).eq("id", a.id);
  try {
    const params = a.params as Json;
    let previous: Json = {}, result: Json = {};
    if (a.kind === "pause" || a.kind === "activate") {
      const status = a.kind === "pause" ? "PAUSED" : "ACTIVE";
      const live = await graph(a.object_id as string, { fields: "status,effective_status" });
      previous = { status: live.status };
      if (live.status !== status) await graph(a.object_id as string, { status }, "POST");
      result = { status, already: live.status === status };
      const table = a.object_type === "ad" ? "ads" : a.object_type === "adset" ? "adsets" : "campaigns";
      await sb.from(table).update({ status, effective_status: status }).eq("id", a.object_id);
    } else if (a.kind === "set_budget") {
      const factor = Number(params.factor);
      const prev: Json[] = [], done: Json[] = [];
      for (const t of (params.targets as Json[]) ?? []) {
        const live = await graph(t.id as string, { fields: "daily_budget,name" });
        const from = num(live.daily_budget);                       // centavos
        if (!from) continue;
        const floor = MIN_DAILY_BUDGET * 100;
        const to = Math.max(Math.round(from * factor), factor < 1 ? floor : 0);
        if (to === from) continue;
        await graph(t.id as string, { daily_budget: String(to) }, "POST");
        prev.push({ type: t.type, id: t.id, daily_budget: from });
        done.push({ id: t.id, name: live.name, from: from / 100, to: to / 100 });
        await sb.from(t.type === "adset" ? "adsets" : "campaigns").update({ daily_budget: to / 100 }).eq("id", t.id);
      }
      if (!done.length) throw new Error("Nenhum orçamento diário para alterar (a campanha pode usar orçamento total).");
      previous = { targets: prev };
      result = { targets: done };
    } else if (a.kind === "create_ad") {
      result = await createAd(sb, a);
      previous = {};
    }
    await sb.from("autopilot_actions").update({ status: "done", executed_at: nowIso(), previous, result, error: null }).eq("id", a.id);
    return { ok: true, result };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await sb.from("autopilot_actions").update({ status: "failed", error: msg, executed_at: nowIso() }).eq("id", a.id);
    return { ok: false, error: msg };
  }
}

async function undo(sb: SupabaseClient, a: Json, who: string) {
  if (a.status !== "done") throw new Error("Só dá para desfazer ações executadas.");
  const prev = (a.previous as Json) ?? {};
  if (a.kind === "pause" || a.kind === "activate") {
    await graph(a.object_id as string, { status: String(prev.status ?? "ACTIVE") }, "POST");
    const table = a.object_type === "ad" ? "ads" : a.object_type === "adset" ? "adsets" : "campaigns";
    await sb.from(table).update({ status: prev.status, effective_status: prev.status }).eq("id", a.object_id);
  } else if (a.kind === "set_budget") {
    for (const t of (prev.targets as Json[]) ?? []) {
      await graph(t.id as string, { daily_budget: String(t.daily_budget) }, "POST");
      await sb.from(t.type === "adset" ? "adsets" : "campaigns").update({ daily_budget: num(t.daily_budget) / 100 }).eq("id", t.id);
    }
  } else if (a.kind === "create_ad") {
    const adId = (a.result as Json)?.ad_id as string;
    if (adId) await graph(adId, { status: "PAUSED" }, "POST");     // anúncio criado: desfazer = pausar
  }
  await sb.from("autopilot_actions").update({ status: "undone", undone_at: nowIso(), undone_by: who }).eq("id", a.id);
}

// ---------------- criar anúncio com material da biblioteca ----------------
// Usa um anúncio existente como modelo: mesma página, Instagram, texto e botão; troca só a mídia.
async function createAd(sb: SupabaseClient, a: Json) {
  const p = a.params as Json;
  const act = a.ad_account_id as string;
  const { data: asset, error } = await sb.from("creative_assets").select("id, name, kind, meta").eq("id", p.asset_id).single();
  if (error || !asset) throw new Error("Material não encontrado na biblioteca.");
  const media = ((asset.meta as Json)?.[act] as Json | undefined) ?? {};
  if (!media.image_hash && !media.video_id) throw new Error("Envie o material para esta conta do Meta antes de criar o anúncio.");

  const tpl = await graph(p.template_ad_id as string, {
    fields: "creative{object_story_spec,asset_feed_spec,effective_object_story_id,actor_id,instagram_user_id,body,title,call_to_action_type,link_url}",
  });
  const cr = (tpl.creative as Json) ?? {};
  const oss = (cr.object_story_spec as Json) ?? {};
  const src = ((oss.link_data ?? oss.video_data) as Json) ?? {};
  const feed = (cr.asset_feed_spec as Json) ?? {};
  const firstText = (arr: unknown) => (((arr as Json[] | undefined) ?? [])[0]?.text as string | undefined);

  const pageId = (oss.page_id as string) ?? (cr.actor_id as string) ?? String(cr.effective_object_story_id ?? "").split("_")[0];
  if (!pageId) throw new Error("Não foi possível descobrir a página do anúncio modelo. Escolha outro modelo.");
  const igKey = oss.instagram_user_id ? "instagram_user_id" : oss.instagram_actor_id ? "instagram_actor_id" : "instagram_user_id";
  const igId = (oss.instagram_user_id ?? oss.instagram_actor_id ?? cr.instagram_user_id) as string | undefined;
  const message = (p.message as string) ?? (src.message as string) ?? (cr.body as string) ?? firstText(feed.bodies) ?? "";
  const title = (p.title as string) ?? (src.name as string) ?? (src.title as string) ?? (cr.title as string) ?? firstText(feed.titles);
  let cta = src.call_to_action as Json | undefined;
  const ctaType = (cta?.type as string) ?? (cr.call_to_action_type as string) ?? ((feed.call_to_action_types as string[] | undefined) ?? [])[0];
  if (!cta && ctaType) cta = { type: ctaType };
  if (cta && cta.type === "WHATSAPP_MESSAGE") cta = { type: "WHATSAPP_MESSAGE", value: { ...((cta.value as Json) ?? {}), app_destination: "WHATSAPP" } };
  const link = (src.link as string) ?? ((cta?.value as Json)?.link as string) ?? (cr.link_url as string)
    ?? (((feed.link_urls as Json[] | undefined) ?? [])[0]?.website_url as string)
    ?? (ctaType === "WHATSAPP_MESSAGE" ? "https://api.whatsapp.com/send" : undefined);

  const spec: Json = { page_id: pageId, ...(igId ? { [igKey]: igId } : {}) };
  if (media.video_id) {
    const v = await graph(media.video_id as string, { fields: "status,picture,thumbnails{uri,is_preferred}" });
    const vs = ((v.status as Json)?.video_status as string) ?? "";
    if (vs && vs !== "ready") throw new Error("O vídeo ainda está sendo processado pelo Meta. Tente de novo em alguns minutos.");
    const thumbs = ((v.thumbnails as Json)?.data as Json[] | undefined) ?? [];
    const thumb = (thumbs.find((t) => t.is_preferred)?.uri ?? thumbs[0]?.uri ?? v.picture) as string;
    spec.video_data = { video_id: media.video_id, image_url: thumb, message, ...(title ? { title } : {}), ...(cta ? { call_to_action: cta } : {}) };
  } else {
    if (!link) throw new Error("O anúncio modelo não tem link de destino. Escolha um modelo com botão de ação.");
    spec.link_data = { image_hash: media.image_hash, message, link, ...(title ? { name: title } : {}), ...(cta ? { call_to_action: cta } : {}) };
  }

  const name = (p.name as string) || `${asset.name} — Impacto Ads`;
  const creative = await graph(`${act}/adcreatives`, { name, object_story_spec: JSON.stringify(spec) }, "POST");
  const ad = await graph(`${act}/ads`, {
    name, adset_id: String(p.adset_id), creative: JSON.stringify({ creative_id: creative.id }),
    status: p.activate === false ? "PAUSED" : "ACTIVE",
  }, "POST");
  const adset = await sb.from("adsets").select("campaign_id").eq("id", p.adset_id).maybeSingle();
  await sb.from("ads").upsert({ id: ad.id, ad_account_id: act, adset_id: p.adset_id, campaign_id: adset.data?.campaign_id ?? null, name,
    status: p.activate === false ? "PAUSED" : "ACTIVE", effective_status: p.activate === false ? "PAUSED" : "IN_PROCESS", updated_at: nowIso() });
  return { ad_id: ad.id, creative_id: creative.id };
}

// ---------------- handler ----------------
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type, x-client-info, apikey",
  "access-control-allow-methods": "POST, OPTIONS",
};
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: CORS });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  let who = "piloto automático";
  const cronHeader = req.headers.get("x-cron-secret");
  const { data: cronOk } = cronHeader ? await sb.rpc("check_cron_secret", { s: cronHeader }) : { data: false };
  if (!cronOk) {
    const jwt = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    const { data } = jwt ? await sb.auth.getUser(jwt) : { data: { user: null } };
    if (!data.user) return reply({ error: "não autorizado" }, 401);
    const { data: member } = await sb.from("team_members").select("email").eq("email", (data.user.email ?? "").toLowerCase()).maybeSingle();
    if (!member) return reply({ error: "Este e-mail não faz parte da equipe Impacto" }, 403);
    who = data.user.email ?? data.user.id;
  }
  if (!TOKEN.startsWith("EAA")) return reply({ error: "META_ACCESS_TOKEN não configurado" }, 500);

  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  try {
    switch (body.action) {
      case "check": {
        const perms = await graph("me/permissions");
        const granted = ((perms.data as Json[]) ?? []).filter((p) => p.status === "granted").map((p) => p.permission);
        return reply({ granted, ads_management: granted.includes("ads_management") });
      }
      case "evaluate":
        return reply(await evaluate(sb, { protectiveOnly: !!body.protective_only, clientId: body.client_id }));
      case "decide": {
        const { data: a } = await sb.from("autopilot_actions").select("*").eq("id", body.id).single();
        if (!a) return reply({ error: "Ação não encontrada" }, 404);
        if (a.status !== "proposed") return reply({ error: "Esta ação já foi decidida." }, 409);
        if (body.decision === "reject") {
          await sb.from("autopilot_actions").update({ status: "rejected", decided_at: nowIso(), decided_by: who }).eq("id", a.id);
          return reply({ ok: true });
        }
        const r = await execute(sb, { ...a, decided_by: who, decided_at: nowIso() }, who);
        return reply(r, r.ok ? 200 : 502);
      }
      case "undo": {
        const { data: a } = await sb.from("autopilot_actions").select("*").eq("id", body.id).single();
        if (!a) return reply({ error: "Ação não encontrada" }, 404);
        await undo(sb, a, who);
        return reply({ ok: true });
      }
      case "pause_all": {
        const paused = !!body.paused;
        await sb.from("autopilot_global").update({ paused, paused_at: paused ? nowIso() : null, paused_by: paused ? who : null }).eq("id", 1);
        return reply({ paused });
      }
      case "create_ad": {
        for (const k of ["client_id", "ad_account_id", "adset_id", "template_ad_id", "asset_id"]) {
          if (!body[k]) return reply({ error: `Campo obrigatório: ${k}` }, 400);
        }
        const { data: adset } = await sb.from("adsets").select("name, campaign_id, campaigns(name)").eq("id", body.adset_id).maybeSingle();
        const { data: asset } = await sb.from("creative_assets").select("name").eq("id", body.asset_id).maybeSingle();
        const { data: row, error } = await sb.from("autopilot_actions").insert({
          client_id: body.client_id, ad_account_id: body.ad_account_id, rule: "create_ad", kind: "create_ad", protective: false,
          object_type: "adset", object_id: body.adset_id, object_name: adset?.name ?? null,
          campaign_name: (adset?.campaigns as unknown as { name: string } | null)?.name ?? null,
          title: `Novo anúncio com "${asset?.name ?? "material"}"`,
          reason: `Criado pela equipe a partir da biblioteca, usando o texto e o botão do anúncio modelo.`,
          params: { adset_id: body.adset_id, template_ad_id: body.template_ad_id, asset_id: body.asset_id, name: body.name ?? null,
            activate: body.activate !== false, message: body.message ?? undefined, title: body.title ?? undefined },
          status: "approved", decided_by: who, decided_at: nowIso(),
        }).select("*").single();
        if (error) throw new Error(error.message);
        const r = await execute(sb, row, who);
        return reply(r, r.ok ? 200 : 502);
      }
      default:
        return reply({ error: "ação desconhecida" }, 400);
    }
  } catch (e) {
    return reply({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
