// Piloto automático e biblioteca de materiais: chamadas ao servidor
import { DEMO, FUNCTIONS_URL, supabase } from "./supabase";

export type ActionStatus = "proposed" | "approved" | "executing" | "done" | "failed" | "rejected" | "expired" | "undone";

export interface AutopilotAction {
  id: string;
  client_id: string;
  ad_account_id: string | null;
  rule: string;
  kind: "pause" | "activate" | "set_budget" | "create_ad" | "launch_campaign";
  protective: boolean;
  object_type: string | null;
  object_id: string | null;
  object_name: string | null;
  campaign_name: string | null;
  title: string;
  reason: string;
  evidence: Record<string, unknown> | null;
  params: Record<string, unknown>;
  result: Record<string, unknown> | null;
  status: ActionStatus;
  auto: boolean;
  error: string | null;
  created_at: string;
  decided_at: string | null;
  decided_by: string | null;
  executed_at: string | null;
  undone_at: string | null;
  undone_by: string | null;
}

export interface AutopilotSettings {
  client_id: string;
  level: 0 | 1 | 2;
  target_cost: number | null;
  monthly_cap: number | null;
  max_increase_pct: number;
}

export interface CreativeAsset {
  id: string;
  client_id: string;
  drive_file_id: string;
  name: string;
  mime_type: string | null;
  kind: "image" | "video";
  size_bytes: number | null;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  thumbnail_url: string | null;
  web_view_link: string | null;
  folder_name: string | null;
  drive_modified_at: string | null;
  meta: Record<string, { image_hash?: string; video_id?: string; sent_at?: string; upload?: unknown }>;
  removed: boolean;
}

export interface DriveStatus { configured: boolean; connected: boolean; email?: string | null; root_link?: string | null }

export interface AdsetOption {
  id: string; name: string | null; effective_status: string | null; ad_account_id: string;
  campaign_name: string | null; campaign_status: string | null;
  ads: { id: string; name: string | null; effective_status: string | null; format: string | null }[];
}

async function call<T>(fn: "autopilot" | "drive", body: Record<string, unknown>): Promise<T> {
  const { data: s } = await supabase.auth.getSession();
  const res = await fetch(`${FUNCTIONS_URL}/${fn}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${s.session?.access_token ?? ""}` },
    body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || (j && j.ok === false)) throw new Error(j.error ?? `Falha (${res.status})`);
  return j as T;
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- piloto ----------
export async function getAutopilot(): Promise<{ actions: AutopilotAction[]; settings: AutopilotSettings[]; paused: boolean }> {
  if (DEMO) return { actions: demoActions, settings: demoSettings, paused: demoPaused };
  const [a, s, g] = await Promise.all([
    supabase.from("autopilot_actions").select("*").order("created_at", { ascending: false }).limit(300),
    supabase.from("autopilot_settings").select("client_id, level, target_cost, monthly_cap, max_increase_pct"),
    supabase.from("autopilot_global").select("paused").eq("id", 1).maybeSingle(),
  ]);
  if (a.error) throw new Error(a.error.message);
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    actions: (a.data ?? []) as AutopilotAction[],
    settings: (s.data ?? []).map((x) => ({ ...x, target_cost: n(x.target_cost), monthly_cap: n(x.monthly_cap) })) as AutopilotSettings[],
    paused: !!g.data?.paused,
  };
}

export async function decideAction(id: string, decision: "approve" | "reject") {
  if (DEMO) {
    await wait(500);
    const a = demoActions.find((x) => x.id === id)!;
    Object.assign(a, { status: decision === "approve" ? "done" : "rejected", decided_by: "demonstração", decided_at: new Date().toISOString(), executed_at: new Date().toISOString() });
    return;
  }
  await call("autopilot", { action: "decide", id, decision });
}

export async function undoAction(id: string) {
  if (DEMO) { await wait(500); Object.assign(demoActions.find((x) => x.id === id)!, { status: "undone", undone_at: new Date().toISOString(), undone_by: "demonstração" }); return; }
  await call("autopilot", { action: "undo", id });
}

export async function setPausedAll(paused: boolean) {
  if (DEMO) { demoPaused = paused; return; }
  await call("autopilot", { action: "pause_all", paused });
}

export async function runEvaluate(): Promise<{ proposals: number; auto_executed: number }> {
  if (DEMO) { await wait(900); return { proposals: 0, auto_executed: 0 }; }
  return await call("autopilot", { action: "evaluate" });
}

export async function saveAutopilotSettings(s: AutopilotSettings) {
  if (DEMO) { const i = demoSettings.findIndex((x) => x.client_id === s.client_id); if (i >= 0) demoSettings[i] = s; else demoSettings.push(s); return; }
  const { data: u } = await supabase.auth.getUser();
  const { error } = await supabase.from("autopilot_settings").upsert({ ...s, updated_at: new Date().toISOString(), updated_by: u.user?.email ?? null });
  if (error) throw new Error(error.message);
}

// ---------- Drive ----------
export async function driveStatus(): Promise<DriveStatus> {
  if (DEMO) return { configured: true, connected: true, email: "materiais@impacto.com", root_link: "https://drive.google.com" };
  return await call("drive", { action: "status" });
}

export async function driveConnect() {
  const back = `${window.location.origin}/materiais`;
  const { url } = await call<{ url: string }>("drive", { action: "auth_url", return_to: back });
  window.location.href = url;
}

export async function driveDisconnect() { if (!DEMO) await call("drive", { action: "disconnect" }); }

export async function setClientFolder(clientId: string, folder: string) {
  if (DEMO) return { folder_link: "https://drive.google.com", name: "Novembro" };
  return await call<{ folder_link: string; name: string }>("drive", { action: "set_folder", client_id: clientId, folder });
}

// Lê a pasta do Drive (atualiza a biblioteca) e devolve os materiais
export async function getLibrary(clientId: string, refresh: boolean): Promise<{ assets: CreativeAsset[]; folder_link: string | null }> {
  if (DEMO) { await wait(400); return { assets: demoAssets.filter((a) => a.client_id === clientId || clientId === "c2"), folder_link: "https://drive.google.com" }; }
  let folder_link: string | null = null;
  if (refresh) folder_link = (await call<{ folder_link: string }>("drive", { action: "list", client_id: clientId })).folder_link;
  const { data, error } = await supabase.from("creative_assets").select("*").eq("client_id", clientId).eq("removed", false)
    .order("drive_modified_at", { ascending: false });
  if (error) throw new Error(error.message);
  return { assets: (data ?? []) as CreativeAsset[], folder_link };
}

// Envia direto do navegador para a pasta do cliente no Drive
export async function uploadToDrive(clientId: string, file: File, onProgress: (p: number) => void) {
  if (DEMO) { for (let p = 0; p <= 1; p += 0.25) { onProgress(p); await wait(250); } return; }
  const { upload_url } = await call<{ upload_url: string }>("drive", {
    action: "upload_session", client_id: clientId, name: file.name, mime: file.type || "application/octet-stream", size: file.size,
  });
  await new Promise<void>((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("PUT", upload_url);
    x.setRequestHeader("content-type", file.type || "application/octet-stream");
    x.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    x.onload = () => (x.status >= 200 && x.status < 300 ? resolve() : reject(new Error(`Google Drive recusou o envio (${x.status})`)));
    x.onerror = () => reject(new Error("Falha de conexão ao enviar para o Google Drive"));
    x.send(file);
  });
}

// Vídeos grandes vão em várias etapas: chama até concluir
export async function sendToMeta(assetId: string, accountId: string, onProgress?: (p: number) => void) {
  if (DEMO) { await wait(800); const a = demoAssets.find((x) => x.id === assetId)!; a.meta = { ...a.meta, [accountId]: { image_hash: "demo", sent_at: new Date().toISOString() } }; return; }
  for (let i = 0; i < 40; i++) {
    const r = await call<{ done: boolean; progress?: number }>("drive", { action: "send_to_meta", asset_id: assetId, ad_account_id: accountId });
    if (r.done) return;
    onProgress?.(r.progress ?? 0);
  }
  throw new Error("O envio do vídeo demorou demais. Tente um arquivo menor.");
}

export async function getClientAdsets(clientId: string): Promise<AdsetOption[]> {
  if (DEMO) return demoAdsets;
  const [s, a] = await Promise.all([
    supabase.from("adsets").select("id, name, effective_status, ad_account_id, campaign_id, campaigns(name, effective_status), ad_accounts!inner(client_id)")
      .eq("ad_accounts.client_id", clientId),
    supabase.from("ads").select("id, name, effective_status, format, adset_id, ad_accounts!inner(client_id)").eq("ad_accounts.client_id", clientId),
  ]);
  if (s.error) throw new Error(s.error.message);
  const ads = (a.data ?? []) as unknown as { id: string; name: string | null; effective_status: string | null; format: string | null; adset_id: string }[];
  const rank = (st: string | null) => (st === "ACTIVE" ? 0 : 1);
  return ((s.data ?? []) as unknown as (Omit<AdsetOption, "ads" | "campaign_name" | "campaign_status"> & { campaigns: { name: string; effective_status: string } | null })[])
    .map((x) => ({
      id: x.id, name: x.name, effective_status: x.effective_status, ad_account_id: x.ad_account_id,
      campaign_name: x.campaigns?.name ?? null, campaign_status: x.campaigns?.effective_status ?? null,
      ads: ads.filter((ad) => ad.adset_id === x.id).sort((p, q) => rank(p.effective_status) - rank(q.effective_status)),
    }))
    .filter((x) => x.ads.length > 0)
    .sort((p, q) => rank(p.effective_status) - rank(q.effective_status) || (p.campaign_name ?? "").localeCompare(q.campaign_name ?? ""));
}

export async function createAdFromAsset(input: {
  client_id: string; ad_account_id: string; adset_id: string; template_ad_id: string; asset_id: string;
  name?: string; activate: boolean; message?: string;
}): Promise<{ ad_id: string }> {
  if (DEMO) { await wait(900); return { ad_id: "demo" }; }
  const r = await call<{ result: { ad_id: string } }>("autopilot", { action: "create_ad", ...input });
  return r.result;
}

// ---------- demonstração ----------
const ago = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
let demoPaused = false;
const demoSettings: AutopilotSettings[] = [
  { client_id: "c2", level: 1, target_cost: 10, monthly_cap: 1000, max_increase_pct: 20 },
  { client_id: "c8", level: 2, target_cost: null, monthly_cap: null, max_increase_pct: 20 },
];
const demoActions: AutopilotAction[] = [
  { id: "x1", client_id: "c8", ad_account_id: "act_8", rule: "scale_up", kind: "set_budget", protective: false, object_type: "campaign", object_id: "1",
    object_name: "[VENDAS] Delivery — almoço", campaign_name: "[VENDAS] Delivery — almoço", title: "Aumentar orçamento de \"[VENDAS] Delivery — almoço\" em 20%",
    reason: "Custo por venda de R$ 4,08 em 7 dias e R$ 3,90 nos últimos 3, abaixo da meta de R$ 6,00 (média do cliente em 14 dias). A campanha usa 97% do orçamento: tem espaço para crescer.",
    evidence: { orcamento_diario: 40, novo_orcamento: 48 }, params: {}, result: null, status: "proposed", auto: false, error: null,
    created_at: ago(2), decided_at: null, decided_by: null, executed_at: null, undone_at: null, undone_by: null },
  { id: "x2", client_id: "c2", ad_account_id: "act_2", rule: "pause_no_result", kind: "pause", protective: true, object_type: "ad", object_id: "2",
    object_name: "Vídeo — tour pela clínica", campaign_name: "[CONV] Coluna — WhatsApp", title: "Pausar anúncio \"Vídeo — tour pela clínica\"",
    reason: "Gastou R$ 41,20 em 7 dias sem nenhuma conversa — o dobro da meta de R$ 10,00 por conversa (meta definida). Outros anúncios do conjunto seguem rodando.",
    evidence: null, params: {}, result: { status: "PAUSED" }, status: "done", auto: true, error: null,
    created_at: ago(20), decided_at: ago(20), decided_by: "piloto automático", executed_at: ago(20), undone_at: null, undone_by: null },
  { id: "x3", client_id: "c3", ad_account_id: "act_3", rule: "scale_down", kind: "set_budget", protective: true, object_type: "campaign", object_id: "3",
    object_name: "[CONV] Peças — remarketing", campaign_name: "[CONV] Peças — remarketing", title: "Reduzir orçamento de \"[CONV] Peças — remarketing\" em 20%",
    reason: "Custo por conversa de R$ 14,90 em 7 dias, acima de 1,6x a meta de R$ 6,08 (média do cliente em 14 dias), e sem melhora nos últimos 3 dias.",
    evidence: null, params: {}, result: { targets: [{ name: "Conjunto 1", from: 30, to: 24 }] }, status: "done", auto: false, error: null,
    created_at: ago(30), decided_at: ago(28), decided_by: "filiperscoproducao@gmail.com", executed_at: ago(28), undone_at: null, undone_by: null },
];
const demoAssets: CreativeAsset[] = [
  { id: "m1", client_id: "c2", drive_file_id: "f1", name: "depoimento-ciatico-v2.mp4", mime_type: "video/mp4", kind: "video", size_bytes: 48_200_000,
    width: 1080, height: 1920, duration_ms: 34_000, thumbnail_url: null, web_view_link: "https://drive.google.com", folder_name: "Novembro",
    drive_modified_at: ago(5), meta: {}, removed: false },
  { id: "m2", client_id: "c2", drive_file_id: "f2", name: "pilates-oferta-novembro.jpg", mime_type: "image/jpeg", kind: "image", size_bytes: 820_000,
    width: 1080, height: 1350, duration_ms: null, thumbnail_url: null, web_view_link: "https://drive.google.com", folder_name: null,
    drive_modified_at: ago(26), meta: { act_2: { image_hash: "abc", sent_at: ago(20) } }, removed: false },
  { id: "m3", client_id: "c2", drive_file_id: "f3", name: "avaliacao-gratuita-stories.mp4", mime_type: "video/mp4", kind: "video", size_bytes: 12_400_000,
    width: 1080, height: 1920, duration_ms: 15_000, thumbnail_url: null, web_view_link: "https://drive.google.com", folder_name: "Novembro",
    drive_modified_at: ago(50), meta: {}, removed: false },
];
const demoAdsets: AdsetOption[] = [
  { id: "s1", name: "Uruguaiana 30–60 — Advantage+", effective_status: "ACTIVE", ad_account_id: "act_2", campaign_name: "[CONV] Coluna — WhatsApp — Uruguaiana",
    campaign_status: "ACTIVE", ads: [{ id: "a1", name: "Vídeo — dor no ciático", effective_status: "ACTIVE", format: "video" }, { id: "a2", name: "Imagem — avaliação", effective_status: "PAUSED", format: "imagem" }] },
];
