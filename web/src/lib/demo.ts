// Dados fictícios só para o modo demonstração (?demo). Não são usados em produção.
import type { AdAccount, AdStat, Alert, CampaignStat, ClientOverview, ClientRow, DailyPoint, SyncRun } from "./types";

const base = (o: Partial<ClientOverview> & Pick<ClientOverview, "client_id" | "name">): ClientOverview => ({
  objective: "a_definir", monthly_budget: null, spend_yesterday: 0, spend_7d: 0, conversations_7d: 0,
  cost_per_conv_7d: null, cost_per_conv_prev_7d: null, cpm_7d: null, ctr_link_7d: null, freq_7d: null,
  spend_month: 0, critical_open: 0, warning_open: 0, health: "green", last_synced_at: new Date().toISOString(), ...o,
});

export const overview: ClientOverview[] = [
  base({ client_id: "c1", name: "1001 Embalagens", spend_7d: 41.2, conversations_7d: 1, cost_per_conv_7d: 41.2, cost_per_conv_prev_7d: 62.1, cpm_7d: 9.8, ctr_link_7d: 0.9, freq_7d: 2.21, spend_month: 160.3, critical_open: 2, health: "red" }),
  base({ client_id: "c2", name: "Clínica Flamboyant", objective: "conversas_whatsapp", monthly_budget: 1000, spend_yesterday: 33.9, spend_7d: 228.4, conversations_7d: 25, cost_per_conv_7d: 9.14, cost_per_conv_prev_7d: 10.2, cpm_7d: 14.1, ctr_link_7d: 1.4, freq_7d: 1.97, spend_month: 471.9 }),
  base({ client_id: "c3", name: "Dotto", spend_yesterday: 20.1, spend_7d: 139.8, conversations_7d: 23, cost_per_conv_7d: 6.08, cost_per_conv_prev_7d: 5.4, cpm_7d: 11.3, ctr_link_7d: 1.1, freq_7d: 2.9, spend_month: 284.0, warning_open: 0 }),
  base({ client_id: "c4", name: "Grill Camobi", spend_7d: 0, conversations_7d: 0, freq_7d: 1.28, spend_month: 61.5, critical_open: 2, health: "red" }),
  base({ client_id: "c5", name: "Ortobom", spend_yesterday: 8.5, spend_7d: 60.7, conversations_7d: 12, cost_per_conv_7d: 5.06, cost_per_conv_prev_7d: 4.7, cpm_7d: 7.9, ctr_link_7d: 0.8, freq_7d: 1.86, spend_month: 122.9 }),
  base({ client_id: "c6", name: "Rispoli", last_synced_at: null }),
  base({ client_id: "c7", name: "Rodomann", objective: "misto", last_synced_at: null }),
];

export const accounts: AdAccount[] = [
  { id: "act_1", client_id: "c1", name: "C01 1001 EMBALAGENS", account_status: 1, prepaid_balance: 0, spend_cap: 5335.03, amount_spent: 5335.03, last_synced_at: new Date().toISOString(), last_sync_error: null },
  { id: "act_2", client_id: "c2", name: "clinica", account_status: 1, prepaid_balance: 281.13, spend_cap: null, amount_spent: null, last_synced_at: new Date().toISOString(), last_sync_error: null },
  { id: "act_3", client_id: "c3", name: "Dotto Auto Peças", account_status: 1, prepaid_balance: 250.93, spend_cap: null, amount_spent: null, last_synced_at: new Date().toISOString(), last_sync_error: null },
  { id: "act_4", client_id: "c4", name: "CA - Grill Camobi", account_status: 1, prepaid_balance: 0, spend_cap: null, amount_spent: null, last_synced_at: new Date().toISOString(), last_sync_error: null },
  { id: "act_5", client_id: "c5", name: "ORTOBOM URUGUAIANA", account_status: 1, prepaid_balance: 159.24, spend_cap: null, amount_spent: null, last_synced_at: new Date().toISOString(), last_sync_error: null },
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
    out.push({ date: d.toISOString().slice(0, 10), spend: Math.round(31 * scale * w * 100) / 100, conversations: Math.round(3.4 * scale * w * (0.8 + 0.4 * Math.cos(i))) });
  }
  return out;
}

export const campaigns: CampaignStat[] = [
  { campaign_id: "1", name: "[CONV] Coluna — WhatsApp — Uruguaiana", objective: "OUTCOME_ENGAGEMENT", effective_status: "ACTIVE", daily_budget: 25, spend: 171.2, conversations: 19, impressions: 12100, link_clicks: 160, cost_per_conversation: 9.01, ctr: 1.32, cpm: 14.15 },
  { campaign_id: "2", name: "[CONV] Hérnia de disco — remarketing", objective: "OUTCOME_ENGAGEMENT", effective_status: "ACTIVE", daily_budget: 10, spend: 57.2, conversations: 6, impressions: 4100, link_clicks: 71, cost_per_conversation: 9.53, ctr: 1.73, cpm: 13.95 },
  { campaign_id: "3", name: "[REC] Institucional — agosto", objective: "OUTCOME_AWARENESS", effective_status: "PAUSED", daily_budget: null, spend: 0, conversations: 0, impressions: 0, link_clicks: 0, cost_per_conversation: null, ctr: null, cpm: null },
];

export const ads: AdStat[] = [
  { ad_id: "1", name: "Vídeo — dor lombar ao acordar", campaign_name: campaigns[0].name, effective_status: "ACTIVE", thumbnail_url: null, spend: 98.4, conversations: 13, impressions: 6900, link_clicks: 101, cost_per_conversation: 7.57, ctr: 1.46 },
  { ad_id: "2", name: "Carrossel — 3 sinais de hérnia", campaign_name: campaigns[1].name, effective_status: "ACTIVE", thumbnail_url: null, spend: 57.2, conversations: 6, impressions: 4100, link_clicks: 71, cost_per_conversation: 9.53, ctr: 1.73 },
  { ad_id: "3", name: "Imagem — avaliação gratuita", campaign_name: campaigns[0].name, effective_status: "ACTIVE", thumbnail_url: null, spend: 72.8, conversations: 6, impressions: 5200, link_clicks: 59, cost_per_conversation: 12.13, ctr: 1.13 },
];

export const clients: ClientRow[] = overview.map((o) => ({
  id: o.client_id, name: o.name, objective: o.objective, monthly_budget: o.monthly_budget, active: true,
}));

export const lastSync: SyncRun = { id: 9, started_at: now, finished_at: now, accounts_ok: 5, accounts_err: 5 };

export function period(since: string, until: string, compare: boolean) {
  const t = { spend: 195.63, impressions: 29483, reach: 14946, frequency: 1.97, clicks: 312, link_clicks: 80,
    conversations: 33, leads: 0, landing_page_views: 0, video_views: 8120, engagement: 9411 };
  const p = { ...t, spend: 174.2, conversations: 27, reach: 13010, impressions: 26100, link_clicks: 71, frequency: 2.01 };
  return {
    since, until, days: 7, previous_range: compare ? { since, until } : null, fetched_at: new Date().toISOString(),
    multiple_accounts: false, totals: t, previous_totals: compare ? p : null,
    panel: { spend: 195.63, impressions: 29483, clicks: 312, link_clicks: 80, conversations: 33, leads: 0, video_views: 8120, days: 7 },
    accounts: [{ id: "act_2", name: "clinica", current: t, previous: compare ? p : null,
      balance: { spend_cap: 2459.85, amount_spent: 2231.65, available: 228.2, display_string: "Saldo disponível (R$259,76 BRL)", display_value: 259.76 }, error: null }],
  };
}
