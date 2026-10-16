// Impacto Ads — meta-sync
// 1) action "sync"   (padrão): coleta as contas no Meta, grava no banco e avalia os alertas.
// 3) action "balances": atualiza só saldo e status das contas (leve; roda de hora em hora).
// 2) action "period": totais de um período consultados AO VIVO no Meta (mesma base do Gerenciador
//    de Anúncios), com o saldo da conta no momento e os totais gravados no painel para conferência.
//
// Chamadas aceitas:
//   - pg_cron, com header x-cron-secret (segredo guardado no Vault do banco)
//   - painel (usuário da equipe logado), com header Authorization: Bearer <jwt>
//
// sync:   { "days": 3, "account_id": "act_123" }
//         Contas que nunca tiveram a carga completa recebem 90 dias automaticamente.
// period: { "action": "period", "client_id": "...", "since": "2026-10-06", "until": "2026-10-12", "compare": true,
//           "campaign_ids": ["120..."] }   ← opcional: só essas campanhas (filtro feito pelo próprio Meta)
//
// Segredos: META_ACCESS_TOKEN (obrigatório), META_APP_SECRET (recomendado),
//           META_API_VERSION (opcional), ALERT_WEBHOOK_URL (opcional)

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";

const API_VERSION = Deno.env.get("META_API_VERSION") ?? "v25.0";
const GRAPH = `https://graph.facebook.com/${API_VERSION}`;
const clean = (v: string | undefined) => (v ?? "").trim().replace(/^["']|["']$/g, "");
const RAW_TOKEN = clean(Deno.env.get("META_ACCESS_TOKEN"));
const RAW_SECRET = clean(Deno.env.get("META_APP_SECRET"));
// Tolera os dois segredos cadastrados invertidos (o token do Meta sempre começa com "EAA")
const SWAPPED = !RAW_TOKEN.startsWith("EAA") && RAW_SECRET.startsWith("EAA");
const TOKEN = SWAPPED ? RAW_SECRET : RAW_TOKEN;
const APP_SECRET = SWAPPED ? RAW_TOKEN : RAW_SECRET;
const ALERT_WEBHOOK_URL = Deno.env.get("ALERT_WEBHOOK_URL") ?? "";
const CONCURRENCY = 3;
const FULL_HISTORY_DAYS = 90;

// Mesma atribuição configurada nos conjuntos de anúncios = mesmo número do Gerenciador de Anúncios
const ATTRIBUTION = { use_unified_attribution_setting: "true" };

const ACTION_CONVERSATION = "onsite_conversion.messaging_conversation_started_7d";
const ACTION_LEADS = ["lead", "onsite_conversion.lead_grouped"];
const ACTION_VIDEO = "video_view";
const ACTION_LPV = "landing_page_view";
const ACTION_ENGAGEMENT = "post_engagement";
// Compras: "omni_purchase" é a coluna "Compras" do Gerenciador (site + app + loja); os outros são equivalentes
// em contas mais antigas. Pega o maior, nunca soma (são a mesma compra contada em visões diferentes).
const ACTION_PURCHASE = ["omni_purchase", "purchase", "offsite_conversion.fb_pixel_purchase", "onsite_web_purchase"];
const ACTION_ADD_TO_CART = ["omni_add_to_cart", "add_to_cart", "offsite_conversion.fb_pixel_add_to_cart"];
const ACTION_CHECKOUT = ["omni_initiated_checkout", "initiate_checkout", "offsite_conversion.fb_pixel_initiate_checkout"];

type Json = Record<string, unknown>;
type Action = { action_type: string; value: string };

// ---------------- Graph API ----------------
let proof = "";
async function appSecretProof(): Promise<string> {
  if (!APP_SECRET) return "";
  if (proof) return proof;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(APP_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(TOKEN));
  proof = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return proof;
}

async function graph(path: string, params: Record<string, string> = {}): Promise<Json> {
  const url = new URL(path.startsWith("http") ? path : `${GRAPH}/${path}`);
  if (!path.startsWith("http")) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    url.searchParams.set("access_token", TOKEN);
    const p = await appSecretProof();
    if (p) url.searchParams.set("appsecret_proof", p);
  }
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url);
    const body = await res.json().catch(() => ({}));
    if (res.ok) return body as Json;
    const err = (body as { error?: { message?: string; code?: number; is_transient?: boolean } }).error ?? {};
    // 4/17/32/613 = limite de chamadas; 1/2 = erro temporário do Meta
    const retryable = err.is_transient || [1, 2, 4, 17, 32, 613].includes(err.code ?? 0);
    if (retryable && attempt < 3) {
      await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
      continue;
    }
    throw new Error(`Meta API (${err.code ?? res.status}): ${err.message ?? res.statusText}`);
  }
}

async function graphAll(path: string, params: Record<string, string>): Promise<Json[]> {
  const out: Json[] = [];
  let page = await graph(path, { limit: "500", ...params });
  for (;;) {
    out.push(...((page.data as Json[]) ?? []));
    const next = (page.paging as { next?: string } | undefined)?.next;
    if (!next) break;
    page = await graph(next);
  }
  return out;
}

// ---------------- helpers ----------------
const num = (v: unknown) => (v === undefined || v === null || v === "" ? 0 : Number(v));
const cents = (v: unknown) => (v === undefined || v === null || v === "" ? null : Number(v) / 100);
const actionVal = (actions: Action[] | undefined, types: string | string[]) => {
  const list = Array.isArray(types) ? types : [types];
  // não somar tipos que se sobrepõem: pega o maior valor entre os tipos equivalentes
  return Math.max(0, ...(actions ?? []).filter((a) => list.includes(a.action_type)).map((a) => num(a.value)));
};
const ymd = (d: Date) => d.toISOString().slice(0, 10);
function brDate(offsetDays: number) {
  // data no fuso de Brasília (UTC-3, sem horário de verão)
  const d = new Date(Date.now() - 3 * 3600_000);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return ymd(d);
}
function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return ymd(d);
}
const daysBetween = (a: string, b: string) =>
  Math.round((new Date(`${b}T12:00:00Z`).getTime() - new Date(`${a}T12:00:00Z`).getTime()) / 86400000) + 1;

async function upsert(sb: SupabaseClient, table: string, rows: Json[], onConflict: string) {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await sb.from(table).upsert(rows.slice(i, i + 500), { onConflict });
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}

// Saldo disponível de conta pré-paga: total depositado (spend_cap) − total gasto (amount_spent).
// O texto "Saldo disponível" do Meta (funding_source_details) é guardado à parte para conferência.
function accountBalance(acc: Json) {
  const cap = cents(acc.spend_cap), spent = cents(acc.amount_spent);
  const display = (acc.funding_source_details as Json | undefined)?.display_string as string | undefined;
  const m = display?.match(/R\$\s*([0-9.,]+)/);
  const displayValue = m ? Number(m[1].replace(/\./g, "").replace(",", ".")) : null;
  return {
    spend_cap: cap,
    amount_spent: spent,
    available: cap && cap > 0 && spent !== null ? Math.max(cap - spent, 0) : null,
    display_string: display ?? null,
    display_value: displayValue,
  };
}

const INSIGHT_FIELDS = "spend,impressions,reach,clicks,inline_link_clicks,actions,action_values,date_start";

function insightRow(level: string, objectId: string, accountId: string, r: Json): Json {
  const actions = r.actions as Action[] | undefined;
  const values = r.action_values as Action[] | undefined;
  return {
    level,
    object_id: objectId,
    ad_account_id: accountId,
    campaign_id: (r.campaign_id as string) ?? null,
    date: r.date_start,
    spend: num(r.spend),
    impressions: num(r.impressions),
    reach: num(r.reach),
    clicks: num(r.clicks),
    link_clicks: num(r.inline_link_clicks),
    conversations: actionVal(actions, ACTION_CONVERSATION),
    leads: actionVal(actions, ACTION_LEADS),
    video_views: actionVal(actions, ACTION_VIDEO),
    purchases: actionVal(actions, ACTION_PURCHASE),
    purchase_value: actionVal(values, ACTION_PURCHASE),
    add_to_cart: actionVal(actions, ACTION_ADD_TO_CART),
    checkouts: actionVal(actions, ACTION_CHECKOUT),
    actions: actions ?? null,
    action_values: values ?? null,
    synced_at: new Date().toISOString(),
  };
}

// ---------------- sincronização de uma conta ----------------
async function syncAccount(sb: SupabaseClient, act: string, since: string, until: string) {
  const timeRange = JSON.stringify({ since, until });

  // 1) Dados da conta
  const acc = await graph(act, {
    fields: "name,currency,timezone_name,account_status,disable_reason,amount_spent,spend_cap,balance,funding_source_details",
  });
  const freq = await graph(`${act}/insights`, { level: "account", date_preset: "last_7d", fields: "frequency,reach", ...ATTRIBUTION });
  const f = ((freq.data as Json[]) ?? [])[0] ?? {};

  // 2) Campanhas e anúncios (exceto arquivados/excluídos)
  const notArchived = JSON.stringify([{ field: "effective_status", operator: "NOT_IN", value: ["ARCHIVED", "DELETED"] }]);
  const campaigns = await graphAll(`${act}/campaigns`, {
    fields: "id,name,objective,status,effective_status,daily_budget,lifetime_budget",
    filtering: notArchived,
  });
  const ads = await graphAll(`${act}/ads`, {
    fields: "id,name,status,effective_status,campaign_id,adset_id,issues_info,ad_review_feedback,creative{thumbnail_url}",
    filtering: notArchived,
  });

  // 3) Métricas diárias nos três níveis
  const base = { time_range: timeRange, time_increment: "1", ...ATTRIBUTION };
  const [accIns, campIns, adIns] = await Promise.all([
    graphAll(`${act}/insights`, { ...base, level: "account", fields: INSIGHT_FIELDS }),
    graphAll(`${act}/insights`, { ...base, level: "campaign", fields: `campaign_id,${INSIGHT_FIELDS}` }),
    graphAll(`${act}/insights`, { ...base, level: "ad", fields: `ad_id,campaign_id,${INSIGHT_FIELDS}` }),
  ]);

  // 4) Gravação
  const bal = accountBalance(acc);
  const { error: accErr } = await sb.from("ad_accounts").update({
    name: acc.name,
    currency: acc.currency,
    timezone_name: acc.timezone_name,
    account_status: acc.account_status,
    disable_reason: acc.disable_reason,
    amount_spent: bal.amount_spent,
    spend_cap: bal.spend_cap,
    balance: cents(acc.balance),
    funding_display: bal.display_string,
    freq_7d: f.frequency ? Number(f.frequency) : null,
    reach_7d: f.reach ? Number(f.reach) : null,
    last_synced_at: new Date().toISOString(),
    balance_updated_at: new Date().toISOString(),
    last_sync_error: null,
  }).eq("id", act);
  if (accErr) throw new Error(`ad_accounts: ${accErr.message}`);

  const now = new Date().toISOString();
  await upsert(sb, "campaigns", campaigns.map((c) => ({
    id: c.id, ad_account_id: act, name: c.name, objective: c.objective, status: c.status,
    effective_status: c.effective_status, daily_budget: cents(c.daily_budget),
    lifetime_budget: cents(c.lifetime_budget), updated_at: now,
  })), "id");

  await upsert(sb, "ads", ads.map((a) => ({
    id: a.id, ad_account_id: act, campaign_id: a.campaign_id, adset_id: a.adset_id, name: a.name,
    status: a.status, effective_status: a.effective_status,
    issues: a.issues_info || a.ad_review_feedback
      ? { issues_info: a.issues_info ?? null, review: a.ad_review_feedback ?? null } : null,
    thumbnail_url: (a.creative as Json | undefined)?.thumbnail_url ?? null, updated_at: now,
  })), "id");

  // Dias sem nenhuma linha no Meta = dias sem veiculação: zera o que estiver gravado,
  // para não sobrar número antigo no painel
  const { error: delErr } = await sb.from("insights_daily").delete()
    .eq("ad_account_id", act).gte("date", since).lte("date", until);
  if (delErr) throw new Error(`insights_daily: ${delErr.message}`);

  await upsert(sb, "insights_daily", [
    ...accIns.map((r) => insightRow("account", act, act, r)),
    ...campIns.map((r) => insightRow("campaign", r.campaign_id as string, act, r)),
    ...adIns.map((r) => insightRow("ad", r.ad_id as string, act, r)),
  ], "level,object_id,date");

  return { campaigns: campaigns.length, ads: ads.length, days: accIns.length, since, until };
}

// ---------------- totais de um período, ao vivo no Meta ----------------
const PERIOD_FIELDS =
  "spend,impressions,reach,frequency,clicks,inline_link_clicks,inline_link_click_ctr,cpm,cost_per_inline_link_click,actions,action_values";

function periodTotals(r: Json) {
  const actions = r.actions as Action[] | undefined;
  const values = r.action_values as Action[] | undefined;
  return {
    spend: num(r.spend),
    impressions: num(r.impressions),
    reach: num(r.reach),
    frequency: num(r.frequency),
    clicks: num(r.clicks),
    link_clicks: num(r.inline_link_clicks),
    conversations: actionVal(actions, ACTION_CONVERSATION),
    leads: actionVal(actions, ACTION_LEADS),
    landing_page_views: actionVal(actions, ACTION_LPV),
    video_views: actionVal(actions, ACTION_VIDEO),
    engagement: actionVal(actions, ACTION_ENGAGEMENT),
    purchases: actionVal(actions, ACTION_PURCHASE),
    purchase_value: actionVal(values, ACTION_PURCHASE),
    add_to_cart: actionVal(actions, ACTION_ADD_TO_CART),
    checkouts: actionVal(actions, ACTION_CHECKOUT),
  };
}
type Totals = ReturnType<typeof periodTotals>;
const ZERO: Totals = periodTotals({});

async function accountPeriod(act: string, since: string, until: string, apiDefault = false, campaignIds: string[] = []): Promise<Totals> {
  const res = await graph(`${act}/insights`, {
    level: "account", time_range: JSON.stringify({ since, until }), fields: PERIOD_FIELDS, ...(apiDefault ? {} : ATTRIBUTION),
    // O Meta soma só as campanhas escolhidas e já entrega o alcance sem repetir pessoas entre elas
    ...(campaignIds.length ? { filtering: JSON.stringify([{ field: "campaign.id", operator: "IN", value: campaignIds }]) } : {}),
  });
  const row = ((res.data as Json[]) ?? [])[0];
  return row ? periodTotals(row) : { ...ZERO };
}

function sumTotals(list: Totals[]): Totals {
  const t = { ...ZERO };
  for (const x of list) for (const k of Object.keys(t) as (keyof Totals)[]) t[k] += x[k];
  // frequência de várias contas = impressões ÷ alcance somado (aproximação; com 1 conta é exata)
  t.frequency = list.length === 1 ? list[0].frequency : t.reach ? t.impressions / t.reach : 0;
  return t;
}

async function period(sb: SupabaseClient, body: Json) {
  const clientId = String(body.client_id ?? "");
  const since = String(body.since ?? ""), until = String(body.until ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(since) || !/^\d{4}-\d{2}-\d{2}$/.test(until) || since > until) {
    return { status: 400, body: { error: "Período inválido. Use datas no formato AAAA-MM-DD." } };
  }
  const { data: allAccs, error } = await sb.from("ad_accounts").select("id, name").eq("client_id", clientId);
  if (error) return { status: 500, body: { error: error.message } };
  if (!allAccs?.length) return { status: 404, body: { error: "Cliente sem conta de anúncios cadastrada." } };

  // Filtro por campanha: só campanhas deste cliente; cada conta recebe as campanhas dela
  const wanted = Array.isArray(body.campaign_ids) ? (body.campaign_ids as unknown[]).map(String).filter(Boolean) : [];
  const byAccount = new Map<string, string[]>();
  let campaigns: { id: string; name: string | null }[] = [];
  if (wanted.length) {
    const { data: cps } = await sb.from("campaigns").select("id, name, ad_account_id")
      .in("id", wanted).in("ad_account_id", allAccs.map((a) => a.id));
    if (!cps?.length) return { status: 400, body: { error: "Nenhuma das campanhas escolhidas pertence a este cliente." } };
    for (const c of cps) byAccount.set(c.ad_account_id, [...(byAccount.get(c.ad_account_id) ?? []), c.id]);
    campaigns = cps.map((c) => ({ id: c.id, name: c.name }));
  }
  const accs = wanted.length ? allAccs.filter((a) => byAccount.has(a.id)) : allAccs;

  const n = daysBetween(since, until);
  const prevUntil = addDays(since, -1), prevSince = addDays(since, -n);

  const accounts = [];
  for (const a of accs) {
    try {
      const [current, previous, acc] = await Promise.all([
        accountPeriod(a.id, since, until, body.attribution === "api_default", byAccount.get(a.id) ?? []),
        body.compare ? accountPeriod(a.id, prevSince, prevUntil, body.attribution === "api_default", byAccount.get(a.id) ?? []) : Promise.resolve(null),
        graph(a.id, { fields: "name,amount_spent,spend_cap,funding_source_details" }),
      ]);
      accounts.push({ id: a.id, name: (acc.name as string) ?? a.name, current, previous, balance: accountBalance(acc), error: null });
    } catch (e) {
      accounts.push({ id: a.id, name: a.name, current: null, previous: null, balance: null, error: e instanceof Error ? e.message : String(e) });
    }
  }

  // Totais gravados no painel no mesmo período (para a conferência)
  // Lê em páginas de 1000 linhas (limite por consulta do banco)
  const stored: Json[] = [];
  for (let from = 0; ; from += 1000) {
    let sq = sb.from("insights_daily")
      .select("ad_account_id, spend, impressions, clicks, link_clicks, conversations, leads, video_views, purchases, purchase_value, date")
      .gte("date", since).lte("date", until);
    sq = campaigns.length
      ? sq.eq("level", "campaign").in("object_id", campaigns.map((c) => c.id))
      : sq.eq("level", "account").in("ad_account_id", accs.map((a) => a.id));
    const { data: page, error: pErr } = await sq.order("date").order("object_id").range(from, from + 999);
    if (pErr) throw new Error(`insights_daily: ${pErr.message}`);
    stored.push(...(page ?? []));
    if (!page || page.length < 1000) break;
  }
  const panel = { spend: 0, impressions: 0, clicks: 0, link_clicks: 0, conversations: 0, leads: 0, video_views: 0, purchases: 0, purchase_value: 0, days: 0 };
  const days = new Set<string>();
  for (const r of stored) {
    panel.spend += num(r.spend); panel.impressions += num(r.impressions); panel.clicks += num(r.clicks);
    panel.link_clicks += num(r.link_clicks); panel.conversations += num(r.conversations);
    panel.leads += num(r.leads); panel.video_views += num(r.video_views);
    panel.purchases += num(r.purchases); panel.purchase_value += num(r.purchase_value); days.add(r.date as string);
  }
  panel.days = days.size;

  const ok = accounts.filter((a) => a.current) as { current: Totals; previous: Totals | null }[];
  return {
    status: 200,
    body: {
      since, until, days: n,
      previous_range: body.compare ? { since: prevSince, until: prevUntil } : null,
      fetched_at: new Date().toISOString(),
      attribution: "configuração de atribuição de cada conjunto de anúncios (igual ao Gerenciador)",
      multiple_accounts: accs.length > 1,
      campaigns,
      totals: ok.length ? sumTotals(ok.map((a) => a.current)) : null,
      previous_totals: body.compare && ok.length ? sumTotals(ok.map((a) => a.previous ?? { ...ZERO })) : null,
      panel,
      accounts,
    },
  };
}

// ---------------- saldo e status, leve ----------------
async function refreshBalances(sb: SupabaseClient) {
  const { data: accs } = await sb.from("ad_accounts").select("id, clients!inner(active)").eq("clients.active", true);
  let ok = 0;
  const errors: Json[] = [];
  for (const a of accs ?? []) {
    try {
      const acc = await graph(a.id, { fields: "account_status,disable_reason,amount_spent,spend_cap,funding_source_details" });
      const bal = accountBalance(acc);
      await sb.from("ad_accounts").update({
        account_status: acc.account_status, disable_reason: acc.disable_reason,
        amount_spent: bal.amount_spent, spend_cap: bal.spend_cap, funding_display: bal.display_string,
        balance_updated_at: new Date().toISOString(),
      }).eq("id", a.id);
      ok++;
    } catch (e) {
      errors.push({ account: a.id, error: e instanceof Error ? e.message : String(e) });
    }
  }
  await sb.rpc("evaluate_alerts");
  return { ok, errors };
}

// ---------------- envio de alertas novos ----------------
async function notifyNewAlerts(sb: SupabaseClient) {
  if (!ALERT_WEBHOOK_URL) return 0;
  const { data: pending } = await sb.from("alerts")
    .select("id, type, severity, title, details, created_at, clients(name)")
    .eq("status", "open").is("notified_at", null).order("severity");
  if (!pending?.length) return 0;
  const res = await fetch(ALERT_WEBHOOK_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ source: "impacto-ads", alerts: pending }),
  });
  if (!res.ok) throw new Error(`webhook de alertas respondeu ${res.status}`);
  await sb.from("alerts").update({ notified_at: new Date().toISOString() }).in("id", pending.map((a) => a.id));
  return pending.length;
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
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  // Autorização: cron (segredo) ou usuário da equipe logado no painel
  let trigger = "cron";
  const cronHeader = req.headers.get("x-cron-secret");
  const { data: cronOk } = cronHeader
    ? await sb.rpc("check_cron_secret", { s: cronHeader })
    : { data: false };
  if (!cronOk) {
    const jwt = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    const { data } = jwt ? await sb.auth.getUser(jwt) : { data: { user: null } };
    if (!data.user) return reply({ error: "não autorizado" }, 401);
    const { data: member } = await sb.from("team_members").select("email")
      .eq("email", (data.user.email ?? "").toLowerCase()).maybeSingle();
    if (!member) return reply({ error: "Este e-mail não faz parte da equipe Impacto" }, 403);
    trigger = `manual:${data.user.email ?? data.user.id}`;
  }
  if (!TOKEN) return reply({ error: "META_ACCESS_TOKEN não configurado" }, 500);
  if (!TOKEN.startsWith("EAA")) {
    return reply({ error: "META_ACCESS_TOKEN não tem formato de token do Meta (deveria começar com EAA)" }, 500);
  }

  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};

  if (body.action === "period") {
    try {
      const r = await period(sb, body);
      return reply(r.body, r.status);
    } catch (e) {
      return reply({ error: e instanceof Error ? e.message : String(e) }, 500);
    }
  }

  if (body.action === "balances") return reply(await refreshBalances(sb));

  // ----- sync -----
  const days = Math.min(Math.max(Number(body.days) || 3, 1), FULL_HISTORY_DAYS);
  const until = brDate(0);

  let q = sb.from("ad_accounts").select("id, history_loaded_at, clients!inner(active)").eq("clients.active", true);
  if (body.account_id) q = q.eq("id", body.account_id);
  const { data: accounts, error } = await q;
  if (error) return reply({ error: error.message }, 500);

  const { data: run } = await sb.from("sync_runs").insert({ trigger }).select("id").single();

  const results: Json[] = [];
  const errors: Json[] = [];
  const queue = [...(accounts ?? [])];
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    for (let a = queue.shift(); a; a = queue.shift()) {
      // Conta sem histórico completo (nova ou liberada depois) recebe a carga de 90 dias
      const full = !a.history_loaded_at;
      const since = brDate(-(full ? FULL_HISTORY_DAYS : days));
      try {
        results.push({ account: a.id, full_history: full, ...(await syncAccount(sb, a.id, since, until)) });
        if (full) await sb.from("ad_accounts").update({ history_loaded_at: new Date().toISOString() }).eq("id", a.id);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push({ account: a.id, error: msg });
        await sb.from("ad_accounts").update({ last_sync_error: msg }).eq("id", a.id);
      }
    }
  }));

  const { data: alertsOpened, error: alertErr } = await sb.rpc("evaluate_alerts");
  if (alertErr) errors.push({ step: "evaluate_alerts", error: alertErr.message });

  let notified = 0;
  try { notified = await notifyNewAlerts(sb); }
  catch (e) { errors.push({ step: "notify", error: e instanceof Error ? e.message : String(e) }); }

  await sb.from("sync_runs").update({
    finished_at: new Date().toISOString(),
    accounts_ok: results.length,
    accounts_err: errors.filter((e) => e.account).length,
    errors: errors.length ? errors : null,
  }).eq("id", run?.id);

  return reply({ until, secrets_swapped: SWAPPED, results, errors, alerts_active: alertsOpened, notified });
});
