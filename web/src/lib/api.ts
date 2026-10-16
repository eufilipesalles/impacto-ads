import { DEMO, FUNCTIONS_URL, supabase } from "./supabase";
import * as demo from "./demo";
import type { PeriodResult } from "./period";
import type {
  AdAccount, AdStat, Alert, AlertRule, CampaignStat, ClientOverview, ClientRow, DailyPoint, Objective, SyncRun,
} from "./types";

// PostgREST pode devolver numeric como texto: normaliza tudo que parece número
function nums<T>(rows: unknown[] | null): T[] {
  return (rows ?? []).map((r) => {
    const o: Record<string, unknown> = { ...(r as Record<string, unknown>) };
    for (const k of Object.keys(o)) {
      const v = o[k];
      if (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v) && !k.endsWith("id") && k !== "date") o[k] = Number(v);
    }
    return o as T;
  });
}

function check<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

export async function getOverview(): Promise<ClientOverview[]> {
  if (DEMO) return demo.overview;
  return nums<ClientOverview>(check(await supabase.from("client_overview").select("*").order("name")));
}

export async function getAccounts(): Promise<AdAccount[]> {
  if (DEMO) return demo.accounts;
  return nums<AdAccount>(check(await supabase.from("ad_accounts").select(
    "id, client_id, name, account_status, prepaid_balance, spend_cap, amount_spent, last_synced_at, last_sync_error, balance_updated_at")));
}

export async function getAlerts(status: "open" | "resolved"): Promise<Alert[]> {
  if (DEMO) return status === "open" ? demo.alerts : [];
  let q = supabase.from("alerts").select("id, client_id, type, severity, title, status, created_at, last_seen_at, resolved_at");
  q = status === "open" ? q.neq("status", "resolved") : q.eq("status", "resolved");
  return check(await q.order("created_at", { ascending: false }).limit(200)) as Alert[];
}

export async function acknowledgeAlert(id: string) {
  if (DEMO) return;
  check(await supabase.from("alerts").update({ status: "acknowledged" }).eq("id", id));
}

export async function getPortfolioDaily(days: number): Promise<DailyPoint[]> {
  if (DEMO) return demo.daily(days, 5);
  return nums<DailyPoint>(check(await supabase.rpc("portfolio_daily", { p_days: days })));
}

export async function getClientDaily(clientId: string, days: number): Promise<DailyPoint[]> {
  if (DEMO) return demo.daily(days, 1);
  return nums<DailyPoint>(check(await supabase.rpc("client_daily", { p_client: clientId, p_days: days })));
}

export async function getCampaignStats(clientId: string, days: number): Promise<CampaignStat[]> {
  if (DEMO) return demo.campaigns;
  return nums<CampaignStat>(check(await supabase.rpc("campaign_stats", { p_client: clientId, p_days: days })));
}

export async function getAdStats(clientId: string, days: number): Promise<AdStat[]> {
  if (DEMO) return demo.ads;
  return nums<AdStat>(check(await supabase.rpc("ad_stats", { p_client: clientId, p_days: days })));
}

export async function getClients(): Promise<ClientRow[]> {
  if (DEMO) return demo.clients;
  return nums<ClientRow>(check(await supabase.from("clients").select("id, name, objective, monthly_budget, active").order("name")));
}

export async function getRules(): Promise<AlertRule[]> {
  if (DEMO) return [];
  return nums<AlertRule>(check(await supabase.from("alert_rules").select("id, client_id, type, threshold, window_days, enabled")));
}

export async function saveClient(c: { id: string; objective: Objective; monthly_budget: number | null; active: boolean }) {
  if (DEMO) return;
  check(await supabase.from("clients").update({
    objective: c.objective, monthly_budget: c.monthly_budget, active: c.active,
  }).eq("id", c.id));
}

// Teto de custo por conversa do cliente (regra própria; null = sem teto)
export async function saveCostCeiling(clientId: string, threshold: number | null) {
  if (DEMO) return;
  check(await supabase.from("alert_rules").upsert(
    { client_id: clientId, type: "cost_per_conversation", threshold, window_days: 3, enabled: true },
    { onConflict: "client_id,type" },
  ));
}

export async function getLastSync(): Promise<SyncRun | null> {
  if (DEMO) return demo.lastSync;
  const data = check(await supabase.from("sync_runs").select("id, started_at, finished_at, accounts_ok, accounts_err")
    .not("finished_at", "is", null).order("id", { ascending: false }).limit(1));
  return (data as SyncRun[])[0] ?? null;
}

export async function syncNow(opts: { accountId?: string; days?: number } = {}): Promise<{ ok: number; err: number; errors: string[] }> {
  if (DEMO) { await new Promise((r) => setTimeout(r, 1200)); return { ok: 1, err: 0, errors: [] }; }
  const { data: s } = await supabase.auth.getSession();
  const res = await fetch(`${FUNCTIONS_URL}/meta-sync`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${s.session?.access_token ?? ""}` },
    body: JSON.stringify({ days: opts.days ?? 3, ...(opts.accountId ? { account_id: opts.accountId } : {}) }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Falha ao atualizar (${res.status})`);
  const errs = ((body.errors ?? []) as { account?: string; error: string }[]).filter((e) => e.account);
  return { ok: (body.results ?? []).length, err: errs.length, errors: errs.map((e) => e.error) };
}

// ---------- Cadastro de clientes ----------
export interface ClientWithAccounts extends ClientRow { created_at: string; accounts: AdAccount[] }

export async function getClientsWithAccounts(): Promise<ClientWithAccounts[]> {
  if (DEMO) {
    return demo.clients.map((c) => ({ ...c, created_at: new Date().toISOString(), accounts: demo.accounts.filter((a) => a.client_id === c.id) }));
  }
  const [clients, accounts] = await Promise.all([
    supabase.from("clients").select("id, name, objective, monthly_budget, active, created_at").order("name"),
    getAccounts(),
  ]);
  const rows = nums<ClientRow & { created_at: string }>(check(clients));
  return rows.map((c) => ({ ...c, accounts: accounts.filter((a) => a.client_id === c.id) }));
}

// Aceita "act_123", "123" ou um link do Gerenciador com act=123
export function parseAccountId(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  const m = t.match(/act[=_](\d{6,20})/) ?? t.match(/^(\d{6,20})$/);
  return m ? `act_${m[1]}` : null;
}

export async function createNewClient(input: {
  name: string; objective: Objective; monthly_budget: number | null; ceiling: number | null; accounts: string[];
}): Promise<string> {
  if (DEMO) return "demo";
  const name = input.name.trim();

  const { data: dupName } = await supabase.from("clients").select("id").ilike("name", name).maybeSingle();
  if (dupName) throw new Error(`Já existe um cliente chamado “${name}”.`);
  const { data: dupAcc } = await supabase.from("ad_accounts").select("id, clients(name)").in("id", input.accounts);
  if (dupAcc && dupAcc.length) {
    const d = dupAcc[0] as unknown as { id: string; clients: { name: string } | null };
    throw new Error(`A conta ${d.id.replace("act_", "")} já está cadastrada${d.clients ? ` no cliente ${d.clients.name}` : ""}.`);
  }

  const created = check(await supabase.from("clients")
    .insert({ name, objective: input.objective, monthly_budget: input.monthly_budget })
    .select("id").single()) as { id: string };

  const acc = await supabase.from("ad_accounts").insert(input.accounts.map((id) => ({ id, client_id: created.id })));
  if (acc.error) {
    await supabase.from("clients").delete().eq("id", created.id); // desfaz o cadastro pela metade
    throw new Error(`Não foi possível cadastrar a conta: ${acc.error.message}`);
  }
  if (input.ceiling !== null) await saveCostCeiling(created.id, input.ceiling);
  return created.id;
}

export async function isTeamMember(): Promise<boolean> {
  if (DEMO) return true;
  const { data } = await supabase.rpc("is_team_member");
  return data === true;
}

// Totais de um período consultados ao vivo no Meta (mesma base do Gerenciador de Anúncios)
export async function getPeriod(clientId: string, since: string, until: string, compare = false): Promise<PeriodResult> {
  if (DEMO) { await new Promise((r) => setTimeout(r, 600)); return demo.period(since, until, compare); }
  const { data: s } = await supabase.auth.getSession();
  const res = await fetch(`${FUNCTIONS_URL}/meta-sync`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${s.session?.access_token ?? ""}` },
    body: JSON.stringify({ action: "period", client_id: clientId, since, until, compare }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Falha ao consultar o Meta (${res.status})`);
  return body as PeriodResult;
}
