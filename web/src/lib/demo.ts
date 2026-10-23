// Dados fictícios só para o modo demonstração (?demo). Não são usados em produção.
import type { AdAccount, AdStat, Alert, CampaignStat, ClientOverview, ClientRow, CreativeDay, CreativeStat, DailyPoint, SyncRun } from "./types";

const base = (o: Partial<ClientOverview> & Pick<ClientOverview, "client_id" | "name">): ClientOverview => ({
  objective: "a_definir", monthly_budget: null, spend_yesterday: 0, spend_7d: 0, conversations_7d: 0,
  cost_per_conv_7d: null, cost_per_conv_prev_7d: null, cpm_7d: null, ctr_link_7d: null, freq_7d: null,
  spend_month: 0, critical_open: 0, warning_open: 0, health: "green", last_synced_at: new Date().toISOString(),
  purchases_7d: 0, revenue_7d: 0, roas_7d: null, cost_per_purchase_7d: null, cost_per_purchase_prev_7d: null, roas_prev_7d: null, ...o,
});

export const overview: ClientOverview[] = [
  base({ client_id: "c1", name: "1001 Embalagens", spend_7d: 41.2, conversations_7d: 1, cost_per_conv_7d: 41.2, cost_per_conv_prev_7d: 62.1, cpm_7d: 9.8, ctr_link_7d: 0.9, freq_7d: 2.21, spend_month: 160.3, critical_open: 2, health: "red" }),
  base({ client_id: "c2", name: "Clínica Flamboyant", objective: "conversas_whatsapp", monthly_budget: 1000, spend_yesterday: 33.9, spend_7d: 228.4, conversations_7d: 25, cost_per_conv_7d: 9.14, cost_per_conv_prev_7d: 10.2, cpm_7d: 14.1, ctr_link_7d: 1.4, freq_7d: 1.97, spend_month: 471.9 }),
  base({ client_id: "c3", name: "Dotto", spend_yesterday: 20.1, spend_7d: 139.8, conversations_7d: 23, cost_per_conv_7d: 6.08, cost_per_conv_prev_7d: 5.4, cpm_7d: 11.3, ctr_link_7d: 1.1, freq_7d: 2.9, spend_month: 284.0, warning_open: 0 }),
  base({ client_id: "c4", name: "Grill Camobi", spend_7d: 0, conversations_7d: 0, freq_7d: 1.28, spend_month: 61.5, critical_open: 2, health: "red" }),
  base({ client_id: "c5", name: "Ortobom", spend_yesterday: 8.5, spend_7d: 60.7, conversations_7d: 12, cost_per_conv_7d: 5.06, cost_per_conv_prev_7d: 4.7, cpm_7d: 7.9, ctr_link_7d: 0.8, freq_7d: 1.86, spend_month: 122.9 }),
  base({ client_id: "c8", name: "Marcelo's Pastello", objective: "vendas", spend_yesterday: 41.3, spend_7d: 286.48, conversations_7d: 0, purchases_7d: 31, revenue_7d: 1487.6, roas_7d: 5.19, cost_per_purchase_7d: 9.24, cost_per_purchase_prev_7d: 10.1, roas_prev_7d: 4.6, freq_7d: 1.6, spend_month: 345.45 }),
  base({ client_id: "c6", name: "Rispoli", last_synced_at: null }),
  base({ client_id: "c7", name: "Rodomann", objective: "misto", last_synced_at: null }),
];

export const accounts: AdAccount[] = [
  { id: "act_1", client_id: "c1", name: "C01 1001 EMBALAGENS", account_status: 1, prepaid_balance: 0, spend_cap: 5335.03, amount_spent: 5335.03, last_synced_at: new Date().toISOString(), last_sync_error: null },
  { id: "act_2", client_id: "c2", name: "clinica", account_status: 1, prepaid_balance: 281.13, spend_cap: null, amount_spent: null, last_synced_at: new Date().toISOString(), last_sync_error: null },
  { id: "act_3", client_id: "c3", name: "Dotto Auto Peças", account_status: 1, prepaid_balance: 250.93, spend_cap: null, amount_spent: null, last_synced_at: new Date().toISOString(), last_sync_error: null },
  { id: "act_4", client_id: "c4", name: "CA - Grill Camobi", account_status: 1, prepaid_balance: 0, spend_cap: null, amount_spent: null, last_synced_at: new Date().toISOString(), last_sync_error: null },
  { id: "act_5", client_id: "c5", name: "ORTOBOM URUGUAIANA", account_status: 1, prepaid_balance: 159.24, spend_cap: null, amount_spent: null, last_synced_at: new Date().toISOString(), last_sync_error: null },
  { id: "act_8", client_id: "c8", name: "Marcelo's", account_status: 1, prepaid_balance: 580.49, spend_cap: 1493.46, amount_spent: 983.5, last_synced_at: new Date().toISOString(), last_sync_error: null },
  { id: "act_6", client_id: "c6", name: null, account_status: null, prepaid_balance: null, spend_cap: null, amount_spent: null, last_synced_at: null, last_sync_error: "Meta API (200): (#200) Ad account owner has NOT grant ads_management or ads_read permission" },
  { id: "act_7", client_id: "c7", name: null, account_status: null, prepaid_balance: null, spend_cap: null, amount_spent: null, last_synced_at: null, last_sync_error: "Meta API (200): (#200) Ad account owner has NOT grant ads_management or ads_read permission" },
];

const now = new Date().toISOString();
export const alerts: Alert[] = [
  { id: "a1", client_id: "c1", type: "spend_cap", severity: "critical", title: "1001 Embalagens: conta sem saldo — anúncios parados até recarregar", status: "open", created_at: now, last_seen_at: now, resolved_at: null },
  { id: "a2", client_id: "c1", type: "no_delivery", severity: "critical", title: "1001 Embalagens: campanhas ativas sem nenhuma entrega ontem (15/10)", status: "open", created_at: now, last_seen_at: now, resolved_at: null },
  { id: "a3", client_id: "c4", type: "spend_cap", severity: "critical", title: "Grill Camobi: conta sem saldo — anúncios parados até recarregar", status: "open", created_at: now, last_seen_at: now, resolved_at: null },
  { id: "a4", client_id: "c4", type: "no_delivery", severity: "critical", title: "Grill Camobi: campanhas ativas sem nenhuma entrega ontem (15/10)", status: "open", created_at: now, last_seen_at: now, resolved_at: null },
];

export function daily(days: number, scale: number): DailyPoint[] {
  const out: DailyPoint[] = [];
  const t = new Date(); t.setDate(t.getDate() - 1);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(t); d.setDate(t.getDate() - i);
    const w = 0.75 + 0.5 * Math.abs(Math.sin(i * 1.7));
    const purchases = Math.round(4.4 * scale * w * (0.8 + 0.4 * Math.sin(i)));
    out.push({ date: d.toISOString().slice(0, 10), spend: Math.round(31 * scale * w * 100) / 100, conversations: Math.round(3.4 * scale * w * (0.8 + 0.4 * Math.cos(i))),
      purchases, purchase_value: Math.round(purchases * 48.5 * 100) / 100 });
  }
  return out;
}

const campaignsRaw = [
  { campaign_id: "1", name: "[CONV] Coluna — WhatsApp — Uruguaiana", objective: "OUTCOME_ENGAGEMENT", effective_status: "ACTIVE", daily_budget: 25, spend: 171.2, conversations: 19, impressions: 12100, link_clicks: 160, cost_per_conversation: 9.01, ctr: 1.32, cpm: 14.15 },
  { campaign_id: "2", name: "[CONV] Hérnia de disco — remarketing", objective: "OUTCOME_ENGAGEMENT", effective_status: "ACTIVE", daily_budget: 10, spend: 57.2, conversations: 6, impressions: 4100, link_clicks: 71, cost_per_conversation: 9.53, ctr: 1.73, cpm: 13.95 },
  { campaign_id: "3", name: "[REC] Institucional — agosto", objective: "OUTCOME_AWARENESS", effective_status: "PAUSED", daily_budget: null, spend: 0, conversations: 0, impressions: 0, link_clicks: 0, cost_per_conversation: null, ctr: null, cpm: null },
];

const adsRaw = [
  { ad_id: "1", name: "Vídeo — dor lombar ao acordar", campaign_name: campaignsRaw[0].name, effective_status: "ACTIVE", thumbnail_url: null, spend: 98.4, conversations: 13, impressions: 6900, link_clicks: 101, cost_per_conversation: 7.57, ctr: 1.46 },
  { ad_id: "2", name: "Carrossel — 3 sinais de hérnia", campaign_name: campaignsRaw[1].name, effective_status: "ACTIVE", thumbnail_url: null, spend: 57.2, conversations: 6, impressions: 4100, link_clicks: 71, cost_per_conversation: 9.53, ctr: 1.73 },
  { ad_id: "3", name: "Imagem — avaliação gratuita", campaign_name: campaignsRaw[0].name, effective_status: "ACTIVE", thumbnail_url: null, spend: 72.8, conversations: 6, impressions: 5200, link_clicks: 59, cost_per_conversation: 12.13, ctr: 1.13 },
];

const sale = (i: number, spend: number) => {
  const purchases = [19, 12, 0][i] ?? 0, value = [992.4, 495.2, 0][i] ?? 0;
  return { purchases, purchase_value: value, roas: spend ? Math.round((value / spend) * 100) / 100 : null, cost_per_purchase: purchases ? Math.round((spend / purchases) * 100) / 100 : null };
};
export const campaigns: CampaignStat[] = campaignsRaw.map((c, i) => ({ ...c, ...sale(i, c.spend) }));
export const ads: AdStat[] = adsRaw.map((a, i) => ({ ...a, ...sale(i, a.spend) }));

export const clients: ClientRow[] = overview.map((o) => ({
  id: o.client_id, name: o.name, objective: o.objective, monthly_budget: o.monthly_budget, active: true,
}));

export const lastSync: SyncRun = { id: 9, started_at: now, finished_at: now, accounts_ok: 5, accounts_err: 5 };

export function period(since: string, until: string, compare: boolean, campaignIds: string[] = []) {
  const t = { spend: 195.63, impressions: 29483, reach: 14946, frequency: 1.97, clicks: 312, link_clicks: 80,
    conversations: 33, leads: 0, landing_page_views: 0, video_views: 8120, engagement: 9411,
    purchases: 31, purchase_value: 1487.6, add_to_cart: 77, checkouts: 52 };
  const p = { ...t, spend: 174.2, conversations: 27, reach: 13010, impressions: 26100, link_clicks: 71, frequency: 2.01 };
  return {
    since, until, days: 7, previous_range: compare ? { since, until } : null, fetched_at: new Date().toISOString(),
    multiple_accounts: false, campaigns: campaigns.filter((c) => campaignIds.includes(c.campaign_id)).map((c) => ({ id: c.campaign_id, name: c.name })), totals: t, previous_totals: compare ? p : null,
    panel: { spend: 195.63, impressions: 29483, clicks: 312, link_clicks: 80, conversations: 33, leads: 0, video_views: 8120, purchases: 31, purchase_value: 1487.6, days: 7 },
    accounts: [{ id: "act_2", name: "clinica", current: t, previous: compare ? p : null,
      balance: { spend_cap: 2459.85, amount_spent: 2231.65, available: 228.2, display_string: "Saldo disponível (R$259,76 BRL)", display_value: 259.76 }, error: null }],
  };
}

// ---------- Criativos (demonstração) ----------
type C = Partial<CreativeStat> & Pick<CreativeStat, "ad_id" | "client_id" | "name" | "spend" | "impressions">;
const cr = (o: C): CreativeStat => {
  const ov = overview.find((x) => x.client_id === o.client_id)!;
  const video = (o.format ?? "video") === "video";
  const imp = o.impressions, plays = video ? Math.round(imp * 0.88) : 0;
  const hook = o.video_3s ?? (video ? Math.round(imp * 0.18) : 0);
  const thru = o.thruplays ?? (video ? Math.round(hook * 0.32) : 0);
  return {
    client_name: ov.name, client_objective: ov.objective, ad_account_id: "act_demo", campaign_name: "[CONV] Campanha principal",
    campaign_objective: "OUTCOME_ENGAGEMENT", effective_status: "ACTIVE", format: "video", thumbnail_url: null, image_url: null,
    preview_url: "https://www.facebook.com", post_url: null, body: null, title: null, cta_type: "WHATSAPP_MESSAGE",
    created_time: null, quality_ranking: null, engagement_ranking: null, conversion_ranking: null, freq_7d: 1.6,
    days_active: 14, first_day: null, last_day: null, reach_sum: Math.round(imp * 0.6), clicks: Math.round(imp * 0.02),
    link_clicks: Math.round(imp * 0.006), conversations: 0, leads: 0, purchases: 0, purchase_value: 0,
    video_3s: hook, video_plays: plays, thruplays: thru,
    video_p25: Math.round(plays * 0.42), video_p50: Math.round(plays * 0.26), video_p75: Math.round(plays * 0.17),
    video_p95: Math.round(plays * 0.11), video_p100: Math.round(plays * 0.09), video_avg_time: video ? 5.4 : null,
    reactions: Math.round(imp * 0.006), comments: Math.round(imp * 0.0004), shares: Math.round(imp * 0.0005), saves: Math.round(imp * 0.0002),
    imp_recent: Math.round(imp * 0.5), clicks_recent: Math.round(imp * 0.003), imp_before: Math.round(imp * 0.5), clicks_before: Math.round(imp * 0.003),
    ...o,
  };
};

const CREATIVES: CreativeStat[] = [
  cr({ ad_id: "d1", client_id: "c2", name: "Vídeo — dor no ciático (depoimento)", spend: 362.9, impressions: 58814, conversations: 45, link_clicks: 150,
    video_3s: 15920, thruplays: 6247, quality_ranking: "above_average", engagement_ranking: "above_average", conversion_ranking: "average", freq_7d: 1.87,
    title: "Agende sua consulta", body: "Dor na coluna e no nervo ciático não são a mesma coisa. 👇\n\nO ciático dói da lombar até a perna, formiga e piora quando você fica muito tempo sentado.\n\nNa Clínica Flamboyant a avaliação mostra a origem da dor e o tratamento começa no mesmo dia.\n\n📲 Toque em Enviar mensagem e agende sua avaliação." }),
  cr({ ad_id: "d2", client_id: "c2", name: "Vídeo — Pilates é evolução", spend: 295.9, impressions: 26137, conversations: 18, link_clicks: 122,
    video_3s: 6165, thruplays: 1396, imp_recent: 9000, clicks_recent: 30, imp_before: 17000, clicks_before: 92, freq_7d: 2.4,
    title: "Agende sua consulta", body: "🧘‍♀️ Não é só sobre exercício. É sobre evolução.\n\nO Pilates fortalece, alinha a postura e devolve a confiança no seu corpo." }),
  cr({ ad_id: "d3", client_id: "c2", name: "Vídeo — tour pela clínica", spend: 181.9, impressions: 25481, conversations: 8, link_clicks: 49,
    video_3s: 2683, thruplays: 1165, engagement_ranking: "below_average_35", body: "📍 No coração de Uruguaiana, um novo espaço para cuidar de você." }),
  cr({ ad_id: "d4", client_id: "c2", name: "Vídeo — tendinite no cotovelo", spend: 46.2, impressions: 820, conversations: 2, link_clicks: 6 }),
  cr({ ad_id: "d5", client_id: "c8", name: "Imagem — combo pastel + refri", format: "imagem", spend: 210.4, impressions: 31200, link_clicks: 402,
    purchases: 52, purchase_value: 4890.5, cta_type: "ORDER_NOW", quality_ranking: "above_average", conversion_ranking: "above_average",
    title: "Peça já o seu", body: "Pastel crocante, recheio de verdade. 🥟\nCombo pastel + refrigerante com entrega grátis hoje." }),
  cr({ ad_id: "d6", client_id: "c8", name: "Vídeo — bastidores da cozinha", spend: 180.1, impressions: 24400, link_clicks: 170, purchases: 21,
    purchase_value: 1630.2, cta_type: "ORDER_NOW", video_3s: 6100, thruplays: 1220, body: "Tudo feito na hora. Veja como nasce o seu pastel." }),
  cr({ ad_id: "d7", client_id: "c8", name: "Vídeo — promoção de terça", spend: 140.6, impressions: 21000, link_clicks: 60, purchases: 6, purchase_value: 302.4,
    cta_type: "ORDER_NOW", video_3s: 2200, thruplays: 480, quality_ranking: "below_average_20" }),
  cr({ ad_id: "d8", client_id: "c3", name: "Vídeo — peça certa na primeira", spend: 312.0, impressions: 40100, conversations: 71, link_clicks: 98,
    video_3s: 8020, thruplays: 1900, body: "Não sabe o código da peça? Manda a foto que a gente encontra. 🔧" }),
  cr({ ad_id: "d9", client_id: "c3", name: "Carrossel — ofertas da semana", format: "carrossel", spend: 210.2, impressions: 30500, conversations: 30, link_clicks: 120 }),
  cr({ ad_id: "d10", client_id: "c3", name: "Vídeo — entrega no mesmo dia", spend: 185.4, impressions: 26000, conversations: 23, link_clicks: 41,
    video_3s: 4100, thruplays: 380, freq_7d: 3.9 }),
];

export function creatives(clientId: string | null): CreativeStat[] {
  return CREATIVES.filter((c) => !clientId || c.client_id === clientId);
}

export function creativeDaily(adId: string, days: number): CreativeDay[] {
  const c = CREATIVES.find((x) => x.ad_id === adId) ?? CREATIVES[0];
  const out: CreativeDay[] = [];
  const t = new Date(); t.setDate(t.getDate() - 1);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(t); d.setDate(t.getDate() - i);
    const on = i < c.days_active;
    const w = on ? (0.7 + 0.6 * Math.abs(Math.sin(i * 1.3))) / c.days_active : 0;
    out.push({ date: d.toISOString().slice(0, 10), spend: Math.round(c.spend * w * 100) / 100, impressions: Math.round(c.impressions * w),
      link_clicks: Math.round(c.link_clicks * w), conversations: Math.round(c.conversations * w), leads: Math.round(c.leads * w), purchases: Math.round(c.purchases * w),
      purchase_value: Math.round(c.purchase_value * w), video_3s: Math.round(c.video_3s * w), thruplays: Math.round(c.thruplays * w) });
  }
  return out;
}
