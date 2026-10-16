// Totais de período vindos ao vivo do Meta + utilidades de datas (fuso de Brasília)

export interface Totals {
  spend: number; impressions: number; reach: number; frequency: number; clicks: number; link_clicks: number;
  conversations: number; leads: number; landing_page_views: number; video_views: number; engagement: number;
  purchases: number; purchase_value: number; add_to_cart: number; checkouts: number;
}

export interface Balance {
  spend_cap: number | null; amount_spent: number | null; available: number | null;
  display_string: string | null; display_value: number | null;
}

export interface PeriodResult {
  since: string; until: string; days: number;
  previous_range: { since: string; until: string } | null;
  fetched_at: string;
  multiple_accounts: boolean;
  campaigns?: { id: string; name: string | null }[];
  totals: Totals | null;
  previous_totals: Totals | null;
  panel: { spend: number; impressions: number; clicks: number; link_clicks: number; conversations: number; leads: number; video_views: number; purchases?: number; purchase_value?: number; days: number };
  accounts: { id: string; name: string | null; current: Totals | null; previous: Totals | null; balance: Balance | null; error: string | null }[];
}

// Data de hoje em Brasília (AAAA-MM-DD), independente do fuso do computador
export function brToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}
export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function daysBetween(a: string, b: string) {
  return Math.round((new Date(`${b}T12:00:00Z`).getTime() - new Date(`${a}T12:00:00Z`).getTime()) / 86400000) + 1;
}
export function brDate(iso: string, withYear = false) {
  const [y, m, d] = iso.split("-");
  return withYear ? `${d}/${m}/${y}` : `${d}/${m}`;
}

export type PresetId = "last7" | "lastweek" | "thismonth" | "lastmonth" | "custom";
export const PRESETS: { id: PresetId; label: string }[] = [
  { id: "last7", label: "Últimos 7 dias" },
  { id: "lastweek", label: "Semana passada (seg a dom)" },
  { id: "thismonth", label: "Este mês" },
  { id: "lastmonth", label: "Mês passado" },
  { id: "custom", label: "Personalizado" },
];

// Mesmas definições do Gerenciador: "últimos 7 dias" termina ontem
export function presetRange(id: PresetId): { since: string; until: string } {
  const today = brToday();
  const yesterday = addDays(today, -1);
  if (id === "last7") return { since: addDays(today, -7), until: yesterday };
  if (id === "lastweek") {
    const dow = new Date(`${today}T12:00:00Z`).getUTCDay(); // 0 = domingo
    const lastSunday = addDays(today, -(dow === 0 ? 7 : dow));
    return { since: addDays(lastSunday, -6), until: lastSunday };
  }
  if (id === "thismonth") return { since: `${today.slice(0, 8)}01`, until: today.slice(8) === "01" ? today : yesterday };
  // mês passado
  const firstThis = `${today.slice(0, 8)}01`;
  const lastPrev = addDays(firstThis, -1);
  return { since: `${lastPrev.slice(0, 8)}01`, until: lastPrev };
}
