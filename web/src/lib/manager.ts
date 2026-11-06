// Gerenciador de anúncios, entrada de criativos (sem Drive) e relatórios automáticos
import { DEMO, FUNCTIONS_URL, supabase } from "./supabase";
import type { CreativeAsset } from "./autopilot";

export type Kind = "purchase" | "conversation" | "lead" | "click";
export const KIND_TXT: Record<Kind, { one: string; many: string; cost: string }> = {
  purchase: { one: "venda", many: "vendas", cost: "por venda" },
  conversation: { one: "conversa", many: "conversas", cost: "por conversa" },
  lead: { one: "lead", many: "leads", cost: "por lead" },
  click: { one: "clique", many: "cliques", cost: "por clique" },
};
const EXPLICIT: Record<string, Kind> = { vendas: "purchase", conversas_whatsapp: "conversation", leads: "lead", trafego: "click" };

export interface Stats { spend: number; impressions: number; clicks: number; result: number; value: number; days: number }
export interface MAd { id: string; name: string; status: string | null; effective_status: string | null; image_url: string | null; format: string | null; stats: Stats }
export interface MAdset { id: string; name: string; status: string | null; effective_status: string | null; daily_budget: number | null; ad_account_id: string; ads: MAd[]; stats: Stats }
export interface MCampaign {
  id: string; name: string; status: string | null; effective_status: string | null; objective: string | null;
  daily_budget: number | null; lifetime_budget: number | null; ad_account_id: string; adsets: MAdset[]; stats: Stats;
}
export interface Tree { kind: Kind; avgCost: number | null; campaigns: MCampaign[]; level: number }

const zero = (): Stats => ({ spend: 0, impressions: 0, clicks: 0, result: 0, value: 0, days: 0 });
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const brDate = (off: number) => { const d = new Date(Date.now() - 3 * 3600_000); d.setUTCDate(d.getUTCDate() + off); return ymd(d); };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function call<T>(fn: "autopilot" | "creatives" | "strategy", body: Record<string, unknown>): Promise<T> {
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

// ---------- árvore campanha → conjunto → anúncio ----------
export async function getTree(clientId: string, days: number): Promise<Tree> {
  if (DEMO) { await wait(300); return demoTree(); }
  const { data: client } = await supabase.from("clients").select("objective, ad_accounts(id)").eq("id", clientId).single();
  const accIds = ((client?.ad_accounts as { id: string }[] | undefined) ?? []).map((a) => a.id);
  if (!accIds.length) return { kind: "click", avgCost: null, campaigns: [], level: 0 };
  const since = brDate(-days), until = brDate(-1);
  const [c, s, a, st, lv] = await Promise.all([
    supabase.from("campaigns").select("id, name, status, effective_status, objective, daily_budget, lifetime_budget, ad_account_id").in("ad_account_id", accIds),
    supabase.from("adsets").select("id, name, status, effective_status, daily_budget, campaign_id, ad_account_id").in("ad_account_id", accIds),
    supabase.from("ads").select("id, name, status, effective_status, image_url, thumbnail_url, format, adset_id, campaign_id").in("ad_account_id", accIds),
    supabase.rpc("manager_stats", { p_client: clientId, p_since: since, p_until: until }),
    supabase.from("autopilot_settings").select("level").eq("client_id", clientId).maybeSingle(),
  ]);
  for (const r of [c, s, a, st]) if (r.error) throw new Error(r.error.message);
  type Row = { level: string; object_id: string; spend: number; impressions: number; link_clicks: number; conversations: number; leads: number; purchases: number; purchase_value: number; days_with_spend: number };
  const rows = (st.data ?? []) as Row[];

  // tipo de resultado: o objetivo do cliente, ou o que mais aparece
  let kind: Kind = EXPLICIT[String(client?.objective ?? "")] ?? "click";
  if (!EXPLICIT[String(client?.objective ?? "")]) {
    const t = rows.filter((r) => r.level === "campaign").reduce((x, r) => ({ c: x.c + Number(r.conversations), l: x.l + Number(r.leads), p: x.p + (Number(r.purchase_value) > 0 ? Number(r.purchases) : 0) }), { c: 0, l: 0, p: 0 });
    const best = ([["conversation", t.c], ["lead", t.l], ["purchase", t.p]] as [Kind, number][]).sort((x, y) => y[1] - x[1])[0];
    if (best[1] > 0) kind = best[0];
  }
  const toStats = (r?: Row): Stats => !r ? zero() : {
    spend: Number(r.spend), impressions: Number(r.impressions), clicks: Number(r.link_clicks), value: Number(r.purchase_value), days: Number(r.days_with_spend),
    result: kind === "purchase" ? Number(r.purchases) : kind === "conversation" ? Number(r.conversations) : kind === "lead" ? Number(r.leads) : Number(r.link_clicks),
  };
  const campStat = new Map(rows.filter((r) => r.level === "campaign").map((r) => [r.object_id, toStats(r)]));
  const adStat = new Map(rows.filter((r) => r.level === "ad").map((r) => [r.object_id, toStats(r)]));
  const add = (t: Stats, x: Stats) => { t.spend += x.spend; t.impressions += x.impressions; t.clicks += x.clicks; t.result += x.result; t.value += x.value; t.days = Math.max(t.days, x.days); };

  const live = (x: { effective_status: string | null }) => (x.effective_status === "ACTIVE" ? 0 : x.effective_status === "IN_PROCESS" || x.effective_status === "PENDING_REVIEW" ? 1 : 2);
  const ads = (a.data ?? []) as unknown as (Omit<MAd, "stats"> & { adset_id: string; thumbnail_url: string | null })[];
  const adsets = ((s.data ?? []) as (Omit<MAdset, "ads" | "stats"> & { campaign_id: string })[]).map((x) => {
    const list = ads.filter((ad) => ad.adset_id === x.id).map((ad) => ({ ...ad, image_url: ad.image_url ?? ad.thumbnail_url, stats: adStat.get(ad.id) ?? zero() }))
      .sort((p, q) => live(p) - live(q) || q.stats.spend - p.stats.spend);
    const stats = zero(); for (const ad of list) add(stats, ad.stats);
    return { ...x, daily_budget: x.daily_budget === null ? null : Number(x.daily_budget), ads: list, stats };
  });
  const campaigns = ((c.data ?? []) as Omit<MCampaign, "adsets" | "stats">[]).map((x) => ({
    ...x, daily_budget: x.daily_budget === null ? null : Number(x.daily_budget), lifetime_budget: x.lifetime_budget === null ? null : Number(x.lifetime_budget),
    adsets: adsets.filter((s2) => s2.campaign_id === x.id).sort((p, q) => live(p) - live(q) || q.stats.spend - p.stats.spend),
    stats: campStat.get(x.id) ?? zero(),
  }))
    // some: campanhas sem gasto no período e paradas há tempo (ficam no fim, recolhidas)
    .sort((p, q) => live(p) - live(q) || q.stats.spend - p.stats.spend);
  const tot = campaigns.reduce((t, x) => ({ s: t.s + x.stats.spend, r: t.r + x.stats.result }), { s: 0, r: 0 });
  return { kind, avgCost: tot.r ? tot.s / tot.r : null, campaigns, level: Number(lv.data?.level ?? 0) };
}

// Saúde de um item comparado com a média do cliente no período (com amostra mínima)
export type Health = "bom" | "atencao" | "ruim" | "sem_dados" | "aprendendo";
export function health(s: Stats, avg: number | null): { h: Health; text: string } {
  if (s.spend < 1) return { h: "sem_dados", text: "Sem gasto no período" };
  if (!avg) return { h: "sem_dados", text: "Sem referência" };
  if (s.result === 0) return s.spend >= 2 * avg ? { h: "ruim", text: `Gastou o dobro do custo médio sem resultado` } : { h: "aprendendo", text: "Ainda sem resultado: amostra pequena" };
  const cpr = s.spend / s.result;
  // suavização: com poucos resultados o custo puxa para a média (evita julgar por acaso)
  const smooth = (s.spend + 2 * avg) / (s.result + 2);
  const r = smooth / avg;
  if (s.result < 3) return { h: "aprendendo", text: `Poucos resultados (${s.result}) para julgar` };
  if (r <= 0.9) return { h: "bom", text: `Custo ${Math.round((1 - cpr / avg) * 100)}% abaixo da média` };
  if (r <= 1.25) return { h: "atencao", text: cpr > avg ? `Custo ${Math.round((cpr / avg - 1) * 100)}% acima da média` : "Na média do cliente" };
  return { h: "ruim", text: `Custo ${Math.round((cpr / avg - 1) * 100)}% acima da média` };
}

// ---------- ações manuais ----------
export async function manualAction(input: { object_type: "campaign" | "adset" | "ad"; object_id: string; kind: "pause" | "activate" | "set_budget"; amount?: number }) {
  if (DEMO) { await wait(500); return; }
  await call("autopilot", { action: "manual", ...input });
}

// ---------- criativos ----------
const SUPA_URL = import.meta.env.VITE_SUPABASE_URL as string;
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const safe = (n: string) => n.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.-]+/g, "-").slice(-80);

async function putObject(bucket: string, path: string, body: Blob, type: string, onProgress?: (p: number) => void) {
  const { data: s } = await supabase.auth.getSession();
  await new Promise<void>((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("POST", `${SUPA_URL}/storage/v1/object/${bucket}/${path}`);
    x.setRequestHeader("authorization", `Bearer ${s.session?.access_token ?? ""}`);
    x.setRequestHeader("apikey", ANON);
    x.setRequestHeader("content-type", type || "application/octet-stream");
    x.setRequestHeader("x-upsert", "true");
    x.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    x.onload = () => (x.status >= 200 && x.status < 300 ? resolve() : reject(new Error(x.status === 413 ? "Arquivo maior que 50 MB. Comprima o vídeo e tente de novo." : `Falha no envio (${x.status})`)));
    x.onerror = () => reject(new Error("Falha de conexão no envio"));
    x.send(body);
  });
}

// Miniatura gerada no navegador (imagem reduzida ou 1º segundo do vídeo)
async function makeThumb(file: File): Promise<{ blob: Blob | null; width: number; height: number; duration_ms: number | null }> {
  const url = URL.createObjectURL(file);
  try {
    let el: HTMLImageElement | HTMLVideoElement, w: number, h: number, dur: number | null = null;
    if (file.type.startsWith("video/")) {
      const v = document.createElement("video");
      v.muted = true; v.playsInline = true; v.preload = "auto"; v.src = url;
      await new Promise((r, j) => { v.onloadeddata = r; v.onerror = j; });
      v.currentTime = Math.min(1, (v.duration || 2) / 2);
      await new Promise((r) => { v.onseeked = r; setTimeout(r, 2500); });
      el = v; w = v.videoWidth; h = v.videoHeight; dur = Math.round((v.duration || 0) * 1000);
    } else {
      const i = new Image(); i.src = url;
      await new Promise((r, j) => { i.onload = r; i.onerror = j; });
      el = i; w = i.naturalWidth; h = i.naturalHeight;
    }
    const scale = Math.min(1, 540 / Math.max(w, h));
    const c = document.createElement("canvas");
    c.width = Math.round(w * scale); c.height = Math.round(h * scale);
    c.getContext("2d")!.drawImage(el, 0, 0, c.width, c.height);
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", 0.82));
    return { blob, width: w, height: h, duration_ms: dur };
  } catch {
    return { blob: null, width: 0, height: 0, duration_ms: null };
  } finally { URL.revokeObjectURL(url); }
}

export async function uploadCreative(clientId: string, file: File, onProgress: (p: number) => void): Promise<CreativeAsset> {
  if (!/^(image|video)\//.test(file.type)) throw new Error("Envie uma imagem (JPG/PNG) ou um vídeo (MP4/MOV).");
  if (file.size > 50 * 1024 * 1024) throw new Error("Arquivo maior que 50 MB. Comprima o vídeo e tente de novo.");
  if (DEMO) { for (let p = 0; p <= 1; p += 0.25) { onProgress(p); await wait(200); } return demoAsset(file.name, file.type.startsWith("video/") ? "video" : "image"); }
  const id = crypto.randomUUID();
  const path = `${clientId}/${id}-${safe(file.name)}`;
  const thumb = await makeThumb(file);
  let thumbPath: string | null = null;
  if (thumb.blob) { thumbPath = `up/${id}.jpg`; await putObject("creative-thumbs", thumbPath, thumb.blob, "image/jpeg").catch(() => { thumbPath = null; }); }
  await putObject("creative-uploads", path, file, file.type, onProgress);
  return await call<CreativeAsset>("creatives", {
    action: "register_upload", client_id: clientId, path, name: file.name, mime: file.type, size: file.size,
    width: thumb.width, height: thumb.height, duration_ms: thumb.duration_ms, thumb_path: thumbPath,
  });
}

export async function creativeFromInstagram(clientId: string, url: string): Promise<CreativeAsset> {
  if (DEMO) { await wait(700); return demoAsset("Instagram reels — Avaliação gratuita em novembro", "video"); }
  return await call<CreativeAsset>("creatives", { action: "from_instagram", client_id: clientId, url });
}

export async function getAssets(clientId: string): Promise<CreativeAsset[]> {
  if (DEMO) return demoAssets;
  const { data, error } = await supabase.from("creative_assets").select("*").eq("client_id", clientId).eq("removed", false)
    .order("created_at", { ascending: false }).limit(60);
  if (error) throw new Error(error.message);
  return (data ?? []) as CreativeAsset[];
}

export async function removeAsset(id: string) { if (!DEMO) await call("creatives", { action: "remove", asset_id: id }); }

export type Placement = { mode: "best" } | { mode: "campaign"; campaign_id: string; adset_id?: string | null } | { mode: "new" };
export type When = "now" | "approve" | "auto";

// Um material vira anúncio. "best" = o sistema escolhe o conjunto com melhor custo; "new" = campanha nova pelo perfil.
export async function addCreative(clientId: string, asset: CreativeAsset, where: Placement, when: When): Promise<string> {
  if (DEMO) { await wait(900); return when === "now" ? "Anúncio no ar." : "Pronto para aprovar no Piloto automático."; }
  if (where.mode === "new") {
    await call("strategy", { action: "plan_launch", client_id: clientId, asset_ids: [asset.id], activate: when === "now" });
    if (when === "now") {
      // o plano foi criado ativo: executa já (mesma ação que o botão "Lançar agora")
      const { data } = await supabase.from("autopilot_actions").select("id").eq("client_id", clientId).eq("kind", "launch_campaign")
        .eq("status", "proposed").order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (data) await call("autopilot", { action: "decide", id: data.id, decision: "approve" });
      return "Campanha nova lançada e ativa.";
    }
    return "Campanha montada. Ative com um toque no Piloto automático.";
  }
  const r = await call<{ target?: { adset_name: string; campaign_name: string }; proposed?: boolean; queued?: boolean; created?: { auto: boolean }[] }>("autopilot", {
    action: "add_creative", asset_id: asset.id, mode: when,
    campaign_id: where.mode === "campaign" ? where.campaign_id : null,
    adset_id: where.mode === "campaign" ? where.adset_id ?? null : null,
  });
  if (when === "auto") return r.created?.some((x) => x.auto) ? "O piloto já colocou o criativo no ar." : "Entregue ao piloto: aparece como proposta no Piloto automático.";
  const dest = r.target ? ` em "${r.target.campaign_name}" › "${r.target.adset_name}"` : "";
  return r.proposed ? `Pronto para aprovar${dest}. Ative com um toque no Piloto automático.` : `Anúncio no ar${dest}.`;
}

// ---------- relatórios automáticos ----------
export interface Note { level: "alto" | "medio" | "baixo"; text: string }
export interface AutoReport {
  id: string; client_id: string; kind: "weekly" | "monthly"; since: string; until: string; text: string | null;
  internal: Note[]; data: Record<string, unknown>; created_at: string; sent_at: string | null; sent_by: string | null;
}
export async function getAutoReports(kind: "weekly" | "monthly"): Promise<AutoReport[]> {
  if (DEMO) return demoReports.filter((r) => r.kind === kind);
  const { data, error } = await supabase.from("client_reports").select("*").eq("kind", kind).order("until", { ascending: false }).order("created_at", { ascending: false }).limit(120);
  if (error) throw new Error(error.message);
  return (data ?? []) as AutoReport[];
}
export async function markSent(id: string, sent: boolean, text?: string) {
  if (DEMO) { const r = demoReports.find((x) => x.id === id); if (r) r.sent_at = sent ? new Date().toISOString() : null; return; }
  const { data: u } = await supabase.auth.getUser();
  const { error } = await supabase.from("client_reports").update({ sent_at: sent ? new Date().toISOString() : null, sent_by: sent ? u.user?.email ?? null : null, ...(text !== undefined ? { text } : {}) }).eq("id", id);
  if (error) throw new Error(error.message);
}
export async function generateReports(kind: "weekly" | "monthly", clientId?: string) {
  if (DEMO) { await wait(800); return; }
  await call("strategy", { action: kind === "weekly" ? "weekly_reports" : "monthly_reports", ...(clientId ? { client_id: clientId } : {}) });
}

// ---------- demonstração ----------
const st = (spend: number, result: number, impressions = spend * 90): Stats => ({ spend, result, impressions, clicks: Math.round(impressions * 0.012), value: 0, days: 7 });
function demoTree(): Tree {
  const ad = (id: string, name: string, s: Stats, eff = "ACTIVE"): MAd => ({ id, name, status: eff === "ACTIVE" ? "ACTIVE" : "PAUSED", effective_status: eff, image_url: null, format: "video", stats: s });
  const a1 = [ad("a1", "AD 04 — depoimento ciático", st(41, 8)), ad("a2", "AD 03 — avaliação gratuita", st(15.9, 2)), ad("a3", "AD 01 — tour clínica", st(24.6, 1), "PAUSED")];
  const a2 = [ad("a4", "AD 02 — pilates", st(18.8, 2))];
  const sum = (l: MAd[]) => l.reduce((t, x) => ({ ...t, spend: t.spend + x.stats.spend, result: t.result + x.stats.result, impressions: t.impressions + x.stats.impressions }), zero());
  return {
    kind: "conversation", avgCost: 7.71, level: 1,
    campaigns: [
      { id: "c1", name: "[CONV] Coluna — WhatsApp — Uruguaiana", status: "ACTIVE", effective_status: "ACTIVE", objective: "OUTCOME_ENGAGEMENT", daily_budget: 20, lifetime_budget: null, ad_account_id: "act_2",
        adsets: [{ id: "s1", name: "Uruguaiana +25 km · 30–60", status: "ACTIVE", effective_status: "ACTIVE", daily_budget: null, ad_account_id: "act_2", ads: a1, stats: sum(a1) }], stats: sum(a1) },
      { id: "c2", name: "[CONV] Pilates — WhatsApp", status: "ACTIVE", effective_status: "ACTIVE", objective: "OUTCOME_ENGAGEMENT", daily_budget: null, lifetime_budget: null, ad_account_id: "act_2",
        adsets: [{ id: "s2", name: "Uruguaiana +17 km · mulheres 25–55", status: "ACTIVE", effective_status: "ACTIVE", daily_budget: 10, ad_account_id: "act_2", ads: a2, stats: sum(a2) }], stats: sum(a2) },
    ],
  };
}
function demoAsset(name: string, kind: "image" | "video"): CreativeAsset {
  return { id: crypto.randomUUID(), client_id: "c2", drive_file_id: "", source: "upload", name, mime_type: null, kind, size_bytes: null, width: 1080, height: 1920, duration_ms: null,
    thumbnail_url: null, web_view_link: null, folder_name: "Enviados no painel", drive_modified_at: new Date().toISOString(), meta: {}, removed: false };
}
const demoAssets: CreativeAsset[] = [demoAsset("reels-avaliacao-novembro.mp4", "video"), demoAsset("oferta-pilates.jpg", "image")];
const demoReports: AutoReport[] = [
  { id: "r1", client_id: "c2", kind: "weekly", since: "2026-10-30", until: "2026-11-05", created_at: new Date().toISOString(), sent_at: null, sent_by: null, data: {},
    text: "*Relatório semanal · Clínica Flamboyant*\n30/out a 5/nov\n\n*Resultados da semana*\n• 36 conversas no WhatsApp\n• R$ 8,44 por conversa\n• R$ 303,91 investidos\n• 16.721 pessoas alcançadas\n\n*Destaque*\nO anúncio \"AD 01\" trouxe 18 conversas (50% do total), a R$ 3,39 cada.\n\n*Próximos passos*\n• Manter o que está funcionando e seguir testando criativos novos.\n\n_Impacto · gestão de tráfego_",
    internal: [{ level: "alto", text: "Anúncio \"AD 03\" gastou R$ 41,20 sem nenhum resultado e continua ativo." }, { level: "baixo", text: "Conversas não são vendas: confirme com o cliente quantas viraram venda." }] },
  { id: "r2", client_id: "c2", kind: "monthly", since: "2026-10-01", until: "2026-10-31", created_at: new Date().toISOString(), sent_at: null, sent_by: null, text: null,
    internal: [{ level: "medio", text: "Gargalo em \"Atenção (pararam 3 s)\": 10,79% contra 16,14% na média do cliente." }],
    data: {
      kind: "conversation", next: ["Trazer criativos novos para o público não se cansar dos mesmos anúncios.", "Concentrar a verba em Facebook Feed e Instagram Stories, os mais baratos.", "Testar um novo gancho nos 3 primeiros segundos dos vídeos."],
      summary: { cpr: 6.16, roas: 0, reach: 9632, spend: 344.91, value: 0, result: 56, prev_result: 41, prev_cpr: 5.52, frequency: 4.06, impressions: 39137, period_impressions: 39137, prev_spend: 226.19 },
      ads: [{ id: "a1", name: "AD 04", result: 39, spend: 197.43, cpr: 5.06, image_url: null, status: "ACTIVE" }, { id: "a2", name: "AD 03", result: 17, spend: 147.48, cpr: 8.68, image_url: null, status: "ACTIVE" }, { id: "a3", name: "AD 02", result: 2, spend: 18.84, cpr: 9.42, image_url: null, status: "ACTIVE" }],
      actions: [{ kind: "pause", rule: "pause_expensive", object_type: "ad", object_name: "AD 01", campaign_name: "[CONV] Colchões", evidence: { resultados: 1, custo: 24.57, gasto: 24.57 } },
        { kind: "set_budget", rule: "scale_up", object_type: "campaign", object_name: "[CONV] Colchões", campaign_name: "[CONV] Colchões", evidence: null }],
      daily: Array.from({ length: 31 }, (_, i) => ({ date: `2026-10-${String(i + 1).padStart(2, "0")}`, spend: 11 + (i % 5), conversations: [1, 3, 2, 0, 4, 2, 1][i % 7], leads: 0, purchases: 0, link_clicks: 8 })),
      analysis: { cuts: {
        placement: [{ label: "Facebook · Feed", result: 28, spend: 152.72, share: 0.39, cpr: 5.45 }, { label: "Instagram · Stories", result: 13, spend: 72.93, share: 0.19, cpr: 5.61 }, { label: "Instagram · Feed", result: 7, spend: 69.75, share: 0.18, cpr: 9.96 }, { label: "Facebook · Stories", result: 6, spend: 34.34, share: 0.09, cpr: 5.72 }],
        age_gender: [{ label: "45-54 · Mulheres", result: 18, spend: 98.27, share: 0.25, cpr: 5.46 }, { label: "35-44 · Mulheres", result: 18, spend: 91.23, share: 0.23, cpr: 5.07 }, { label: "55-64 · Mulheres", result: 6, spend: 43.45, share: 0.11, cpr: 7.24 }],
      } },
    } },
];
