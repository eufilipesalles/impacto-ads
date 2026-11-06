// Estratégia: raio-x, funil, IA, perfil de campanha e lançamento
import { DEMO, FUNCTIONS_URL, supabase } from "./supabase";

export type Kind = "purchase" | "conversation" | "lead" | "click";

export interface Step { id: string; label: string; from: string; to: string; rate: number | null; bench: number | null; volume: number; index: number | null }
export interface Issue { id: string; text: string; fixes: string[] }
export interface Funnel {
  campaign_id: string; name: string; objective: string; kind: Kind; status: string | null;
  spend: number; result: number; cpr: number | null; bench_cpr: number | null; value: number; roas: number | null;
  cpm: number | null; bench_cpm: number | null; frequency: number | null; prev_cpr: number | null; prev_spend: number;
  steps: Step[]; bottleneck: string | null; issues: Issue[];
}
export interface Cut { key: string; label: string; spend: number; impressions: number; clicks: number; result: number; cpr: number | null; share: number; index: number | null; extra?: unknown }
export interface Region { key: string; name: string; region?: string; radius_km: number }
export interface ClientStrategy {
  client_id: string; regions: Region[]; age_min: number | null; age_max: number | null; genders: number[] | null;
  daily_budget: number | null; placements_mode: "winners" | "advantage" | "source"; source_campaign_id: string | null; notes: string | null;
}
export interface Analysis {
  client: { id: string; name: string; objective: string; kind: Kind | null };
  since: string; until: string; days: number; strategy: ClientStrategy | null;
  summary: { spend: number; result: number; cpr: number | null; value: number; roas: number | null; impressions: number; clicks: number;
    prev_spend: number; prev_result: number; prev_cpr: number | null; bench_cpr: number | null };
  funnels: Funnel[];
  cuts: Record<"placement" | "age_gender" | "hour" | "adset" | "region", Cut[]>;
  insights: { area: string; text: string; action: string }[];
}
export interface AiAnalysis {
  resumo: string; nota_saude: number;
  gargalos: { titulo: string; evidencia: string; causa_provavel: string; acao: string; impacto: "alto" | "medio" | "baixo" }[];
  oportunidades: { titulo: string; evidencia: string; acao: string }[];
  plano_7_dias: string[];
  testes: { hipotese: string; como_testar: string; metrica: string }[];
  estrutura_recomendada: { campanhas: string; posicionamentos: string; segmentacao: string; orcamento: string; criativos: string };
}
export interface AiReport { id: string; created_at: string; analysis: AiAnalysis; model: string | null; since: string; until: string }

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data: s } = await supabase.auth.getSession();
  const res = await fetch(`${FUNCTIONS_URL}/strategy`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${s.session?.access_token ?? ""}` },
    body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error ?? `Falha (${res.status})`);
  return j as T;
}

export async function getAnalysis(clientId: string, days: number): Promise<Analysis> {
  if (DEMO) return demoAnalysis(days);
  return call<Analysis>({ action: "analyze", client_id: clientId, days });
}
export async function refreshXray(clientId: string) {
  if (DEMO) return;
  await call({ action: "collect", client_id: clientId });
}
export async function aiEnabled(): Promise<boolean> {
  if (DEMO) return true;
  return (await call<{ enabled: boolean }>({ action: "ai_status" })).enabled;
}
export async function runAi(clientId: string, days: number): Promise<AiReport> {
  if (DEMO) return { ...demoAi, created_at: new Date().toISOString() };
  const r = await call<{ id: string; created_at: string; analysis: AiAnalysis; model: string }>({ action: "ai", client_id: clientId, days });
  return { ...r, since: "", until: "" };
}
export async function lastAi(clientId: string): Promise<AiReport | null> {
  if (DEMO) return demoAi;
  const { data } = await supabase.from("strategy_reports").select("id, created_at, analysis, model, since, until")
    .eq("client_id", clientId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  return (data as AiReport | null) ?? null;
}
export async function searchCities(q: string): Promise<{ key: string; name: string; region: string; country: string }[]> {
  if (DEMO) return [{ key: "251658", name: "Uruguaiana", region: "Rio Grande do Sul", country: "BR" }, { key: "246880", name: "Alegrete", region: "Rio Grande do Sul", country: "BR" }]
    .filter((c) => c.name.toLowerCase().includes(q.toLowerCase()));
  return (await call<{ data: { key: string; name: string; region: string; country: string }[] }>({ action: "geo_search", q })).data;
}
export async function getStrategy(clientId: string): Promise<ClientStrategy | null> {
  if (DEMO) return demoStrategy;
  const { data } = await supabase.from("client_strategy").select("*").eq("client_id", clientId).maybeSingle();
  if (!data) return null;
  return { ...data, daily_budget: data.daily_budget === null ? null : Number(data.daily_budget) } as ClientStrategy;
}
export async function saveStrategy(s: ClientStrategy) {
  if (DEMO) { Object.assign(demoStrategy, s); return; }
  const { data: u } = await supabase.auth.getUser();
  const { error } = await supabase.from("client_strategy").upsert({ ...s, updated_at: new Date().toISOString(), updated_by: u.user?.email ?? null });
  if (error) throw new Error(error.message);
}
export async function getClientCampaignsList(clientId: string): Promise<{ id: string; name: string; effective_status: string | null }[]> {
  if (DEMO) return [{ id: "1", name: "[CONV] Coluna — WhatsApp", effective_status: "ACTIVE" }];
  const { data } = await supabase.from("campaigns").select("id, name, effective_status, ad_accounts!inner(client_id)").eq("ad_accounts.client_id", clientId).order("name");
  return (data ?? []) as unknown as { id: string; name: string; effective_status: string | null }[];
}
export async function planLaunch(input: { client_id: string; asset_ids: string[]; daily_budget?: number | null; activate: boolean; name?: string }) {
  if (DEMO) return { action: { id: "demo" }, reason: "Modelo: \"[CONV] Coluna\" — melhor custo por conversa dos últimos 30 dias (R$ 3,67, 12 conversas). Regiões: Uruguaiana +15 km. Posicionamentos: Facebook Reels, Instagram Stories e feeds. Verba: R$ 40,00/dia." };
  return call<{ action: { id: string }; reason: string; plan: Record<string, unknown> }>({ action: "plan_launch", ...input });
}
export async function images64(urls: string[]): Promise<Record<string, string>> {
  if (DEMO || !urls.length) return {};
  const r = await call<{ images: { url: string; data: string | null }[] }>({ action: "images64", urls });
  return Object.fromEntries(r.images.filter((i) => i.data).map((i) => [i.url, i.data!]));
}

// ---------- demonstração ----------
const demoStrategy: ClientStrategy = {
  client_id: "c2", regions: [{ key: "251658", name: "Uruguaiana", region: "Rio Grande do Sul", radius_km: 15 }],
  age_min: 30, age_max: 65, genders: null, daily_budget: 40, placements_mode: "winners", source_campaign_id: null, notes: null,
};
function demoAnalysis(days: number): Analysis {
  const st = (id: string, label: string, rate: number, bench: number, volume: number): Step => ({ id, label, from: "", to: "", rate, bench, volume, index: rate / bench });
  return {
    client: { id: "c2", name: "Clínica Flamboyant", objective: "conversas_whatsapp", kind: "conversation" },
    since: "2026-10-22", until: "2026-11-04", days, strategy: demoStrategy,
    summary: { spend: 253.04, result: 26, cpr: 9.73, value: 0, roas: null, impressions: 33122, clicks: 100, prev_spend: 490.23, prev_result: 68, prev_cpr: 7.21, bench_cpr: 9.3 },
    funnels: [
      { campaign_id: "1", name: "C. Flamboyant | Leads | Coluna", objective: "OUTCOME_LEADS", kind: "conversation", status: "ACTIVE", spend: 209.06, result: 14, cpr: 14.93, bench_cpr: 9.3,
        value: 0, roas: null, cpm: 7.4, bench_cpm: 6.9, frequency: 1.9, prev_cpr: 9.1, prev_spend: 300, bottleneck: "ctr",
        steps: [st("hook", "Atenção (pararam 3 s)", 0.1869, 0.1831, 28000), st("ctr", "Clique (CTR)", 0.0024, 0.0029, 28000), st("conv", "Clique → conversa", 0.2029, 0.2652, 69)],
        issues: [{ id: "ctr", text: "Gargalo em \"Clique (CTR)\": 0,24% contra 0,29% na média do cliente (16% abaixo).",
          fixes: ["Deixar a oferta explícita na peça (preço, condição, benefício) e reforçar a chamada para ação.", "Testar 2–3 novas variações de criativo com promessas diferentes."] }] },
      { campaign_id: "2", name: "C. Flamboyant | Ombro", objective: "OUTCOME_LEADS", kind: "conversation", status: "ACTIVE", spend: 43.98, result: 12, cpr: 3.67, bench_cpr: 9.3,
        value: 0, roas: null, cpm: 6.1, bench_cpm: 6.9, frequency: 1.3, prev_cpr: null, prev_spend: 0, bottleneck: null,
        steps: [st("hook", "Atenção (pararam 3 s)", 0.2772, 0.1831, 5000), st("ctr", "Clique (CTR)", 0.0064, 0.0029, 5000), st("conv", "Clique → conversa", 0.3871, 0.2652, 31)], issues: [] },
    ],
    cuts: {
      placement: [
        { key: "instagram|instagram_stories", label: "Instagram · Stories", spend: 98, impressions: 14000, clicks: 40, result: 17, cpr: 5.72, share: 0.39, index: 1.3 },
        { key: "facebook|facebook_reels", label: "Facebook · Reels", spend: 48, impressions: 9000, clicks: 20, result: 10, cpr: 4.85, share: 0.19, index: 1.4 },
        { key: "facebook|feed", label: "Facebook · Feed", spend: 60, impressions: 6000, clicks: 25, result: 6, cpr: 10, share: 0.24, index: 0.85 },
        { key: "instagram|feed", label: "Instagram · Feed", spend: 23.2, impressions: 2500, clicks: 9, result: 1.2, cpr: 19.33, share: 0.09, index: 0.5 },
      ],
      age_gender: [
        { key: "45-54|female", label: "45-54 · Mulheres", spend: 70, impressions: 8000, clicks: 25, result: 9, cpr: 7.78, share: 0.28, index: 1.1 },
        { key: "65+|male", label: "65+ · Homens", spend: 29, impressions: 3000, clicks: 9, result: 7, cpr: 4.14, share: 0.11, index: 1.5 },
        { key: "25-34|female", label: "25-34 · Mulheres", spend: 40, impressions: 6000, clicks: 10, result: 1, cpr: 40, share: 0.16, index: 0.45 },
      ],
      hour: Array.from({ length: 24 }, (_, h) => ({ key: String(h).padStart(2, "0"), label: `${String(h).padStart(2, "0")}h`, spend: 4 + 10 * Math.abs(Math.sin(h / 3)), impressions: 1000, clicks: 3, result: h > 7 ? Math.round(2 * Math.abs(Math.sin(h / 2))) : 0, cpr: null, share: 0.04, index: 1 })),
      adset: [
        { key: "s1", label: "Uruguaiana | C. Flamboyant — Uruguaiana", spend: 44, impressions: 5000, clicks: 31, result: 12, cpr: 3.66, share: 0.17, index: 1.6 },
        { key: "s2", label: "Coluna | Argentina — Corrientes, Misiones", spend: 209, impressions: 28000, clicks: 69, result: 14, cpr: 14.93, share: 0.83, index: 0.7 },
      ],
      region: [],
    },
    insights: [
      { area: "Posicionamentos", text: "Melhores posicionamentos: Facebook · Reels (R$ 4,85 por conversa), Instagram · Stories (R$ 5,72 por conversa). Média de todos: R$ 8,06.", action: "Priorizar esses posicionamentos nas próximas campanhas." },
      { area: "Posicionamentos", text: "Instagram · Feed consome 9% da verba com R$ 19,33 por conversa.", action: "Excluir ou reduzir Instagram · Feed nas novas campanhas." },
      { area: "Público", text: "Público que mais responde: 65+ · Homens (R$ 4,14).", action: "Usar esses perfis como referência de criativo e texto." },
    ],
  };
}
const demoAi: AiReport = {
  id: "demo", created_at: new Date().toISOString(), model: "demo", since: "", until: "",
  analysis: {
    resumo: "O custo por conversa subiu de R$ 7,21 para R$ 9,73 porque 83% da verba foi para a campanha Coluna (R$ 14,93 por conversa). A campanha Ombro entrega a R$ 3,67 com CTR 2,2x acima da média, mas recebe só R$ 44 no período.",
    nota_saude: 6,
    gargalos: [{ titulo: "Coluna com CTR baixo", evidencia: "CTR de 0,24% contra 0,29% de referência e custo de R$ 14,93", causa_provavel: "Criativo sem oferta clara para o público argentino", acao: "Trocar os 2 criativos de maior gasto por variações com oferta explícita", impacto: "alto" }],
    oportunidades: [{ titulo: "Escalar Ombro", evidencia: "R$ 3,67 por conversa, 61% abaixo da média", acao: "Subir o orçamento em 20% a cada 3 dias enquanto o custo ficar abaixo de R$ 6" }],
    plano_7_dias: ["Subir Ombro de R$ 20 para R$ 24/dia", "Pausar o Feed do Instagram na Coluna", "Subir 2 criativos novos na Coluna"],
    testes: [{ hipotese: "Oferta de avaliação gratuita aumenta CTR", como_testar: "2 criativos iguais, mudando só a oferta", metrica: "CTR e custo por conversa" }],
    estrutura_recomendada: { campanhas: "1 campanha por serviço", posicionamentos: "Reels e Stories + feeds", segmentacao: "Uruguaiana +15 km, 30–65", orcamento: "70% Ombro / 30% Coluna", criativos: "3 vídeos por conjunto" },
  },
};
