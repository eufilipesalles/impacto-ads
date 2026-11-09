// Impacto Ads — descoberta automática de contas de anúncios (BMs) liberadas para o sistema
//
// Ações (POST, JSON; equipe completa ou cron):
//   { action: "discover" }                         → todas as contas que o token enxerga, marcando as que já estão no sistema
//   { action: "import", accounts: [{ id, client_id?, client_name? }] } → cadastra as contas (cria o cliente se preciso) e puxa o histórico
//   { action: "auto" }                             → cron: cadastra sozinho toda conta ativa nova e avisa no painel
//   { action: "ignore", id, ignored }              → esconde uma conta da descoberta (ex.: conta pessoal)

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";

const API_VERSION = Deno.env.get("META_API_VERSION") ?? "v25.0";
const clean = (v: string | undefined) => (v ?? "").trim().replace(/^["']|["']$/g, "");
const RAW_TOKEN = clean(Deno.env.get("META_ACCESS_TOKEN"));
const RAW_SECRET = clean(Deno.env.get("META_APP_SECRET"));
const SWAPPED = !RAW_TOKEN.startsWith("EAA") && RAW_SECRET.startsWith("EAA");
const TOKEN = SWAPPED ? RAW_SECRET : RAW_TOKEN;
const APP_SECRET = SWAPPED ? RAW_TOKEN : RAW_SECRET;
type Json = Record<string, unknown>;

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
  const url = new URL(path.startsWith("http") ? path : `https://graph.facebook.com/${API_VERSION}/${path}`);
  if (!path.startsWith("http")) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    url.searchParams.set("access_token", TOKEN);
    const p = await appSecretProof();
    if (p) url.searchParams.set("appsecret_proof", p);
  }
  const res = await fetch(url);
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Meta (${(j as Json).error ? ((j as { error: { code?: number } }).error.code) : res.status}): ${((j as { error?: { message?: string } }).error?.message) ?? res.statusText}`);
  return j as Json;
}
async function graphAll(path: string, params: Record<string, string>) {
  const out: Json[] = [];
  let page = await graph(path, { limit: "200", ...params });
  for (;;) {
    out.push(...((page.data as Json[]) ?? []));
    const next = (page.paging as Json | undefined)?.next as string | undefined;
    if (!next) break;
    page = await graph(next);
  }
  return out;
}

const STATUS: Record<number, string> = { 1: "Ativa", 2: "Desativada", 3: "Pagamento pendente", 7: "Em análise de risco", 8: "Liquidação pendente", 9: "Em período de carência", 100: "Fechamento pendente", 101: "Fechada" };
const ACC_FIELDS = "id,name,account_status,currency,amount_spent,business{id,name},owner";
const BASIC_FIELDS = "id,name,account_status,currency,amount_spent";

// Tudo que o token alcança: contas diretas + contas próprias e de clientes de cada BM
async function discover(sb: SupabaseClient) {
  const found = new Map<string, Json>();
  const add = (a: Json, via: string, bm?: Json) => {
    const id = String(a.id);
    if (found.has(id)) return;
    const business = (a.business as Json | undefined) ?? bm ?? null;
    found.set(id, { id, name: a.name ?? id, account_status: a.account_status ?? null, status_text: STATUS[Number(a.account_status)] ?? "—",
      currency: a.currency ?? null, amount_spent: a.amount_spent ? Number(a.amount_spent) / 100 : 0,
      bm_id: business?.id ?? null, bm_name: business?.name ?? null, via });
  };
  const errors: string[] = [];
  // "business" exige business_management; sem ela, lista as contas só com os campos básicos
  try { for (const a of await graphAll("me/adaccounts", { fields: ACC_FIELDS })) add(a, "acesso direto"); }
  catch { try { for (const a of await graphAll("me/adaccounts", { fields: BASIC_FIELDS })) add(a, "acesso direto"); } catch (e) { errors.push(`me/adaccounts: ${e instanceof Error ? e.message : e}`); } }
  let bms: Json[] = [];
  try { bms = await graphAll("me/businesses", { fields: "id,name" }); }
  catch (e) { errors.push(`me/businesses: ${e instanceof Error ? e.message : e}`); }
  for (const bm of bms) {
    for (const edge of ["owned_ad_accounts", "client_ad_accounts"]) {
      try { for (const a of await graphAll(`${bm.id}/${edge}`, { fields: ACC_FIELDS })) add(a, edge === "owned_ad_accounts" ? "BM dona" : "BM parceira", bm); }
      catch (e) { errors.push(`${bm.name} ${edge}: ${e instanceof Error ? e.message : e}`); }
    }
  }
  const [{ data: known }, { data: ignored }] = await Promise.all([
    sb.from("ad_accounts").select("id, client_id, clients(name)"),
    sb.from("ad_accounts_ignored").select("id"),
  ]);
  const knownBy = new Map((known ?? []).map((k) => [k.id as string, k]));
  const ign = new Set((ignored ?? []).map((x) => x.id as string));
  const accounts = [...found.values()].map((a) => {
    const k = knownBy.get(a.id as string);
    return { ...a, in_system: !!k, client_name: (k?.clients as unknown as { name: string } | null)?.name ?? null, ignored: ign.has(a.id as string) };
  }).sort((x, y) => Number(x.in_system) - Number(y.in_system) || String(x.name).localeCompare(String(y.name)));
  // contas no sistema que o token não enxerga mais (sem permissão)
  // contas no sistema que não aparecem na lista: confirma uma a uma (acesso via BM parceira não aparece em me/adaccounts)
  const lost: Json[] = [];
  for (const k of (known ?? []).filter((k) => !found.has(k.id as string))) {
    try { await graph(k.id as string, { fields: "id" }); }
    catch { lost.push({ id: k.id, client_name: (k.clients as unknown as { name: string } | null)?.name ?? null }); }
  }
  return { accounts, businesses: bms.map((b) => ({ id: b.id, name: b.name })), lost, errors };
}

const tidy = (name: string) => name.replace(/^(C\.?A\.?\s*\d*|CA\d*|C\d+)\s*[-–:]?\s*/i, "").replace(/\s+/g, " ").trim() || name;

async function importAccounts(sb: SupabaseClient, list: { id: string; client_id?: string; client_name?: string; name?: string }[]) {
  const done: Json[] = [];
  for (const item of list) {
    const id = item.id.startsWith("act_") ? item.id : `act_${item.id}`;
    const { data: exists } = await sb.from("ad_accounts").select("id").eq("id", id).maybeSingle();
    if (exists) { done.push({ id, skipped: "já estava no sistema" }); continue; }
    let clientId = item.client_id ?? null;
    if (!clientId) {
      const name = (item.client_name ?? tidy(item.name ?? id)).trim();
      const { data: same } = await sb.from("clients").select("id").ilike("name", name).maybeSingle();
      if (same) clientId = same.id;
      else {
        const { data: c, error } = await sb.from("clients").insert({ name, objective: "a_definir", active: true }).select("id").single();
        if (error) { done.push({ id, error: error.message }); continue; }
        clientId = c.id;
      }
    }
    const { error } = await sb.from("ad_accounts").insert({ id, client_id: clientId, name: item.name ?? null });
    done.push(error ? { id, error: error.message } : { id, client_id: clientId, ok: true });
    if (!error) await sb.from("ad_accounts_ignored").delete().eq("id", id);
  }
  // puxa o histórico (90 dias) das contas novas agora, sem esperar a coleta da manhã (continua depois da resposta)
  const ok = done.filter((d) => d.ok).map((d) => d.id as string);
  if (ok.length) {
    const secret = await cronSecret(sb);
    const job = (async () => {
      for (const id of ok) {
        await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/meta-sync`, {
          method: "POST", headers: { "content-type": "application/json", "x-cron-secret": secret }, body: JSON.stringify({ account_id: id }),
        }).catch(() => {});
      }
    })();
    const rt = (globalThis as { EdgeRuntime?: { waitUntil: (p: Promise<unknown>) => void } }).EdgeRuntime;
    if (rt?.waitUntil) rt.waitUntil(job); else await job;
  }
  return { imported: ok.length, results: done };
}

async function cronSecret(sb: SupabaseClient) {
  const { data } = await sb.rpc("get_cron_secret");
  return String(data ?? "");
}

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type, x-client-info, apikey",
  "access-control-allow-methods": "POST, OPTIONS",
};
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: CORS });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const cronHeader = req.headers.get("x-cron-secret");
  const { data: cronOk } = cronHeader ? await sb.rpc("check_cron_secret", { s: cronHeader }) : { data: false };
  if (!cronOk) {
    const jwt = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    const { data } = jwt ? await sb.auth.getUser(jwt) : { data: { user: null } };
    if (!data.user) return reply({ error: "não autorizado" }, 401);
    const { data: member } = await sb.from("team_members").select("email").eq("email", (data.user.email ?? "").toLowerCase()).maybeSingle();
    if (!member) return reply({ error: "Só a equipe completa pode adicionar contas." }, 403);
  }
  const b = await req.json().catch(() => ({}));
  try {
    switch (b.action) {
      case "discover": return reply(await discover(sb));
      case "import": return reply(await importAccounts(sb, Array.isArray(b.accounts) ? b.accounts : []));
      case "ignore": {
        if (b.ignored === false) await sb.from("ad_accounts_ignored").delete().eq("id", b.id);
        else await sb.from("ad_accounts_ignored").upsert({ id: b.id, name: b.name ?? null });
        return reply({ ok: true });
      }
      case "auto": {
        // toda conta ativa nova que aparecer (e não estiver ignorada) entra sozinha, com o cliente criado pelo nome da conta
        const d = await discover(sb);
        const fresh = (d.accounts as Json[]).filter((a) => !a.in_system && !a.ignored && Number(a.account_status) === 1);
        const r = await importAccounts(sb, fresh.map((a) => ({ id: String(a.id), name: String(a.name) })));
        return reply({ found: d.accounts.length, new: fresh.length, ...r, errors: d.errors });
      }
      default: return reply({ error: "ação desconhecida" }, 400);
    }
  } catch (e) {
    return reply({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
