// Impacto Ads — estratégia
//
// { action: "collect", account_id? }        → raio-x dos últimos 30 dias (posicionamento, região, público, horário, conjuntos)
// { action: "analyze", client_id, days? }   → funil por campanha, gargalos, recortes vencedores/perdedores e recomendações
// { action: "ai", client_id, days? }        → leitura estratégica da IA sobre a análise (precisa de ANTHROPIC_API_KEY)
// { action: "geo_search", q }               → cidades para o perfil de campanha (com a "key" que o Meta usa)
// { action: "plan_launch", client_id, asset_ids?, daily_budget?, activate? } → monta o plano e cria a ação na fila do piloto
// { action: "images64", urls }              → imagens dos criativos em base64 (para o relatório em slides)
// { action: "weekly_reports" | "monthly_reports", client_id?, since?, until? } → relatórios automáticos (texto + dados dos slides)
//
// Chamadas: pg_cron (x-cron-secret) ou usuário da equipe logado.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";

const API_VERSION = Deno.env.get("META_API_VERSION") ?? "v25.0";
const GRAPH = `https://graph.facebook.com/${API_VERSION}`;
const clean = (v: string | undefined) => (v ?? "").trim().replace(/^["']|["']$/g, "");
const RAW_TOKEN = clean(Deno.env.get("META_ACCESS_TOKEN"));
const RAW_SECRET = clean(Deno.env.get("META_APP_SECRET"));
const SWAPPED = !RAW_TOKEN.startsWith("EAA") && RAW_SECRET.startsWith("EAA");
const TOKEN = SWAPPED ? RAW_SECRET : RAW_TOKEN;
const APP_SECRET = SWAPPED ? RAW_TOKEN : RAW_SECRET;
const ANTHROPIC_KEY = clean(Deno.env.get("ANTHROPIC_API_KEY"));
const AI_MODEL = Deno.env.get("ANTHROPIC_MODEL") ?? "claude-sonnet-5-5";
const ATTRIBUTION = { use_unified_attribution_setting: "true" };

type Json = Record<string, unknown>;
type Action = { action_type: string; value: string };
type Kind = "purchase" | "conversation" | "lead" | "click";

// ---------------- Graph ----------------
let proof = "";
async function appSecretProof() {
  if (!APP_SECRET) return "";
  if (proof) return proof;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(APP_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
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
    if ((err.is_transient || [1, 2, 4, 17, 32, 613].includes(err.code ?? 0)) && attempt < 3) {
      await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt)); continue;
    }
    throw new Error(`Meta (${err.code ?? res.status}): ${err.message ?? res.statusText}`);
  }
}
async function graphAll(path: string, params: Record<string, string>) {
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
const ymd = (d: Date) => d.toISOString().slice(0, 10);
function brDate(offset: number) { const d = new Date(Date.now() - 3 * 3600_000); d.setUTCDate(d.getUTCDate() + offset); return ymd(d); }
const actionVal = (actions: Action[] | undefined, types: string | string[]) => {
  const list = Array.isArray(types) ? types : [types];
  return Math.max(0, ...(actions ?? []).filter((a) => list.includes(a.action_type)).map((a) => num(a.value)));
};
const A = {
  conversation: "onsite_conversion.messaging_conversation_started_7d",
  lead: ["lead", "onsite_conversion.lead_grouped"],
  purchase: ["omni_purchase", "purchase", "offsite_conversion.fb_pixel_purchase", "onsite_web_purchase"],
  cart: ["omni_add_to_cart", "add_to_cart", "offsite_conversion.fb_pixel_add_to_cart"],
  checkout: ["omni_initiated_checkout", "initiate_checkout", "offsite_conversion.fb_pixel_initiate_checkout"],
  lpv: "landing_page_view",
  video: "video_view",
  reply: "onsite_conversion.messaging_first_reply",
};
const conf = (n: number) => (n >= 30 ? "alta" : n >= 10 ? "média" : "baixa");
const money = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pct = (v: number, d = 1) => `${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: d, minimumFractionDigits: d })}%`;
const nowIso = () => new Date().toISOString();

const EXPLICIT: Record<string, Kind | null> = { vendas: "purchase", conversas_whatsapp: "conversation", leads: "lead", trafego: "click", reconhecimento: null };
const KIND_TXT: Record<Kind, { one: string; many: string }> = {
  purchase: { one: "venda", many: "vendas" }, conversation: { one: "conversa", many: "conversas" },
  lead: { one: "lead", many: "leads" }, click: { one: "clique", many: "cliques" },
};
function campaignKind(objective: string | null | undefined, clientKind: Kind | null): Kind | null {
  const o = String(objective ?? "");
  if (["OUTCOME_TRAFFIC", "LINK_CLICKS"].includes(o)) return "click";
  if (["OUTCOME_AWARENESS", "REACH", "BRAND_AWARENESS", "VIDEO_VIEWS"].includes(o)) return null;
  return clientKind;
}

// ================= 1) coleta do raio-x =================
const BD_FIELDS = "campaign_id,spend,impressions,reach,inline_link_clicks,actions,action_values";
const PLACEMENT_LABEL: Record<string, string> = {
  "facebook|feed": "Facebook · Feed", "facebook|facebook_reels": "Facebook · Reels", "facebook|story": "Facebook · Stories",
  "facebook|marketplace": "Facebook · Marketplace", "facebook|video_feeds": "Facebook · Vídeos", "facebook|search": "Facebook · Busca",
  "facebook|instream_video": "Facebook · Vídeo in-stream", "facebook|right_hand_column": "Facebook · Coluna direita",
  "facebook|facebook_reels_overlay": "Facebook · Sobreposição Reels", "facebook|profile_feed": "Facebook · Perfil",
  "facebook|notification": "Facebook · Notificações",
  "instagram|feed": "Instagram · Feed", "instagram|instagram_reels": "Instagram · Reels", "instagram|story": "Instagram · Stories",
  "instagram|instagram_explore": "Instagram · Explorar", "instagram|instagram_explore_grid_home": "Instagram · Explorar (grade)",
  "instagram|instagram_profile_feed": "Instagram · Perfil", "instagram|instagram_search": "Instagram · Busca",
  "messenger|messenger_inbox": "Messenger · Caixa de entrada", "messenger|story": "Messenger · Stories",
  "audience_network|classic": "Audience Network", "audience_network|rewarded_video": "Audience Network · Vídeo premiado",
  "threads|threads_feed": "Threads · Feed",
  "facebook|facebook_stories": "Facebook · Stories", "instagram|instagram_stories": "Instagram · Stories",
  "instagram|instagram_feed": "Instagram · Feed", "facebook|facebook_feed": "Facebook · Feed",
  "facebook|facebook_profile_feed": "Facebook · Perfil", "facebook|facebook_search": "Facebook · Busca",
  "audience_network|an_classic": "Audience Network", "messenger|messenger_stories": "Messenger · Stories",
  "instagram|instagram_reels_overlay": "Instagram · Sobreposição Reels", "facebook|facebook_groups_feed": "Facebook · Grupos",
};
// Nome do posicionamento no relatório → nome usado na segmentação ao criar a campanha
const TARGET_POSITION: Record<string, string> = {
  "facebook|feed": "feed", "facebook|facebook_feed": "feed", "facebook|facebook_reels": "facebook_reels", "facebook|story": "story",
  "facebook|facebook_stories": "story", "facebook|marketplace": "marketplace", "facebook|video_feeds": "video_feeds",
  "facebook|search": "search", "facebook|facebook_search": "search", "facebook|instream_video": "instream_video",
  "facebook|right_hand_column": "right_hand_column", "facebook|profile_feed": "profile_feed", "facebook|facebook_profile_feed": "profile_feed",
  "facebook|facebook_reels_overlay": "facebook_reels_overlay", "facebook|notification": "notification", "facebook|facebook_groups_feed": "groups_feed",
  "instagram|feed": "stream", "instagram|instagram_feed": "stream", "instagram|stream": "stream", "instagram|story": "story",
  "instagram|instagram_stories": "story", "instagram|instagram_reels": "reels", "instagram|reels": "reels",
  "instagram|instagram_explore": "explore", "instagram|instagram_explore_grid_home": "explore_home",
  "instagram|instagram_profile_feed": "profile_feed", "instagram|instagram_search": "ig_search", "instagram|instagram_reels_overlay": "profile_reels",
  "messenger|messenger_inbox": "messenger_home", "messenger|story": "story", "messenger|messenger_stories": "story",
  "audience_network|classic": "classic", "audience_network|an_classic": "classic", "audience_network|rewarded_video": "rewarded_video",
};
const GENDER: Record<string, string> = { male: "Homens", female: "Mulheres", unknown: "Não informado" };

function bdRow(act: string, dim: string, key: string, label: string, r: Json, since: string, until: string, extra?: Json): Json {
  const actions = r.actions as Action[] | undefined, values = r.action_values as Action[] | undefined;
  return {
    ad_account_id: act, campaign_id: (r.campaign_id as string) ?? "", dim, key, label, extra: extra ?? null,
    spend: num(r.spend), impressions: num(r.impressions), reach: num(r.reach), link_clicks: num(r.inline_link_clicks),
    conversations: actionVal(actions, A.conversation), leads: actionVal(actions, A.lead), purchases: actionVal(actions, A.purchase),
    purchase_value: actionVal(values, A.purchase), since, until, updated_at: nowIso(),
  };
}

function geoLabel(t: Json | undefined) {
  const g = (t?.geo_locations as Json | undefined) ?? {};
  const cities = ((g.cities as Json[] | undefined) ?? []).map((c) => `${c.name}${c.radius ? ` +${c.radius}${c.distance_unit === "mile" ? "mi" : "km"}` : ""}`);
  const custom = ((g.custom_locations as Json[] | undefined) ?? []).map((c) => `${c.name ?? c.address_string ?? "ponto"} +${c.radius}${c.distance_unit === "mile" ? "mi" : "km"}`);
  const regions = ((g.regions as Json[] | undefined) ?? []).map((r) => r.name as string);
  const countries = ((g.countries as string[] | undefined) ?? []);
  const all = [...cities, ...custom, ...regions, ...countries];
  return all.length ? all.join(", ") : "Sem localização definida";
}

async function collectAccount(sb: SupabaseClient, act: string) {
  const since = brDate(-30), until = brDate(-1);
  const base = { level: "campaign", time_range: JSON.stringify({ since, until }), fields: BD_FIELDS, ...ATTRIBUTION };
  const [plc, ag, hr, rg, sets, setIns] = await Promise.all([
    graphAll(`${act}/insights`, { ...base, breakdowns: "publisher_platform,platform_position" }),
    graphAll(`${act}/insights`, { ...base, breakdowns: "age,gender" }),
    graphAll(`${act}/insights`, { ...base, breakdowns: "hourly_stats_aggregated_by_advertiser_time_zone" }),
    graphAll(`${act}/insights`, { ...base, breakdowns: "region" }),
    graphAll(`${act}/adsets`, { fields: "id,name,campaign_id,targeting{geo_locations,age_min,age_max,genders,publisher_platforms}", filtering: JSON.stringify([{ field: "effective_status", operator: "NOT_IN", value: ["ARCHIVED", "DELETED"] }]) }),
    graphAll(`${act}/insights`, { ...base, level: "adset", fields: `adset_id,${BD_FIELDS}` }),
  ]);
  const setBy = new Map(sets.map((s) => [s.id as string, s]));
  const rows: Json[] = [
    ...plc.map((r) => {
      const k = `${r.publisher_platform}|${r.platform_position}`;
      const nice = (x: string) => x.replace(/^(facebook|instagram)_/, "").replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
      const label = PLACEMENT_LABEL[k] ?? `${nice(String(r.publisher_platform))} · ${nice(String(r.platform_position))}`;
      return bdRow(act, "placement", k, label, r, since, until);
    }),
    ...ag.map((r) => bdRow(act, "age_gender", `${r.age}|${r.gender}`, `${r.age} · ${GENDER[r.gender as string] ?? r.gender}`, r, since, until)),
    ...hr.map((r) => { const h = String(r.hourly_stats_aggregated_by_advertiser_time_zone ?? "").slice(0, 2); return bdRow(act, "hour", h, `${h}h`, r, since, until); }),
    ...rg.map((r) => bdRow(act, "region", String(r.region), String(r.region), r, since, until)),
    ...setIns.map((r) => {
      const s = setBy.get(r.adset_id as string);
      const t = s?.targeting as Json | undefined;
      return bdRow(act, "adset", r.adset_id as string, `${s?.name ?? r.adset_id} — ${geoLabel(t)}`, r, since, until,
        { adset_name: s?.name ?? null, geo: t?.geo_locations ?? null, age_min: t?.age_min ?? null, age_max: t?.age_max ?? null });
    }),
  ];
  // substitui o raio-x da conta inteiro (o que saiu da janela de 30 dias deixa de aparecer)
  await sb.from("insights_breakdown").delete().eq("ad_account_id", act);
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await sb.from("insights_breakdown").upsert(rows.slice(i, i + 500), { onConflict: "ad_account_id,campaign_id,dim,key" });
    if (error) throw new Error(`insights_breakdown: ${error.message}`);
  }
  return { account: act, rows: rows.length };
}

async function collect(sb: SupabaseClient, accountId?: string, clientId?: string) {
  let q = sb.from("ad_accounts").select("id, account_status, clients!inner(id, active)").eq("clients.active", true);
  if (accountId) q = q.eq("id", accountId);
  if (clientId) q = q.eq("client_id", clientId);
  const { data } = await q;
  const results: Json[] = [], errors: Json[] = [];
  const queue = [...(data ?? [])];
  await Promise.all(Array.from({ length: 3 }, async () => {
    for (let a = queue.shift(); a; a = queue.shift()) {
      try { results.push(await collectAccount(sb, a.id)); }
      catch (e) { errors.push({ account: a.id, error: e instanceof Error ? e.message : String(e) }); }
    }
  }));
  return { results, errors };
}

// ================= 2) análise: funil, gargalos, recortes =================
interface Totals { spend: number; impressions: number; reach: number; video3s: number; clicks: number; lpv: number; cart: number; checkout: number; result: number; replies: number; value: number }
const zero = (): Totals => ({ spend: 0, impressions: 0, reach: 0, video3s: 0, clicks: 0, lpv: 0, cart: 0, checkout: 0, result: 0, replies: 0, value: 0 });

function addRow(t: Totals, r: Json, k: Kind) {
  const actions = r.actions as Action[] | undefined;
  t.spend += num(r.spend); t.impressions += num(r.impressions); t.reach += num(r.reach);
  t.video3s += num(r.video_views); t.clicks += num(r.link_clicks);
  t.lpv += actionVal(actions, A.lpv); t.cart += num(r.add_to_cart) || actionVal(actions, A.cart);
  t.checkout += num(r.checkouts) || actionVal(actions, A.checkout); t.replies += actionVal(actions, A.reply);
  t.result += k === "purchase" ? num(r.purchases) : k === "conversation" ? num(r.conversations) : k === "lead" ? num(r.leads) : num(r.link_clicks);
  t.value += num(r.purchase_value);
}

interface Step { id: string; label: string; from: string; to: string; rate: number | null; bench: number | null; volume: number; index: number | null }

// Etapas do funil por tipo de resultado (taxa = etapa ÷ etapa anterior)
function funnelSteps(t: Totals, b: Totals, k: Kind, isVideo: boolean): Step[] {
  const r = (a: number, d: number) => (d > 0 ? a / d : null);
  const mk = (id: string, label: string, from: string, to: string, a: number, d: number, ba: number, bd: number): Step => {
    const rate = r(a, d), bench = r(ba, bd);
    // suavização: pouco volume puxa para a referência (evita "gargalo" por acaso)
    const prior = 30;
    const smooth = rate !== null && bench !== null ? (a + prior * bench) / (d + prior) : rate;
    return { id, label, from, to, rate, bench, volume: d, index: smooth !== null && bench ? smooth / bench : null };
  };
  const steps: Step[] = [];
  if (isVideo) steps.push(mk("hook", "Atenção (pararam 3 s)", "Impressões", "Visualizações de 3 s", t.video3s, t.impressions, b.video3s, b.impressions));
  steps.push(mk("ctr", "Clique (CTR)", "Impressões", "Cliques no link", t.clicks, t.impressions, b.clicks, b.impressions));
  if (k === "conversation") {
    steps.push(mk("conv", "Clique → conversa", "Cliques no link", "Conversas iniciadas", t.result, t.clicks, b.result, b.clicks));
  } else if (k === "lead") {
    steps.push(mk("lead", "Clique → lead", "Cliques no link", "Leads", t.result, t.clicks, b.result, b.clicks));
  } else if (k === "purchase") {
    if (t.lpv || b.lpv) {
      steps.push(mk("lpv", "Clique → página carregada", "Cliques no link", "Visualizações da página", t.lpv, t.clicks, b.lpv, b.clicks));
      steps.push(mk("cart", "Página → carrinho", "Visualizações da página", "Adições ao carrinho", t.cart, t.lpv, b.cart, b.lpv));
    } else {
      steps.push(mk("cart", "Clique → carrinho", "Cliques no link", "Adições ao carrinho", t.cart, t.clicks, b.cart, b.clicks));
    }
    steps.push(mk("checkout", "Carrinho → checkout", "Adições ao carrinho", "Checkouts iniciados", t.checkout, t.cart, b.checkout, b.cart));
    steps.push(mk("buy", "Checkout → compra", "Checkouts iniciados", "Compras", t.result, t.checkout, b.result, b.checkout));
  } else if (k === "click" && (t.lpv || b.lpv)) {
    steps.push(mk("lpv", "Clique → página carregada", "Cliques no link", "Visualizações da página", t.lpv, t.clicks, b.lpv, b.clicks));
  }
  return steps;
}

const STEP_FIX: Record<string, string[]> = {
  hook: [
    "Trocar os 3 primeiros segundos dos vídeos: abrir com o resultado, uma pergunta direta ou o problema do cliente.",
    "Modelar os criativos com melhor gancho da página Criativos e pausar os que menos seguram atenção.",
  ],
  ctr: [
    "Deixar a oferta explícita na peça (preço, condição, benefício) e reforçar a chamada para ação no fim e no texto.",
    "Testar 2–3 novas variações de criativo com promessas diferentes; manter só a de melhor CTR.",
    "Revisar posicionamentos com CTR baixo (Audience Network, Marketplace) e concentrar a verba nos que convertem.",
  ],
  conv: [
    "Clique sem conversa costuma ser atrito no WhatsApp: conferir se o número abre direto, configurar mensagem de boas-vindas e perguntas frequentes.",
    "Ajustar a mensagem pré-preenchida do anúncio para algo que a pessoa queira enviar (ex.: \"Quero saber o valor\").",
    "Alinhar a promessa do anúncio com o que é respondido no atendimento; checar tempo de resposta.",
  ],
  lead: [
    "Simplificar o formulário (menos campos, perguntas de múltipla escolha) e deixar a oferta clara na tela de introdução.",
    "Testar formulário de maior intenção somente se o volume estiver alto e a qualidade baixa.",
  ],
  lpv: [
    "Muitos cliques não chegam a carregar a página: verificar velocidade no celular, redirecionamentos e se o pixel está instalado na página de destino.",
  ],
  cart: [
    "Visitantes não adicionam ao carrinho: revisar preço, fotos, frete visível e a coerência entre anúncio e produto da página.",
  ],
  checkout: [
    "Carrinho abandonado: mostrar frete cedo, reduzir etapas e lançar remarketing para quem adicionou ao carrinho.",
  ],
  buy: [
    "Checkout sem compra: revisar meios de pagamento (Pix), erros no checkout e campanhas de remarketing de checkout iniciado.",
  ],
};

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

const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return ymd(d); };

async function analyze(sb: SupabaseClient, clientId: string, days: number, range?: { since: string; until: string }) {
  const until = range?.until ?? brDate(-1), since = range?.since ?? brDate(-days);
  if (range) days = Math.round((Date.parse(until) - Date.parse(since)) / 86400_000) + 1;
  const bSince = addDays(until, -89);  // referência: os 90 dias do próprio cliente até o fim do período
  const { data: client } = await sb.from("clients").select("id, name, objective, monthly_budget, ad_accounts(id)").eq("id", clientId).single();
  if (!client) throw new Error("Cliente não encontrado");
  const accIds = ((client.ad_accounts as { id: string }[]) ?? []).map((a) => a.id);
  if (!accIds.length) throw new Error("Cliente sem conta de anúncios");

  const [campaigns, rows, bd, strategy] = await Promise.all([
    selectAll<Json>((f) => sb.from("campaigns").select("id, name, objective, effective_status, daily_budget, ad_account_id").in("ad_account_id", accIds).range(f, f + 999)),
    selectAll<Json>((f) => sb.from("insights_daily")
      .select("object_id, date, spend, impressions, reach, link_clicks, video_views, conversations, leads, purchases, purchase_value, add_to_cart, checkouts, actions")
      .eq("level", "campaign").in("ad_account_id", accIds).gte("date", bSince).lte("date", until).order("date").order("object_id").range(f, f + 999)),
    selectAll<Json>((f) => sb.from("insights_breakdown").select("*").in("ad_account_id", accIds).range(f, f + 999)),
    sb.from("client_strategy").select("*").eq("client_id", clientId).maybeSingle().then((r) => r.data),
  ]);
  const campBy = new Map(campaigns.map((c) => [c.id as string, c]));

  // tipo de resultado do cliente
  let clientKind: Kind | null | undefined = EXPLICIT[client.objective as string];
  if (clientKind === undefined) {
    const t = { conversation: 0, lead: 0, purchase: 0 };
    for (const r of rows) { t.conversation += num(r.conversations); t.lead += num(r.leads); if (num(r.purchase_value) > 0) t.purchase += num(r.purchases); }
    const best = (Object.entries(t) as [Kind, number][]).sort((a, b) => b[1] - a[1])[0];
    clientKind = best[1] > 0 ? best[0] : null;
  }

  // agregados: período e referência (90 dias) por campanha e por tipo
  const cur = new Map<string, Totals>(), ref = new Map<Kind, Totals>(), prev = new Map<string, Totals>();
  const prevSince = addDays(since, -days), prevUntil = addDays(since, -1);
  for (const r of rows) {
    const c = campBy.get(r.object_id as string);
    const k = campaignKind(c?.objective as string, clientKind ?? null);
    if (!k) continue;
    const d = r.date as string;
    if (!ref.has(k)) ref.set(k, zero());
    addRow(ref.get(k)!, r, k);
    if (d >= since && d <= until) { if (!cur.has(r.object_id as string)) cur.set(r.object_id as string, zero()); addRow(cur.get(r.object_id as string)!, r, k); }
    else if (d >= prevSince && d <= prevUntil) { if (!prev.has(r.object_id as string)) prev.set(r.object_id as string, zero()); addRow(prev.get(r.object_id as string)!, r, k); }
  }

  // funil por campanha
  const funnels = [...cur.entries()].filter(([, t]) => t.spend > 0).map(([id, t]) => {
    const c = campBy.get(id)!;
    const k = campaignKind(c.objective as string, clientKind ?? null)!;
    const b = ref.get(k) ?? zero();
    const isVideo = t.video3s > t.impressions * 0.05;
    const steps = funnelSteps(t, b, k, isVideo);
    const enough = steps.filter((s) => s.index !== null && s.volume >= 100);
    const worst = enough.sort((x, y) => (x.index ?? 9) - (y.index ?? 9))[0];
    const bottleneck = worst && (worst.index ?? 1) < 0.85 ? worst : null;
    const p = prev.get(id);
    const cpr = t.result ? t.spend / t.result : null, bcpr = b.result ? b.spend / b.result : null;
    const cpm = t.impressions ? (t.spend / t.impressions) * 1000 : null, bcpm = b.impressions ? (b.spend / b.impressions) * 1000 : null;
    const freq = t.reach ? t.impressions / t.reach : null;
    const issues: { id: string; text: string; fixes: string[] }[] = [];
    if (bottleneck) issues.push({ id: bottleneck.id,
      text: `Gargalo em "${bottleneck.label}": ${pct(bottleneck.rate ?? 0, 2)} contra ${pct(bottleneck.bench ?? 0, 2)} na média do cliente (${Math.round((1 - (bottleneck.index ?? 1)) * 100)}% abaixo).`,
      fixes: STEP_FIX[bottleneck.id] ?? [] });
    if (cpm && bcpm && cpm > bcpm * 1.35 && t.impressions > 3000) issues.push({ id: "cpm",
      text: `Entrega cara: CPM de ${money(cpm)} contra ${money(bcpm)} na média do cliente.`,
      fixes: ["Ampliar o público (raio maior, Advantage+ público) ou reduzir sobreposição com outras campanhas do cliente.", "Verificar posicionamentos caros no raio-x e concentrar a verba nos mais baratos que convertem."] });
    if (freq && freq > 3 && days <= 14) issues.push({ id: "freq",
      text: `Frequência de ${freq.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} no período: o mesmo público está vendo muitas vezes.`,
      fixes: ["Renovar criativos (variações dos que funcionam) e ampliar o raio ou o público."] });
    return {
      campaign_id: id, name: c.name, objective: c.objective, kind: k, status: c.effective_status,
      spend: t.spend, result: t.result, cpr, bench_cpr: bcpr, value: t.value, roas: t.spend ? t.value / t.spend : null,
      cpm, bench_cpm: bcpm, frequency: freq,
      prev_cpr: p && p.result ? p.spend / p.result : null, prev_spend: p?.spend ?? 0,
      totals: t, steps, bottleneck: bottleneck?.id ?? null, issues,
    };
  }).sort((a, b) => b.spend - a.spend);

  // recortes (posicionamento, público, horário, conjuntos/região)
  const kindByCamp = (cid: string) => campaignKind(campBy.get(cid)?.objective as string, clientKind ?? null);
  const resOf = (r: Json, k: Kind) => k === "purchase" ? num(r.purchases) : k === "conversation" ? num(r.conversations) : k === "lead" ? num(r.leads) : num(r.link_clicks);
  const cuts: Record<string, { key: string; label: string; spend: number; impressions: number; clicks: number; result: number; cpr: number | null; share: number; index: number | null; extra?: unknown }[]> = {};
  const mainKind = clientKind ?? "click";
  for (const dim of ["placement", "age_gender", "hour", "adset", "region"]) {
    const agg = new Map<string, { key: string; label: string; spend: number; impressions: number; clicks: number; result: number; extra?: unknown }>();
    for (const r of bd.filter((x) => x.dim === dim)) {
      const k = kindByCamp(r.campaign_id as string);
      if (k !== mainKind) continue;
      const key = r.key as string;
      const e = agg.get(key) ?? { key, label: r.label as string, spend: 0, impressions: 0, clicks: 0, result: 0, extra: r.extra };
      e.spend += num(r.spend); e.impressions += num(r.impressions); e.clicks += num(r.link_clicks); e.result += resOf(r, k);
      agg.set(key, e);
    }
    const list = [...agg.values()].filter((x) => x.spend > 0);
    const tSpend = list.reduce((t, x) => t + x.spend, 0), tRes = list.reduce((t, x) => t + x.result, 0);
    const avg = tRes ? tSpend / tRes : null;
    cuts[dim] = list.map((x) => {
      const cpr = x.result ? x.spend / x.result : null;
      // índice suavizado: >1 = mais barato que a média
      const smooth = avg ? (x.spend + 2 * avg) / (x.result + 2) : null;
      return { ...x, cpr, share: tSpend ? x.spend / tSpend : 0, index: smooth && avg ? avg / smooth : null };
    }).sort((a, b) => (dim === "hour" ? Number(a.key) - Number(b.key) : b.spend - a.spend));
  }

  // leituras dos recortes
  const insights: { area: string; text: string; action: string }[] = [];
  const K = KIND_TXT[mainKind];
  const plc = cuts.placement ?? [];
  const avgPlc = (() => { const s = plc.reduce((t, x) => t + x.spend, 0), r = plc.reduce((t, x) => t + x.result, 0); return r ? s / r : null; })();
  const winners = plc.filter((x) => x.result >= 5 && (x.index ?? 0) >= 1.15).slice(0, 3);
  const losers = plc.filter((x) => x.share >= 0.08 && (x.index ?? 9) <= 0.7);
  if (winners.length && avgPlc) insights.push({ area: "Posicionamentos",
    text: `Melhores posicionamentos: ${winners.map((w) => `${w.label} (${money(w.cpr ?? 0)} por ${K.one}, ${w.result} resultados)`).join(", ")}. Média de todos: ${money(avgPlc)}. Confiança ${conf(winners.reduce((t, w) => t + w.result, 0))}.`,
    action: "Priorizar esses posicionamentos nas próximas campanhas." });
  for (const l of losers) insights.push({ area: "Posicionamentos",
    text: `${l.label} consome ${pct(l.share, 0)} da verba com ${l.result ? `${money(l.cpr ?? 0)} por ${K.one}` : `nenhuma ${K.one}`}.`,
    action: `Excluir ou reduzir ${l.label} nas novas campanhas.` });

  const ag = cuts.age_gender ?? [];
  const agBest = ag.filter((x) => x.result >= 5 && (x.index ?? 0) >= 1.2).slice(0, 3);
  const agWorst = ag.filter((x) => x.share >= 0.08 && (x.index ?? 9) <= 0.65);
  if (agBest.length) insights.push({ area: "Público", text: `Público que mais responde: ${agBest.map((x) => `${x.label} (${money(x.cpr ?? 0)})`).join(", ")}.`, action: "Usar esses perfis como referência de criativo e texto (linguagem, dores, exemplos)." });
  for (const x of agWorst) insights.push({ area: "Público", text: `${x.label}: ${pct(x.share, 0)} da verba com custo bem acima da média.`, action: `Avaliar restringir a faixa etária/gênero para cortar ${x.label}.` });

  const hr = cuts.hour ?? [];
  if (hr.length >= 12) {
    // só horas com volume (3+ resultados) contam como "melhores"; evita destacar acaso
    const ordered = [...hr].filter((x) => x.result >= 3).sort((a, b) => (b.index ?? 0) - (a.index ?? 0));
    const top = ordered.slice(0, 4).map((x) => x.label).join(", ");
    const dead = hr.filter((x) => x.share >= 0.03 && x.result === 0).map((x) => x.label);
    if (top) insights.push({ area: "Horário", text: `Horas com resultado mais barato: ${top}.${dead.length ? ` Sem resultado: ${dead.join(", ")}.` : ""}`,
      action: mainKind === "conversation" ? "Garantir atendimento rápido no WhatsApp nesses horários; em campanha com orçamento total, programar a veiculação." : "Considerar programação de veiculação (exige orçamento total na campanha)." });
  }

  const sets = cuts.adset ?? [];
  const setWorst = sets.filter((x) => x.share >= 0.1 && (x.index ?? 9) <= 0.7);
  const setBest = sets.filter((x) => x.result >= 5 && (x.index ?? 0) >= 1.2).slice(0, 2);
  if (setBest.length) insights.push({ area: "Regiões e públicos", text: `Conjuntos mais eficientes: ${setBest.map((x) => `${x.label} (${money(x.cpr ?? 0)})`).join("; ")}.`, action: "Usar essa segmentação como base das próximas campanhas." });
  for (const x of setWorst) insights.push({ area: "Regiões e públicos", text: `${x.label}: ${pct(x.share, 0)} da verba com custo ${x.cpr ? money(x.cpr) : "sem resultado"}.`, action: "Rever cidades/raio desse conjunto ou mover a verba para o conjunto mais eficiente." });

  // resumo geral
  const all = zero();
  for (const f of funnels) for (const k of Object.keys(all) as (keyof Totals)[]) all[k] += f.totals[k];
  const allPrev = zero();
  for (const [, t] of prev) for (const k of Object.keys(allPrev) as (keyof Totals)[]) allPrev[k] += t[k];

  return {
    client: { id: client.id, name: client.name, objective: client.objective, kind: clientKind },
    since, until, days, strategy,
    summary: {
      spend: all.spend, result: all.result, cpr: all.result ? all.spend / all.result : null, value: all.value,
      roas: all.spend ? all.value / all.spend : null, impressions: all.impressions, clicks: all.clicks,
      prev_spend: allPrev.spend, prev_result: allPrev.result, prev_cpr: allPrev.result ? allPrev.spend / allPrev.result : null,
      bench_cpr: (() => { const b = ref.get(mainKind); return b && b.result ? b.spend / b.result : null; })(),
    },
    funnels, cuts, insights,
  };
}

// ================= 3) leitura estratégica com IA =================
async function aiAnalysis(sb: SupabaseClient, clientId: string, days: number, who: string) {
  if (!ANTHROPIC_KEY) throw new Error("Falta o segredo ANTHROPIC_API_KEY no Supabase para a análise com IA.");
  const a = await analyze(sb, clientId, days);
  const compact = {
    cliente: a.client.name, objetivo: a.client.objective, resultado_principal: a.client.kind, periodo: `${a.since} a ${a.until}`,
    resumo: a.summary,
    campanhas: a.funnels.map((f) => ({ nome: f.name, status: f.status, objetivo_meta: f.objective, gasto: f.spend, resultados: f.result, custo: f.cpr,
      custo_ref_90d: f.bench_cpr, custo_periodo_anterior: f.prev_cpr, cpm: f.cpm, frequencia: f.frequency, roas: f.roas,
      funil: f.steps.map((s) => ({ etapa: s.label, taxa: s.rate, ref: s.bench, volume: s.volume })), alertas: f.issues.map((i) => i.text) })),
    posicionamentos: (a.cuts.placement ?? []).slice(0, 12).map((x) => ({ nome: x.label, gasto: x.spend, resultados: x.result, custo: x.cpr, parte_da_verba: x.share })),
    publico: (a.cuts.age_gender ?? []).slice(0, 14).map((x) => ({ nome: x.label, gasto: x.spend, resultados: x.result, custo: x.cpr })),
    conjuntos_regioes: (a.cuts.adset ?? []).slice(0, 10).map((x) => ({ nome: x.label, gasto: x.spend, resultados: x.result, custo: x.cpr })),
    horas: (a.cuts.hour ?? []).map((x) => ({ h: x.key, gasto: x.spend, resultados: x.result })),
    leituras_automaticas: a.insights,
    perfil: a.strategy ? { regioes: (a.strategy.regions as Json[] | null)?.map((r) => `${r.name} +${r.radius_km}km`), idade: [a.strategy.age_min, a.strategy.age_max], verba_diaria: a.strategy.daily_budget, notas: a.strategy.notes } : null,
  };
  const system = `Você é o gestor de tráfego pago sênior (Meta Ads) responsável pelas contas de uma agência brasileira que atende negócios locais e regionais. ` +
    `O dono da agência vai cuidar de estratégia e relacionamento; você responde pela performance. Seja crítico e rigoroso — não suavize problemas. ` +
    `Regras: (1) toda afirmação cita números dos dados e compara com a referência de 90 dias do próprio cliente ou com o período anterior; ` +
    `(2) classifique a confiança de cada conclusão pelo volume de resultados: 30+ = alta, 10–29 = média, menos de 10 = baixa — e com confiança baixa NÃO recomende escalar nem cortar, recomende coletar mais dados; ` +
    `(3) diferencie variação real de ruído: menos de 15% de diferença com volume pequeno é ruído; ` +
    `(4) aponte erros de estrutura (verba pulverizada em muitos conjuntos, público pequeno demais, um criativo carregando tudo, posicionamento caro consumindo verba, frequência alta); ` +
    `(5) se a campanha está ruim, diga claramente e diga o que fazer; se está boa, diga o que pode quebrar; ` +
    `(6) nada de conselhos genéricos: cada ação diz o que mudar, onde e quanto. Se faltar dado para concluir algo, diga qual dado falta. ` +
    `Escreva em português do Brasil, direto. Responda SOMENTE com JSON válido no formato: ` +
    `{"resumo": string (3-4 frases, com o veredito: a conta está saudável, em atenção ou em risco), "nota_saude": number 0-10, ` +
    `"gargalos": [{"titulo": string, "evidencia": string, "causa_provavel": string, "acao": string, "impacto": "alto"|"medio"|"baixo", "confianca": "alta"|"media"|"baixa"}], ` +
    `"oportunidades": [{"titulo": string, "evidencia": string, "acao": string, "confianca": "alta"|"media"|"baixa"}], "plano_7_dias": [string], "testes": [{"hipotese": string, "como_testar": string, "metrica": string}], ` +
    `"estrutura_recomendada": {"campanhas": string, "posicionamentos": string, "segmentacao": string, "orcamento": string, "criativos": string}}`;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: AI_MODEL, max_tokens: 4000, system, messages: [{ role: "user", content: `Dados do cliente:\n${JSON.stringify(compact)}` }] }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`IA: ${j.error?.message ?? res.status}`);
  const text = ((j.content as { type: string; text?: string }[]) ?? []).filter((c) => c.type === "text").map((c) => c.text).join("");
  const jsonText = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  let parsed: Json;
  try { parsed = JSON.parse(jsonText); } catch { throw new Error("A IA não devolveu um JSON válido. Tente de novo."); }
  const { data: row } = await sb.from("strategy_reports").insert({ client_id: clientId, since: a.since, until: a.until, analysis: parsed, model: j.model ?? AI_MODEL, created_by: who })
    .select("id, created_at").single();
  return { id: row?.id, created_at: row?.created_at, analysis: parsed, model: j.model ?? AI_MODEL };
}

// ================= 4) plano de lançamento =================
// Parte da melhor campanha do cliente (ou da escolhida no perfil), que já tem página, Instagram, WhatsApp e pixel;
// aplica regiões/idade do perfil, os posicionamentos vencedores e a verba; criativos novos vêm da biblioteca.
const POSITION_FIELD: Record<string, string> = { facebook: "facebook_positions", instagram: "instagram_positions", messenger: "messenger_positions", audience_network: "audience_network_positions" };

async function planLaunch(sb: SupabaseClient, body: Json, _who: string) {
  const clientId = String(body.client_id ?? "");
  const a = await analyze(sb, clientId, 30);
  const st = (a.strategy ?? {}) as Json;
  const kind = a.client.kind as Kind | null;
  if (!kind) throw new Error("Defina o objetivo do cliente em Configurações para lançar campanhas.");

  // campanha-modelo: a escolhida no perfil, ou a de menor custo por resultado com volume (orçamento diário)
  const { data: camps } = await sb.from("campaigns").select("id, name, objective, daily_budget, ad_account_id")
    .in("id", a.funnels.map((f) => f.campaign_id).concat(st.source_campaign_id ? [String(st.source_campaign_id)] : []));
  const byId = new Map((camps ?? []).map((c) => [c.id, c]));
  let source = st.source_campaign_id ? byId.get(String(st.source_campaign_id)) : undefined;
  let sourceWhy = "escolhida no perfil do cliente";
  if (!source) {
    const ranked = a.funnels.filter((f) => f.kind === kind && f.result >= 5 && f.cpr).sort((x, y) => (x.cpr ?? 1e9) - (y.cpr ?? 1e9));
    const best = ranked[0] ?? a.funnels.filter((f) => f.kind === kind && f.result > 0).sort((x, y) => y.result - x.result)[0];
    if (!best) throw new Error("Não há campanha com resultado nos últimos 30 dias para usar como modelo. Escolha uma campanha-modelo no perfil.");
    source = byId.get(best.campaign_id);
    sourceWhy = `melhor custo por ${KIND_TXT[kind].one} dos últimos 30 dias (${money(best.cpr ?? 0)}, ${best.result} ${KIND_TXT[kind].many})`;
  }
  if (!source) throw new Error("Campanha-modelo não encontrada.");

  // posicionamentos
  const mode = String(st.placements_mode ?? "winners");
  let placements: Json | null = null;
  let placementsWhy = "mantidos como na campanha-modelo";
  if (mode === "advantage") { placements = { advantage: true }; placementsWhy = "posicionamentos Advantage+ (o Meta distribui)"; }
  else if (mode === "winners") {
    const plc = (a.cuts.placement ?? []).filter((x) => x.result >= 2 && (x.index ?? 0) >= 0.9);
    if (plc.filter((p) => TARGET_POSITION[p.key]).length >= 2) {
      const map: Record<string, string[]> = {};
      for (const p of plc) {
        const [pub] = p.key.split("|");
        const pos = TARGET_POSITION[p.key];
        if (pos && POSITION_FIELD[pub] && !(map[pub] ?? []).includes(pos)) (map[pub] ??= []).push(pos);
      }
      // feeds sempre incluídos: dão escala e o Meta exige ao menos um posicionamento principal em vários objetivos
      if (map.facebook && !map.facebook.includes("feed")) map.facebook.push("feed");
      if (map.instagram && !map.instagram.includes("stream")) map.instagram.push("stream");
      placements = { publisher_platforms: Object.keys(map), ...Object.fromEntries(Object.entries(map).map(([pub, pos]) => [POSITION_FIELD[pub], pos]).filter(([f]) => f)) };
      placementsWhy = `só os que entregam ${KIND_TXT[kind].many} a custo na média ou melhor: ${plc.map((p) => p.label).join(", ")}`;
    } else placementsWhy = "dados insuficientes por posicionamento; mantidos como na campanha-modelo";
  }

  // regiões e público
  const regions = ((st.regions as Json[] | undefined) ?? []).filter((r) => r.key);
  // o Meta aceita raio de 17 a 80 km para cidades
  const radius = (r: Json) => Math.min(80, Math.max(17, Number(r.radius_km ?? 17)));
  const geo = regions.length ? { cities: regions.map((r) => ({ key: String(r.key), radius: radius(r), distance_unit: "kilometer" })) } : null;
  const audience = { ...(st.age_min ? { age_min: st.age_min } : {}), ...(st.age_max ? { age_max: st.age_max } : {}), ...((st.genders as number[] | undefined)?.length ? { genders: st.genders } : {}) };

  const budget = Number(body.daily_budget ?? st.daily_budget ?? source.daily_budget ?? 0) || null;
  const assets = Array.isArray(body.asset_ids) ? (body.asset_ids as string[]) : [];
  const { data: settings } = await sb.from("autopilot_settings").select("level").eq("client_id", clientId).maybeSingle();
  const activate = body.activate === true || (body.activate !== false && Number(settings?.level ?? 0) >= 2);

  const today = brDate(0).split("-").reverse().slice(0, 2).join("/");
  const name = String(body.name ?? `[IMPACTO] ${a.client.name} | ${KIND_TXT[kind].many} | ${today}`);
  const params = { source_campaign_id: source.id, name, geo, audience, placements, daily_budget: budget, asset_ids: assets, activate };
  const reason = [
    `Modelo: "${source.name}" — ${sourceWhy}.`,
    `Regiões: ${regions.length ? regions.map((r) => `${r.name} +${radius(r)} km`).join(", ") : "as mesmas da campanha-modelo (defina no perfil para mudar)"}.`,
    `Posicionamentos: ${placementsWhy}.`,
    `Verba: ${budget ? `${money(budget)}/dia` : "a mesma da campanha-modelo"}.`,
    `Criativos: os anúncios da campanha-modelo${assets.length ? ` + ${assets.length} novo(s) da biblioteca` : ""}.`,
    activate ? "Sobe ativa (cliente em Autônomo ou ativação escolhida)." : "Sobe pausada até a aprovação.",
  ].join(" ");

  const { data: row, error } = await sb.from("autopilot_actions").insert({
    client_id: clientId, ad_account_id: source.ad_account_id, rule: "launch_campaign", kind: "launch_campaign", protective: false,
    object_type: "campaign", object_id: source.id, object_name: name, campaign_name: source.name,
    title: `Lançar campanha "${name}"`, reason, evidence: { modelo: source.name, motivo_modelo: sourceWhy }, params,
    status: "proposed",
  }).select("*").single();
  if (error) throw new Error(error.message);
  return { action: row, plan: params, reason };
}


// ================= 5) relatórios automáticos =================
// Semanal (texto para o grupo do WhatsApp) e mensal (base dos slides). Números vêm do banco e do Meta;
// o texto ao cliente é direto e verificável; as críticas ficam em "internal", só para a equipe.
const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const MON = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const dm = (iso: string) => `${Number(iso.slice(8))}/${MON[Number(iso.slice(5, 7)) - 1]}`;
const intBR = (v: number) => Math.round(v).toLocaleString("pt-BR");
const CLIENT_TXT: Record<Kind, { many: string; one: string; per: string }> = {
  conversation: { many: "conversas no WhatsApp", one: "conversa", per: "por conversa" },
  lead: { many: "cadastros (leads)", one: "cadastro", per: "por cadastro" },
  purchase: { many: "vendas no site", one: "venda", per: "por venda" },
  click: { many: "cliques no link", one: "clique", per: "por clique" },
};
const confidence = (n: number) => (n >= 30 ? "alta" : n >= 10 ? "média" : "baixa");

async function periodReach(accIds: string[], since: string, until: string) {
  let reach = 0, impressions = 0, ok = true;
  for (const act of accIds) {
    try {
      const r = await graph(`${act}/insights`, { fields: "reach,impressions", time_range: JSON.stringify({ since, until }), ...ATTRIBUTION });
      const row = ((r.data as Json[]) ?? [])[0];
      reach += num(row?.reach); impressions += num(row?.impressions);
    } catch { ok = false; }
  }
  return { reach: ok ? reach : null, impressions, frequency: ok && reach ? impressions / reach : null };
}

async function adsOfPeriod(sb: SupabaseClient, accIds: string[], since: string, until: string, kind: Kind) {
  const rows = await selectAll<Json>((f) => sb.from("insights_daily").select("object_id, campaign_id, spend, impressions, link_clicks, conversations, leads, purchases, purchase_value")
    .eq("level", "ad").in("ad_account_id", accIds).gte("date", since).lte("date", until).order("object_id").order("date").range(f, f + 999));
  const agg = new Map<string, { id: string; spend: number; result: number; impressions: number; clicks: number; value: number }>();
  for (const r of rows) {
    const id = r.object_id as string;
    const e = agg.get(id) ?? { id, spend: 0, result: 0, impressions: 0, clicks: 0, value: 0 };
    e.spend += num(r.spend); e.impressions += num(r.impressions); e.clicks += num(r.link_clicks); e.value += num(r.purchase_value);
    e.result += kind === "purchase" ? num(r.purchases) : kind === "conversation" ? num(r.conversations) : kind === "lead" ? num(r.leads) : num(r.link_clicks);
    agg.set(id, e);
  }
  const ids = [...agg.keys()];
  const info = new Map<string, Json>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await sb.from("ads").select("id, name, effective_status, image_url, thumbnail_url, campaign_id, adset_id").in("id", ids.slice(i, i + 200));
    for (const a of data ?? []) info.set(a.id, a);
  }
  return [...agg.values()].filter((x) => x.spend > 0).map((x) => {
    const a = info.get(x.id) ?? {};
    return { ...x, name: (a.name as string) ?? "Anúncio", status: (a.effective_status as string) ?? null,
      image_url: (a.image_url as string) ?? (a.thumbnail_url as string) ?? null, cpr: x.result ? x.spend / x.result : null };
  }).sort((a, b) => b.result - a.result || (a.cpr ?? 1e9) - (b.cpr ?? 1e9));
}

async function actionsOfPeriod(sb: SupabaseClient, clientId: string, since: string, until: string) {
  const { data } = await sb.from("autopilot_actions").select("rule, kind, object_type, object_name, campaign_name, title, evidence, params, result, executed_at, auto")
    .eq("client_id", clientId).eq("status", "done").gte("executed_at", `${since}T03:00:00Z`).lt("executed_at", `${addDays(until, 1)}T03:00:00Z`)
    .order("executed_at");
  return data ?? [];
}

function actionForClient(a: Json, k: Kind | null): string | null {
  const K = k ? CLIENT_TXT[k] : null;
  const ev = (a.evidence as Json) ?? {};
  const label = a.object_type === "ad" ? "o anúncio" : a.object_type === "adset" ? "o público" : "a campanha";
  const n = `"${a.object_name}"`;
  if (a.kind === "pause") {
    if (a.rule === "pause_no_result" && K) return `Pausamos ${label} ${n}, que gastou ${money(num(ev.gasto))} sem gerar ${K.one}s, para concentrar a verba no que funciona.`;
    if (a.rule === "pause_expensive" && K) return `Pausamos ${label} ${n} (${money(num(ev.custo))} ${K.per}, acima da média) e passamos a verba para os anúncios mais eficientes.`;
    return `Pausamos ${label} ${n}.`;
  }
  if (a.kind === "activate") return `Reativamos ${label} ${n}.`;
  if (a.kind === "set_budget") {
    if (a.rule === "scale_up") return `Aumentamos a verba de ${n}, que estava trazendo resultado abaixo do custo médio.`;
    if (a.rule === "scale_down") return `Reduzimos a verba de ${n} até o custo voltar à média.`;
    if (a.rule === "monthly_cap") return `Ajustamos a verba de ${n} para respeitar o investimento do mês.`;
    return `Ajustamos a verba de ${n}.`;
  }
  if (a.kind === "create_ad") return `Colocamos no ar um criativo novo${a.campaign_name ? ` na campanha "${a.campaign_name}"` : ""}.`;
  if (a.kind === "launch_campaign") return `Lançamos a campanha ${n}.`;
  return null;
}

type Note = { level: "alto" | "medio" | "baixo"; text: string };

async function buildReport(sb: SupabaseClient, clientId: string, since: string, until: string, kindOfReport: "weekly" | "monthly") {
  const a = await analyze(sb, clientId, 7, { since, until });
  const { data: client } = await sb.from("clients").select("name, objective, monthly_budget, ad_accounts(id, account_status)").eq("id", clientId).single();
  const accIds = ((client?.ad_accounts as { id: string; account_status: number | null }[]) ?? []).map((x) => x.id);
  const kind = a.client.kind as Kind | null;
  const sm = a.summary;
  if (sm.spend < 1) return null;   // sem investimento no período: não gera relatório
  const [reach, ads, done, settings, pending] = await Promise.all([
    periodReach(accIds, since, until),
    adsOfPeriod(sb, accIds, since, until, kind ?? "click"),
    actionsOfPeriod(sb, clientId, since, until),
    sb.from("autopilot_settings").select("target_cost, level").eq("client_id", clientId).maybeSingle().then((r) => r.data),
    sb.from("autopilot_actions").select("id", { count: "exact", head: true }).eq("client_id", clientId).eq("status", "proposed").then((r) => r.count ?? 0),
  ]);
  const K = CLIENT_TXT[kind ?? "click"];
  const word = kindOfReport === "weekly" ? "semana" : "mês";
  const prevWord = kindOfReport === "weekly" ? "na semana anterior" : "no mês anterior";
  const chg = (now: number | null, prev: number | null) => (now !== null && prev ? (now - prev) / prev : null);
  const resChg = chg(sm.result, sm.prev_result), cprChg = chg(sm.cpr, sm.prev_cpr);

  // ---- texto para o cliente ----
  const lines: string[] = [];
  const title = kindOfReport === "weekly" ? "Relatório semanal" : "Relatório mensal";
  lines.push(`*${title} · ${a.client.name}*`, `${dm(since)} a ${dm(until)}`, "");
  lines.push(`*Resultados da ${word}*`);
  lines.push(`• ${intBR(sm.result)} ${K.many}${resChg !== null && Math.abs(resChg) >= 0.03 ? ` (${Math.abs(Math.round(resChg * 100))}% ${resChg > 0 ? "a mais" : "a menos"} que ${prevWord})` : ""}`);
  if (sm.cpr !== null) lines.push(`• ${money(sm.cpr)} ${K.per}${cprChg !== null && Math.abs(cprChg) >= 0.03 ? ` (${Math.abs(Math.round(cprChg * 100))}% ${cprChg < 0 ? "mais barato" : "mais caro"} que ${prevWord})` : ""}`);
  if (kind === "purchase" && sm.value > 0) lines.push(`• ${money(sm.value)} em vendas · retorno de ${(sm.roas ?? 0).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}x o investimento`);
  lines.push(`• ${money(sm.spend)} investidos`);
  if (reach.reach) lines.push(`• ${intBR(reach.reach)} pessoas alcançadas`);

  const top = ads.filter((x) => x.result > 0)[0];
  if (top && sm.result > 0 && kind) {
    const share = top.result / sm.result;
    lines.push("", "*Destaque*");
    lines.push(`O anúncio "${top.name}" trouxe ${intBR(top.result)} ${top.result === 1 ? K.one : K.many.split(" ")[0]}${share >= 0.3 && share < 1 ? ` (${Math.round(share * 100)}% do total)` : ""}, a ${money(top.cpr ?? 0)} cada.`);
  }

  const did = done.map((x) => actionForClient(x, kind)).filter(Boolean) as string[];
  if (did.length) {
    lines.push("", "*O que fizemos*");
    for (const d of did.slice(0, 5)) lines.push(`• ${d}`);
  }

  const next: string[] = [];
  const main = a.funnels[0];
  const bn = main?.bottleneck;
  if (bn === "hook" || bn === "ctr") next.push("Produzir novos criativos com um começo mais forte para aumentar os cliques.");
  if (bn === "conv") next.push("Ajustar o texto do anúncio e a primeira mensagem do WhatsApp para transformar mais cliques em conversas.");
  if (bn === "lead") next.push("Simplificar o formulário para converter mais cliques em cadastros.");
  if (["lpv", "cart", "checkout", "buy"].includes(bn ?? "")) next.push("Revisar a página e o checkout do site, onde estamos perdendo compradores.");
  if (cprChg !== null && cprChg > 0.15 && !next.length) next.push("Renovar criativos e revisar a segmentação para trazer o custo de volta.");
  if ((reach.frequency ?? 0) > (kindOfReport === "weekly" ? 2.5 : 4)) next.push("Trazer criativos novos para o público não se cansar dos mesmos anúncios.");
  if (cprChg !== null && cprChg < -0.1 && sm.result >= 10) next.push("Aumentar a verba aos poucos nas campanhas mais eficientes.");
  if (!next.length) next.push("Manter o que está funcionando e seguir testando criativos novos.");
  lines.push("", "*Próximos passos*");
  for (const x of [...new Set(next)].slice(0, 3)) lines.push(`• ${x}`);
  lines.push("", "_Impacto · gestão de tráfego_");

  // ---- críticas internas (rigor: amostra, referência, verba parada, decisões pendentes) ----
  const notes: Note[] = [];
  if (!client?.objective || client.objective === "a_definir") notes.push({ level: "medio", text: "Objetivo do cliente não definido: o sistema está deduzindo o resultado. Defina em Configurações para análises e piloto mais precisos." });
  if (kind && sm.result < 10) notes.push({ level: "medio", text: `Amostra pequena: ${sm.result} ${K.many} no período (confiança ${confidence(sm.result)}). Não decidir escala ou corte só por esse custo.` });
  if (sm.cpr !== null && sm.bench_cpr && sm.cpr > sm.bench_cpr * 1.25)
    notes.push({ level: "alto", text: `Custo ${K.per} de ${money(sm.cpr)} está ${Math.round((sm.cpr / sm.bench_cpr - 1) * 100)}% acima da média de 90 dias (${money(sm.bench_cpr)}).` });
  const target = settings?.target_cost ? Number(settings.target_cost) : null;
  if (target && sm.cpr !== null && sm.cpr > target * 1.15) notes.push({ level: "alto", text: `Fora da meta: ${money(sm.cpr)} ${K.per} contra a meta de ${money(target)}.` });
  if (cprChg !== null && cprChg > 0.2 && sm.result >= 10) notes.push({ level: "alto", text: `Custo subiu ${Math.round(cprChg * 100)}% contra o período anterior com volume suficiente para ser real (${sm.result} resultados).` });
  if (sm.result === 0 && kind) notes.push({ level: "alto", text: `Nenhum resultado com ${money(sm.spend)} investidos. Revisar rastreamento e oferta antes de seguir gastando.` });
  for (const f of a.funnels.filter((x) => sm.spend && x.spend / sm.spend >= 0.15)) for (const i of f.issues) notes.push({ level: "medio", text: `${f.name}: ${i.text} → ${i.fixes[0] ?? ""}` });
  const ref = sm.cpr ?? sm.bench_cpr;
  for (const ad of ads.filter((x) => x.result === 0 && x.status === "ACTIVE" && x.spend >= Math.max(20, 2 * (ref ?? 15))).slice(0, 3))
    notes.push({ level: "alto", text: `Anúncio "${ad.name}" gastou ${money(ad.spend)} sem nenhum resultado e continua ativo.` });
  if (top && sm.result >= 5 && top.result / sm.result >= 0.7) notes.push({ level: "medio", text: `Dependência de um criativo: "${top.name}" fez ${Math.round((top.result / sm.result) * 100)}% dos resultados. Se ele cansar, o custo sobe — prepare substitutos.` });
  if (kindOfReport === "weekly" && client?.monthly_budget) {
    const today = brDate(0), m0 = `${today.slice(0, 7)}-01`;
    const { data: ms } = await sb.from("insights_daily").select("spend").eq("level", "account").in("object_id", accIds).gte("date", m0).lte("date", until);
    const spent = (ms ?? []).reduce((t, r) => t + num(r.spend), 0);
    const [y, m] = today.split("-").map(Number);
    const dim = new Date(Date.UTC(y, m, 0)).getUTCDate(), elapsed = Number(until.slice(8)) || 1;
    const pace = spent / (Number(client.monthly_budget) * (elapsed / dim));
    if (until.slice(0, 7) === today.slice(0, 7) && (pace > 1.1 || pace < 0.7))
      notes.push({ level: "medio", text: `Ritmo de verba: ${money(spent)} gastos até ${dm(until)}, ${Math.round(pace * 100)}% do esperado para o orçamento de ${money(Number(client.monthly_budget))} no mês.` });
  }
  if (pending) notes.push({ level: "medio", text: `${pending} decisão(ões) do piloto aguardando aprovação.` });
  if (kind === "conversation") notes.push({ level: "baixo", text: "Conversas não são vendas: confirme com o cliente quantas viraram venda para validar o custo por conversa." });
  if (!done.length && kindOfReport === "weekly") notes.push({ level: "baixo", text: "Nenhuma otimização executada na semana. Confirme se as campanhas estão saudáveis ou se o piloto está em modo só sugestão." });
  const order = { alto: 0, medio: 1, baixo: 2 };
  notes.sort((x, y) => order[x.level] - order[y.level]);

  const data: Json = {
    summary: { ...sm, reach: reach.reach, frequency: reach.frequency, period_impressions: reach.impressions, confidence: confidence(sm.result) },
    kind, ads: ads.slice(0, 12), actions: done, next,
  };
  if (kindOfReport === "monthly") {
    // série diária e análise completa: base dos slides
    const daily = await selectAll<Json>((f) => sb.from("insights_daily").select("date, spend, impressions, link_clicks, conversations, leads, purchases, purchase_value")
      .eq("level", "account").in("object_id", accIds).gte("date", since).lte("date", until).order("date").range(f, f + 999));
    const byDay = new Map<string, Json>();
    for (const r of daily) {
      const e = byDay.get(r.date as string) ?? { date: r.date, spend: 0, impressions: 0, link_clicks: 0, conversations: 0, leads: 0, purchases: 0, purchase_value: 0 };
      for (const k of ["spend", "impressions", "link_clicks", "conversations", "leads", "purchases", "purchase_value"]) e[k] = num(e[k]) + num(r[k]);
      byDay.set(r.date as string, e);
    }
    data.daily = [...byDay.values()];
    data.analysis = a;
  }
  return { text: lines.join("\n"), internal: notes, data };
}

async function runReports(sb: SupabaseClient, kindOfReport: "weekly" | "monthly", who: string, clientId?: string, range?: { since: string; until: string }) {
  let since: string, until: string;
  if (range) ({ since, until } = range);
  else if (kindOfReport === "weekly") { until = brDate(-1); since = addDays(until, -6); }
  else {
    const t = brDate(0);
    const firstThis = `${t.slice(0, 7)}-01`;
    until = addDays(firstThis, -1); since = `${until.slice(0, 7)}-01`;
  }
  let q = sb.from("clients").select("id, name").eq("active", true);
  if (clientId) q = q.eq("id", clientId);
  const { data: clients } = await q;
  const out: Json[] = [];
  const list = clients ?? [];
  for (let i = 0; i < list.length; i += 4) {
    await Promise.all(list.slice(i, i + 4).map(async (c) => {
      try {
        const r = await buildReport(sb, c.id, since, until, kindOfReport);
        if (!r) { out.push({ client: c.name, skipped: "sem investimento" }); return; }
        const { data, error } = await sb.from("client_reports").upsert({ client_id: c.id, kind: kindOfReport, since, until, text: r.text,
          internal: r.internal, data: r.data, created_at: nowIso(), created_by: who, sent_at: null, sent_by: null }, { onConflict: "client_id,kind,since,until" })
          .select("id").single();
        if (error) throw new Error(error.message);
        out.push({ client: c.name, id: data.id, alerts: r.internal.filter((n) => n.level === "alto").length });
      } catch (e) { out.push({ client: c.name, error: e instanceof Error ? e.message : String(e) }); }
    }));
  }
  return { kind: kindOfReport, since, until, reports: out };
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
  let who = "sistema", readOnly = false;
  const cronHeader = req.headers.get("x-cron-secret");
  const { data: cronOk } = cronHeader ? await sb.rpc("check_cron_secret", { s: cronHeader }) : { data: false };
  if (!cronOk) {
    const jwt = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    const { data } = jwt ? await sb.auth.getUser(jwt) : { data: { user: null } };
    if (!data.user) return reply({ error: "não autorizado" }, 401);
    const email = (data.user.email ?? "").toLowerCase();
    const { data: member } = await sb.from("team_members").select("email").eq("email", email).maybeSingle();
    if (!member) {
      // time de copy: só leitura (análise, raio-x, IA e imagens dos slides)
      const { data: viewer } = await sb.from("team_viewers").select("email").eq("email", email).maybeSingle();
      if (!viewer) return reply({ error: "Este e-mail não faz parte da equipe Impacto" }, 403);
      readOnly = true;
    }
    who = data.user.email ?? data.user.id;
  }
  const body = await req.json().catch(() => ({}));
  if (readOnly && !["analyze", "ai", "ai_status", "images64", "collect"].includes(body.action))
    return reply({ error: "Seu acesso é só de leitura (Criativos e Estratégia)." }, 403);
  const days = Math.min(Math.max(Number(body.days) || 14, 3), 60);
  try {
    switch (body.action) {
      case "collect": return reply(await collect(sb, body.account_id, body.client_id));
      case "analyze": return reply(await analyze(sb, String(body.client_id), days));
      case "ai": return reply(await aiAnalysis(sb, String(body.client_id), days, who));
      case "ai_status": return reply({ enabled: !!ANTHROPIC_KEY });
      case "geo_search": {
        const q = String(body.q ?? "").trim();
        if (q.length < 2) return reply({ data: [] });
        const r = await graph("search", { type: "adgeolocation", q, location_types: JSON.stringify(["city"]), limit: "10" });
        return reply({ data: ((r.data as Json[]) ?? []).map((c) => ({ key: c.key, name: c.name, region: c.region, country: c.country_code })) });
      }
      case "plan_launch": return reply(await planLaunch(sb, body, who));
      case "weekly_reports": return reply(await runReports(sb, "weekly", who, body.client_id, body.since ? { since: body.since, until: body.until } : undefined));
      case "monthly_reports": return reply(await runReports(sb, "monthly", who, body.client_id, body.since ? { since: body.since, until: body.until } : undefined));
      case "images64": {
        // imagens dos criativos para o relatório em slides (o navegador não pode baixá-las direto do Meta)
        const urls = (Array.isArray(body.urls) ? body.urls : []).slice(0, 12).map(String).filter((u: string) => /^https:\/\/[^/]*(fbcdn\.net|facebook\.com|supabase\.co)\//.test(u));
        const out = await Promise.all(urls.map(async (u: string) => {
          try {
            const r = await fetch(u);
            if (!r.ok) return { url: u, data: null };
            const bytes = new Uint8Array(await r.arrayBuffer());
            let bin = "";
            for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
            return { url: u, data: `data:${r.headers.get("content-type") ?? "image/jpeg"};base64,${btoa(bin)}` };
          } catch { return { url: u, data: null }; }
        }));
        return reply({ images: out });
      }
      default: return reply({ error: "ação desconhecida" }, 400);
    }
  } catch (e) {
    return reply({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
