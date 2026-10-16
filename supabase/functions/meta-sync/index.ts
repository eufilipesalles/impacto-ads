// Impacto Ads — meta-sync
// Coleta dados das contas de anúncio no Meta, grava no banco e avalia os alertas.
//
// Chamadas aceitas:
//   - pg_cron, com header x-cron-secret (segredo guardado no Vault do banco)
//   - painel (usuário logado), com header Authorization: Bearer <jwt do usuário>
// Corpo (opcional): { "days": 3, "account_id": "act_123" }
//   days = quantos dias para trás buscar (padrão 3; use 90 na primeira carga)
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

const ACTION_CONVERSATION = "onsite_conversion.messaging_conversation_started_7d";
const ACTION_LEADS = ["lead", "onsite_conversion.lead_grouped"];
const ACTION_VIDEO = "video_view";

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

async function upsert(sb: SupabaseClient, table: string, rows: Json[], onConflict: string) {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await sb.from(table).upsert(rows.slice(i, i + 500), { onConflict });
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}

const INSIGHT_FIELDS = "spend,impressions,reach,clicks,inline_link_clicks,actions,date_start";

function insightRow(level: string, objectId: string, accountId: string, r: Json): Json {
  const actions = r.actions as Action[] | undefined;
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
    actions: actions ?? null,
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
  const freq = await graph(`${act}/insights`, { level: "account", date_preset: "last_7d", fields: "frequency,reach" });
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
  const base = { time_range: timeRange, time_increment: "1" };
  const [accIns, campIns, adIns] = await Promise.all([
    graphAll(`${act}/insights`, { ...base, level: "account", fields: INSIGHT_FIELDS }),
    graphAll(`${act}/insights`, { ...base, level: "campaign", fields: `campaign_id,${INSIGHT_FIELDS}` }),
    graphAll(`${act}/insights`, { ...base, level: "ad", fields: `ad_id,campaign_id,${INSIGHT_FIELDS}` }),
  ]);

  // 4) Gravação
  const { error: accErr } = await sb.from("ad_accounts").update({
    name: acc.name,
    currency: acc.currency,
    timezone_name: acc.timezone_name,
    account_status: acc.account_status,
    disable_reason: acc.disable_reason,
    amount_spent: cents(acc.amount_spent),
    spend_cap: cents(acc.spend_cap),
    balance: cents(acc.balance),
    funding_display: (acc.funding_source_details as Json | undefined)?.display_string ?? null,
    freq_7d: f.frequency ? Number(f.frequency) : null,
    reach_7d: f.reach ? Number(f.reach) : null,
    last_synced_at: new Date().toISOString(),
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

  await upsert(sb, "insights_daily", [
    ...accIns.map((r) => insightRow("account", act, act, r)),
    ...campIns.map((r) => insightRow("campaign", r.campaign_id as string, act, r)),
    ...adIns.map((r) => insightRow("ad", r.ad_id as string, act, r)),
  ], "level,object_id,date");

  return { campaigns: campaigns.length, ads: ads.length, days: accIns.length };
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

  // Autorização: cron (segredo) ou usuário logado no painel
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
    // diagnóstico sem expor o valor
    return reply({
      error: "META_ACCESS_TOKEN não tem formato de token do Meta (deveria começar com EAA)",
      token_length: TOKEN.length,
      app_secret_looks_like_token: APP_SECRET.startsWith("EAA"),
    }, 500);
  }

  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  const days = Math.min(Math.max(Number(body.days) || 3, 1), 90);
  const since = brDate(-days);
  const until = brDate(0);

  let q = sb.from("ad_accounts").select("id, clients!inner(active)").eq("clients.active", true);
  if (body.account_id) q = q.eq("id", body.account_id);
  const { data: accounts, error } = await q;
  if (error) return reply({ error: error.message }, 500);

  const { data: run } = await sb.from("sync_runs").insert({ trigger }).select("id").single();

  const results: Json[] = [];
  const errors: Json[] = [];
  const queue = [...(accounts ?? [])];
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    for (let a = queue.shift(); a; a = queue.shift()) {
      try {
        results.push({ account: a.id, ...(await syncAccount(sb, a.id, since, until)) });
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

  return reply({ since, until, secrets_swapped: SWAPPED, results, errors, alerts_active: alertsOpened, notified });
});
