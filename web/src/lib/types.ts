export type Health = "red" | "yellow" | "green";

export type Objective =
  | "a_definir" | "conversas_whatsapp" | "reconhecimento" | "trafego" | "vendas" | "leads" | "misto";

export const OBJECTIVE_LABEL: Record<Objective, string> = {
  a_definir: "A definir",
  conversas_whatsapp: "Conversas no WhatsApp",
  reconhecimento: "Reconhecimento",
  trafego: "Tráfego",
  vendas: "Vendas",
  leads: "Leads",
  misto: "Misto",
};

export interface ClientOverview {
  client_id: string;
  name: string;
  objective: Objective;
  monthly_budget: number | null;
  spend_yesterday: number;
  spend_7d: number;
  conversations_7d: number;
  cost_per_conv_7d: number | null;
  cost_per_conv_prev_7d: number | null;
  cpm_7d: number | null;
  ctr_link_7d: number | null;
  freq_7d: number | null;
  spend_month: number;
  critical_open: number;
  warning_open: number;
  health: Health;
  last_synced_at: string | null;
}

export interface AdAccount {
  id: string;
  client_id: string;
  name: string | null;
  account_status: number | null;
  prepaid_balance: number | null;
  spend_cap: number | null;
  amount_spent: number | null;
  last_synced_at: string | null;
  last_sync_error: string | null;
}

export interface Alert {
  id: string;
  client_id: string;
  type: string;
  severity: "info" | "warning" | "critical";
  title: string;
  status: "open" | "acknowledged" | "resolved";
  created_at: string;
  last_seen_at: string;
  resolved_at: string | null;
}

export interface DailyPoint {
  date: string;
  spend: number;
  conversations: number;
  impressions?: number;
  link_clicks?: number;
}

export interface CampaignStat {
  campaign_id: string;
  name: string | null;
  objective: string | null;
  effective_status: string | null;
  daily_budget: number | null;
  spend: number;
  conversations: number;
  impressions: number;
  link_clicks: number;
  cost_per_conversation: number | null;
  ctr: number | null;
  cpm: number | null;
}

export interface AdStat {
  ad_id: string;
  name: string | null;
  campaign_name: string | null;
  effective_status: string | null;
  thumbnail_url: string | null;
  spend: number;
  conversations: number;
  impressions: number;
  link_clicks: number;
  cost_per_conversation: number | null;
  ctr: number | null;
}

export interface ClientRow {
  id: string;
  name: string;
  objective: Objective;
  monthly_budget: number | null;
  active: boolean;
}

export interface AlertRule {
  id: string;
  client_id: string | null;
  type: string;
  threshold: number | null;
  window_days: number;
  enabled: boolean;
}

export interface SyncRun {
  id: number;
  started_at: string;
  finished_at: string | null;
  accounts_ok: number;
  accounts_err: number;
}
