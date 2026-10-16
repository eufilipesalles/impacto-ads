import type { Objective } from "./types";
import { brDate, type Totals } from "./period";

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const int = new Intl.NumberFormat("pt-BR");
const dec2 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const div = (a: number, b: number) => (b > 0 ? a / b : null);

export interface MetricDef {
  id: string;
  label: string;
  emoji: string;
  value: (t: Totals) => number | null;
  fmt: (v: number) => string;
}

export const METRICS: MetricDef[] = [
  { id: "spend", label: "Investimento", emoji: "💰", value: (t) => t.spend, fmt: (v) => brl.format(v) },
  { id: "conversations", label: "Conversas iniciadas", emoji: "💬", value: (t) => t.conversations, fmt: (v) => int.format(v) },
  { id: "cost_per_conversation", label: "Custo por conversa", emoji: "🏷️", value: (t) => div(t.spend, t.conversations), fmt: (v) => brl.format(v) },
  { id: "reach", label: "Alcance", emoji: "👥", value: (t) => t.reach, fmt: (v) => `${int.format(v)} pessoas` },
  { id: "impressions", label: "Impressões", emoji: "👀", value: (t) => t.impressions, fmt: (v) => int.format(v) },
  { id: "frequency", label: "Frequência", emoji: "🔁", value: (t) => t.frequency || null, fmt: (v) => dec2.format(v) },
  { id: "link_clicks", label: "Cliques no link", emoji: "🖱️", value: (t) => t.link_clicks, fmt: (v) => int.format(v) },
  { id: "ctr", label: "Taxa de cliques (CTR)", emoji: "📈", value: (t) => { const r = div(t.link_clicks, t.impressions); return r === null ? null : r * 100; }, fmt: (v) => `${dec2.format(v)}%` },
  { id: "cpc", label: "Custo por clique", emoji: "💵", value: (t) => div(t.spend, t.link_clicks), fmt: (v) => brl.format(v) },
  { id: "cpm", label: "Custo por mil impressões (CPM)", emoji: "📊", value: (t) => { const r = div(t.spend, t.impressions); return r === null ? null : r * 1000; }, fmt: (v) => brl.format(v) },
  { id: "leads", label: "Leads (cadastros)", emoji: "📝", value: (t) => t.leads, fmt: (v) => int.format(v) },
  { id: "cpl", label: "Custo por lead", emoji: "🏷️", value: (t) => div(t.spend, t.leads), fmt: (v) => brl.format(v) },
  { id: "landing_page_views", label: "Visualizações da página", emoji: "🌐", value: (t) => t.landing_page_views, fmt: (v) => int.format(v) },
  { id: "video_views", label: "Visualizações de vídeo", emoji: "▶️", value: (t) => t.video_views, fmt: (v) => int.format(v) },
  { id: "engagement", label: "Engajamento com as publicações", emoji: "❤️", value: (t) => t.engagement, fmt: (v) => int.format(v) },
];

// Seleção inicial conforme o objetivo do cliente (sempre editável)
export const DEFAULTS: Record<Objective, string[]> = {
  conversas_whatsapp: ["spend", "conversations", "cost_per_conversation", "reach"],
  reconhecimento: ["spend", "reach", "impressions", "frequency"],
  trafego: ["spend", "link_clicks", "ctr", "cpc", "reach"],
  leads: ["spend", "leads", "cpl", "reach"],
  vendas: ["spend", "link_clicks", "landing_page_views", "reach"],
  misto: ["spend", "conversations", "cost_per_conversation", "reach", "impressions"],
  a_definir: ["spend", "conversations", "cost_per_conversation", "reach"],
};

export interface ReportOptions {
  clientName: string;
  title: string;
  campaignNames?: string[];
  since: string;
  until: string;
  metrics: string[];
  totals: Totals;
  previous: Totals | null;
  emojis: boolean;
  note: string;
}

function delta(now: number | null, prev: number | null) {
  if (now === null || prev === null) return "";
  if (prev === 0) return now === 0 ? "" : " (antes: 0)";
  const p = ((now - prev) / prev) * 100;
  if (Math.abs(p) < 0.5) return " (estável)";
  return ` (${p > 0 ? "↑" : "↓"} ${Math.round(Math.abs(p))}%)`;
}

// Mensagem no formato do WhatsApp (*negrito*)
export function buildMessage(o: ReportOptions): string {
  const lines: string[] = [];
  lines.push(`*${o.title} | ${o.clientName}*`);
  lines.push(`${o.emojis ? "📅 " : ""}${brDate(o.since)} a ${brDate(o.until, true)}`);
  if (o.campaignNames?.length) {
    const label = o.campaignNames.length === 1 ? "Campanha" : "Campanhas";
    lines.push(`${o.emojis ? "📣 " : ""}${label}: ${o.campaignNames.join(", ")}`);
  }
  lines.push("");
  for (const id of o.metrics) {
    const m = METRICS.find((x) => x.id === id);
    if (!m) continue;
    const v = m.value(o.totals);
    const shown = v === null ? "—" : m.fmt(v);
    const cmp = o.previous ? delta(v, m.value(o.previous)) : "";
    lines.push(`${o.emojis ? `${m.emoji} ` : "• "}${m.label}: *${shown}*${cmp}`);
  }
  if (o.previous) {
    lines.push("");
    lines.push("_Comparação com o período anterior de mesma duração._");
  }
  if (o.note.trim()) {
    lines.push("");
    lines.push(o.note.trim());
  }
  return lines.join("\n");
}
