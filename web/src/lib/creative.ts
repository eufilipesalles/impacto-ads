// Nota do criativo (0–100) e diagnóstico para o time de copy.
//
// Como a nota funciona
// - Cada indicador é comparado com uma referência (benchmark):
//     resultado (custo por conversa/lead/venda, ROAS) → média do próprio cliente no período;
//     gancho, retenção, CTR, engajamento → mediana dos criativos do cliente (ou da carteira, se o cliente tiver poucos).
// - A comparação vira nota por uma curva suave: igual à referência = 50; 2x melhor ≈ 85; 2x pior ≈ 15.
// - Pouco dado puxa o valor para a referência (suavização): um criativo com 1 conversa barata
//   não vira campeão por sorte. Quanto mais volume, mais a nota reflete o desempenho real.
// - Nota final = média ponderada dos indicadores disponíveis (imagem não tem gancho/retenção de vídeo).
import type { CreativeStat, Objective } from "./types";

export type ResultKind = "purchase" | "conversation" | "lead" | "click" | "impression";
export type Verdict = "campeao" | "bom" | "mediano" | "fraco" | "teste";
export type PartId = "result" | "hook" | "hold" | "ctr" | "engagement" | "quality";

export const MIN_IMPRESSIONS = 1000;     // abaixo disso: "em teste", sem veredito
const PRIOR_RESULTS = 2;                 // resultados "fantasmas" na média do cliente (suavização)
const PRIOR_IMPRESSIONS = 2000;          // impressões "fantasmas" na referência (suavização)
// Resultado decide; atenção (gancho, retenção, CTR) explica o porquê
const WEIGHTS: Record<PartId, number> = { result: 55, hook: 10, hold: 10, ctr: 10, engagement: 5, quality: 10 };

export const RESULT_LABEL: Record<ResultKind, { name: string; cost: string; short: string; the: string }> = {
  purchase: { name: "Vendas", cost: "Custo por venda", short: "venda", the: "a venda sai cara" },
  conversation: { name: "Conversas", cost: "Custo por conversa", short: "conversa", the: "a conversa sai cara" },
  lead: { name: "Leads", cost: "Custo por lead", short: "lead", the: "o lead sai caro" },
  click: { name: "Cliques no link", cost: "Custo por clique", short: "clique", the: "o clique sai caro" },
  impression: { name: "Impressões", cost: "CPM", short: "mil impressões", the: "a entrega sai cara" },
};

export const PART_LABEL: Record<PartId, { name: string; help: string }> = {
  result: { name: "Resultado", help: "custo por resultado (ou ROAS) comparado com a média do cliente" },
  hook: { name: "Gancho", help: "quem parou para ver 3 segundos ÷ impressões" },
  hold: { name: "Retenção", help: "ThruPlays (15 s ou até o fim) ÷ impressões" },
  ctr: { name: "CTR", help: "cliques no link ÷ impressões" },
  engagement: { name: "Engajamento", help: "reações, comentários, compartilhamentos e salvamentos por mil impressões" },
  quality: { name: "Qualidade Meta", help: "rankings de qualidade, engajamento e conversão do Meta (últimos 7 dias)" },
};

export const VERDICT_LABEL: Record<Verdict, string> = {
  campeao: "Modelar", bom: "Bom", mediano: "Mediano", fraco: "Fraco", teste: "Em teste",
};

export const FORMAT_LABEL: Record<string, string> = {
  video: "Vídeo", imagem: "Imagem", carrossel: "Carrossel", dinamico: "Dinâmico",
};

export const CTA_LABEL: Record<string, string> = {
  WHATSAPP_MESSAGE: "Enviar mensagem (WhatsApp)", MESSAGE_PAGE: "Enviar mensagem", LEARN_MORE: "Saiba mais",
  SHOP_NOW: "Comprar agora", ORDER_NOW: "Pedir agora", SIGN_UP: "Cadastre-se", CONTACT_US: "Fale conosco",
  SEE_DETAILS: "Ver detalhes", GET_QUOTE: "Pedir orçamento", BOOK_TRAVEL: "Reservar", CALL_NOW: "Ligar agora",
  SEND_MESSAGE: "Enviar mensagem", INSTAGRAM_MESSAGE: "Enviar mensagem (Direct)", APPLY_NOW: "Inscreva-se",
  DOWNLOAD: "Baixar", GET_OFFER: "Ver oferta", SUBSCRIBE: "Assinar", BUY_NOW: "Comprar", NO_BUTTON: "Sem botão",
};

export const RANKING_LABEL: Record<string, { text: string; tone: "good" | "mid" | "bad" }> = {
  above_average: { text: "Acima da média", tone: "good" },
  average: { text: "Na média", tone: "mid" },
  below_average_35: { text: "Abaixo (35% piores)", tone: "bad" },
  below_average_20: { text: "Abaixo (20% piores)", tone: "bad" },
  below_average_10: { text: "Abaixo (10% piores)", tone: "bad" },
};
const RANKING_SCORE: Record<string, number> = {
  above_average: 85, average: 55, below_average_35: 30, below_average_20: 18, below_average_10: 8,
};

export interface Part { id: PartId; score: number; value: number | null; bench: number | null; weight: number }

export interface ScoredCreative extends CreativeStat {
  kind: ResultKind;
  results: number;
  costPerResult: number | null;
  roas: number | null;
  ctr: number | null;            // %
  hookRate: number | null;       // %
  holdRate: number | null;       // %
  engagementRate: number | null; // por mil impressões
  cpm: number | null;
  isVideo: boolean;
  curve: { label: string; pct: number }[] | null; // % das reproduções que chegaram a cada ponto
  ctrChange: number | null;      // variação % do CTR: últimos 7 dias × 7 anteriores
  fatigue: boolean;
  parts: Part[];
  score: number;
  verdict: Verdict;
  diagnosis: string[];
  benchScope: "cliente" | "carteira";
}

const div = (a: number, b: number) => (b > 0 ? a / b : null);
const clamp = (v: number) => Math.max(0, Math.min(100, v));
// razão (já orientada: >1 = melhor) → nota 0–100; 1 → 50, 2 → ~85, 0,5 → ~15
const curveScore = (ratio: number) => clamp(50 + 50 * Math.tanh(1.25 * Math.log(Math.max(ratio, 1e-6))));

function median(values: number[]) {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

// Objetivo da campanha no Meta → o que conta como resultado daquele criativo
const CAMPAIGN_KIND: Record<string, ResultKind> = {
  OUTCOME_SALES: "purchase", CONVERSIONS: "purchase", PRODUCT_CATALOG_SALES: "purchase",
  OUTCOME_LEADS: "lead", LEAD_GENERATION: "lead",
  OUTCOME_ENGAGEMENT: "conversation", MESSAGES: "conversation",
  OUTCOME_TRAFFIC: "click", LINK_CLICKS: "click",
  OUTCOME_AWARENESS: "impression", REACH: "impression", BRAND_AWARENESS: "impression",
};

const EXPLICIT: Record<string, ResultKind> = {
  vendas: "purchase", conversas_whatsapp: "conversation", leads: "lead", trafego: "click", reconhecimento: "impression",
};

// Qual resultado julga cada criativo:
// - campanhas de tráfego e de reconhecimento: custo por clique e CPM, sempre;
// - cliente com objetivo definido em Configurações: o objetivo do cliente
//   (muitas campanhas de WhatsApp são criadas no Meta com objetivo "Leads");
// - cliente misto / a definir: o resultado que as campanhas daquele objetivo mais geram.
function kindResolver(list: CreativeStat[], objective: string) {
  const dominant = new Map<string, ResultKind>();
  for (const obj of new Set(list.map((c) => c.campaign_objective ?? ""))) {
    const g = list.filter((c) => (c.campaign_objective ?? "") === obj);
    const tot = (k: keyof CreativeStat) => g.reduce((t, c) => t + Number(c[k] ?? 0), 0);
    const opts: [ResultKind, number][] = [["conversation", tot("conversations")], ["lead", tot("leads")],
      ["purchase", tot("purchase_value") > 0 ? tot("purchases") : 0]];
    const best = opts.sort((x, y) => y[1] - x[1])[0];
    dominant.set(obj, best[1] > 0 ? best[0] : CAMPAIGN_KIND[obj] ?? "click");
  }
  return (c: CreativeStat): ResultKind => {
    const camp = c.campaign_objective ? CAMPAIGN_KIND[c.campaign_objective] : undefined;
    if (camp === "click" || camp === "impression") return camp;
    return EXPLICIT[objective] ?? dominant.get(c.campaign_objective ?? "") ?? "click";
  };
}

export const KIND_GOAL: Record<ResultKind, string> = {
  purchase: "vendas", conversation: "conversas", lead: "leads", click: "tráfego", impression: "reconhecimento",
};

function resultsOf(c: CreativeStat, kind: ResultKind) {
  switch (kind) {
    case "purchase": return c.purchases;
    case "conversation": return c.conversations;
    case "lead": return c.leads;
    case "click": return c.link_clicks;
    case "impression": return c.impressions / 1000;
  }
}

const rates = (c: CreativeStat) => {
  // Imagem e carrossel às vezes registram reproduções soltas; só conta como vídeo quando é de fato vídeo
  const isVideo = c.format === "video" || (c.format !== "imagem" && c.format !== "carrossel" && c.video_plays >= c.impressions * 0.2);
  const eng = c.reactions + c.comments + c.shares + c.saves;
  return {
    isVideo,
    ctr: div(c.link_clicks, c.impressions),
    hook: isVideo ? div(c.video_3s, c.impressions) : null,
    hold: isVideo ? div(c.thruplays, c.impressions) : null,
    engagement: div(eng, c.impressions),
  };
};

type Bench = { ctr: number | null; hook: number | null; hold: number | null; engagement: number | null };

function benchFrom(list: CreativeStat[]): Bench {
  const q = list.filter((c) => c.impressions >= MIN_IMPRESSIONS).map(rates);
  return {
    ctr: median(q.map((r) => r.ctr ?? NaN)),
    hook: median(q.filter((r) => r.isVideo).map((r) => r.hook ?? NaN)),
    hold: median(q.filter((r) => r.isVideo).map((r) => r.hold ?? NaN)),
    engagement: median(q.map((r) => r.engagement ?? NaN)),
  };
}

// taxa suavizada: soma "impressões fantasmas" na referência antes de comparar
function rateScore(hits: number, impressions: number, bench: number | null) {
  if (bench === null || bench <= 0) return null;
  const smoothed = (hits + PRIOR_IMPRESSIONS * bench) / (impressions + PRIOR_IMPRESSIONS);
  return curveScore(smoothed / bench);
}

function qualityScore(c: CreativeStat) {
  const vals = [c.quality_ranking, c.engagement_ranking, c.conversion_ranking]
    .map((r) => (r ? RANKING_SCORE[r] : undefined)).filter((v): v is number => v !== undefined);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

export function scoreCreatives(all: CreativeStat[], objectives: Record<string, Objective | string> = {}): ScoredCreative[] {
  const portfolio = benchFrom(all);
  const byClient = new Map<string, CreativeStat[]>();
  for (const c of all) byClient.set(c.client_id, [...(byClient.get(c.client_id) ?? []), c]);

  const out: ScoredCreative[] = [];
  for (const [clientId, list] of byClient) {
    const objective = objectives[clientId] ?? list[0].client_objective;
    const resolve = kindResolver(list, objective);
    const kindOf = new Map(list.map((c) => [c.ad_id, resolve(c)]));

    // Referência de resultado: média do cliente entre os criativos com o mesmo objetivo
    const resBench = new Map<ResultKind, { cost: number | null; roas: number | null; useRoas: boolean }>();
    for (const k of new Set(kindOf.values())) {
      const g = list.filter((c) => kindOf.get(c.ad_id) === k);
      const spend = g.reduce((t, c) => t + c.spend, 0), value = g.reduce((t, c) => t + c.purchase_value, 0);
      resBench.set(k, { cost: div(spend, g.reduce((t, c) => t + resultsOf(c, k), 0)), roas: div(value, spend), useRoas: k === "purchase" && value > 0 });
    }

    // Referência das taxas: o próprio cliente quando tem 3+ criativos com volume; senão a carteira
    const qualified = list.filter((c) => c.impressions >= MIN_IMPRESSIONS);
    const own = benchFrom(list);
    const scope: "cliente" | "carteira" = qualified.length >= 3 ? "cliente" : "carteira";
    const bench: Bench = scope === "cliente"
      ? { ctr: own.ctr ?? portfolio.ctr, hook: own.hook ?? portfolio.hook, hold: own.hold ?? portfolio.hold, engagement: own.engagement ?? portfolio.engagement }
      : portfolio;

    for (const c of list) {
      const r = rates(c);
      const kind = kindOf.get(c.ad_id)!;
      const { cost: benchCost, roas: benchRoas, useRoas } = resBench.get(kind)!;
      const results = resultsOf(c, kind);
      const parts: Part[] = [];

      // Resultado: custo por resultado (ou ROAS) com resultados "fantasmas" na média do cliente
      if (useRoas && benchRoas && benchCost) {
        const priorSpend = PRIOR_RESULTS * benchCost;
        const smoothed = (c.purchase_value + priorSpend * benchRoas) / (c.spend + priorSpend);
        parts.push({ id: "result", score: curveScore(smoothed / benchRoas), value: div(c.purchase_value, c.spend), bench: benchRoas, weight: WEIGHTS.result });
      } else if (benchCost) {
        const smoothed = (c.spend + PRIOR_RESULTS * benchCost) / (results + PRIOR_RESULTS);
        parts.push({ id: "result", score: curveScore(benchCost / smoothed), value: div(c.spend, results), bench: benchCost, weight: WEIGHTS.result });
      }

      const add = (id: PartId, score: number | null, value: number | null, b: number | null) => {
        if (score !== null) parts.push({ id, score, value, bench: b, weight: WEIGHTS[id] });
      };
      if (r.isVideo) {
        add("hook", rateScore(c.video_3s, c.impressions, bench.hook), r.hook, bench.hook);
        add("hold", rateScore(c.thruplays, c.impressions, bench.hold), r.hold, bench.hold);
      }
      // CTR só pesa quando o resultado depende do clique (em reconhecimento, não)
      if (kind !== "impression") add("ctr", rateScore(c.link_clicks, c.impressions, bench.ctr), r.ctr, bench.ctr);
      add("engagement", rateScore(c.reactions + c.comments + c.shares + c.saves, c.impressions, bench.engagement), r.engagement, bench.engagement);
      add("quality", qualityScore(c), null, null);

      const w = parts.reduce((t, p) => t + p.weight, 0);
      const score = w ? Math.round(parts.reduce((t, p) => t + p.score * p.weight, 0) / w) : 50;

      // Saturação: CTR caiu 25%+ na última semana (com volume nas duas) ou frequência alta
      const ctrNow = div(c.clicks_recent, c.imp_recent), ctrPrev = div(c.clicks_before, c.imp_before);
      const enough = c.imp_recent >= MIN_IMPRESSIONS && c.imp_before >= MIN_IMPRESSIONS && c.clicks_before >= 5;
      const ctrChange = enough && ctrNow !== null && ctrPrev ? ((ctrNow - ctrPrev) / ctrPrev) * 100 : null;
      const fatigue = (ctrChange !== null && ctrChange <= -25) || (c.freq_7d ?? 0) >= 3.5;

      // Resultado forte e com volume manda: vira referência mesmo com atenção fraca, e nunca é "fraco"
      const res = parts.find((p) => p.id === "result")?.score ?? null;
      const verdict: Verdict = c.impressions < MIN_IMPRESSIONS ? "teste"
        : score >= 65 || (res !== null && res >= 70 && score >= 55) ? "campeao"
        : score >= 55 || (res !== null && res >= 65) ? "bom"
        : score >= 42 || (res !== null && res >= 55) ? "mediano" : "fraco";

      const base = r.isVideo && c.video_plays > 0 ? c.video_plays : 0;
      const curve = base ? [
        { label: "25%", pct: (c.video_p25 / base) * 100 },
        { label: "50%", pct: (c.video_p50 / base) * 100 },
        { label: "75%", pct: (c.video_p75 / base) * 100 },
        { label: "95%", pct: (c.video_p95 / base) * 100 },
        { label: "100%", pct: (c.video_p100 / base) * 100 },
      ] : null;

      const scored: ScoredCreative = {
        ...c, kind, results,
        costPerResult: kind === "impression" ? div(c.spend, c.impressions / 1000) : div(c.spend, results),
        roas: div(c.purchase_value, c.spend),
        ctr: r.ctr === null ? null : r.ctr * 100,
        hookRate: r.hook === null ? null : r.hook * 100,
        holdRate: r.hold === null ? null : r.hold * 100,
        engagementRate: r.engagement === null ? null : r.engagement * 1000,
        cpm: div(c.spend * 1000, c.impressions),
        isVideo: r.isVideo, curve, ctrChange, fatigue, parts, score, verdict, diagnosis: [], benchScope: scope,
      };
      scored.diagnosis = diagnose(scored);
      out.push(scored);
    }
  }
  return out;
}

const part = (c: ScoredCreative, id: PartId) => c.parts.find((p) => p.id === id)?.score ?? null;
const good = (s: number | null) => s !== null && s >= 60;
const weak = (s: number | null) => s !== null && s < 40;

// Leitura em linguagem de copy: o que manter, o que testar
export function diagnose(c: ScoredCreative): string[] {
  const out: string[] = [];
  const res = part(c, "result"), hook = part(c, "hook"), hold = part(c, "hold"), ctr = part(c, "ctr");
  const L = RESULT_LABEL[c.kind];

  if (c.verdict === "teste") {
    out.push(`Ainda com pouco volume (${c.impressions.toLocaleString("pt-BR")} impressões). Espere passar de ${MIN_IMPRESSIONS.toLocaleString("pt-BR")} para tirar conclusões.`);
    return out;
  }
  // [com artigo, com "em" contraído]
  const names: Partial<Record<PartId, [string, string]>> = {
    result: c.kind === "purchase" && c.purchase_value > 0 ? ["o retorno (ROAS)", "no retorno (ROAS)"] : [`o custo por ${L.short}`, `no custo por ${L.short}`],
    hook: ["o gancho", "no gancho"], hold: ["a retenção", "na retenção"], ctr: ["a chamada para o clique", "na chamada para o clique"],
    engagement: ["o engajamento", "no engajamento"],
  };
  const pick = (min: number, max: number, i: 0 | 1) => c.parts.filter((p) => p.score >= min && p.score < max && names[p.id]).map((p) => names[p.id]![i]);
  const strong = pick(60, 101, 0), strongIn = pick(60, 101, 1), weakIn = pick(-1, 40, 1);

  if (c.verdict === "campeao") {
    out.push(`Referência para modelar${strong.length ? `: o forte é ${joinPt(strong)}` : ""}. Reaproveite a estrutura (abertura, promessa e chamada) em novas variações para o mesmo público.`);
  }
  if (c.isVideo && weak(hook) && good(hold)) out.push("Os 3 primeiros segundos não seguram, mas quem passa da abertura assiste. Teste outras aberturas (frase de impacto, pergunta, resultado logo no início) mantendo o resto do vídeo.");
  else if (c.isVideo && weak(hook)) out.push(`Poucas pessoas param para assistir.${good(res) ? " O que vende é a oferta: com uma abertura mais forte, o mesmo criativo pode render ainda mais." : " A abertura precisa de mais impacto visual ou de uma frase que gere identificação imediata."}`);
  if (c.isVideo && good(hook) && weak(hold)) out.push("Prende no início, mas as pessoas saem antes do fim. Encurte, corte a enrolação e traga a promessa principal mais cedo.");
  if (c.isVideo && good(hook) && good(hold) && weak(ctr)) out.push("Assistem até o fim, mas pouca gente clica. Reforce a chamada para ação e deixe a oferta mais clara no final e no texto.");
  if (good(ctr) && weak(res)) out.push(`Gera clique, mas ${L.the}. A promessa do anúncio pode estar desalinhada com o atendimento ou a página; revise a oferta e o que a pessoa encontra depois do clique.`);
  else if (weak(res) && (good(hook) || good(hold))) out.push(`Chama atenção, mas não se converte em ${L.name.toLowerCase()}. O conteúdo agrada; falta uma oferta e uma chamada que levem à ação.`);
  if (c.verdict === "fraco" && !good(hook) && !good(ctr)) out.push("Abaixo da média do cliente na maioria dos indicadores. Candidato a pausar e liberar verba para os criativos que estão performando.");
  if (c.fatigue) {
    out.push(c.ctrChange !== null && c.ctrChange <= -25
      ? `Sinal de saturação: o CTR caiu ${Math.round(Math.abs(c.ctrChange))}% na última semana. Hora de lançar variações deste criativo.`
      : `Frequência alta (${(c.freq_7d ?? 0).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} na semana): o público já viu muitas vezes. Prepare variações.`);
  }
  const below = [c.quality_ranking?.startsWith("below") && "qualidade", c.engagement_ranking?.startsWith("below") && "engajamento",
    c.conversion_ranking?.startsWith("below") && "conversão"].filter(Boolean) as string[];
  if (below.length) out.push(`O Meta classifica ${joinPt(below)} abaixo da média dos anúncios que disputam o mesmo público.`);
  if (!out.length) {
    out.push(strongIn.length || weakIn.length
      ? `${strongIn.length ? `Acima da média ${joinPt(strongIn)}.` : ""}${weakIn.length ? ` Abaixo ${joinPt(weakIn)}.` : ""} Mantenha rodando e use como comparação nos próximos testes.`.trim()
      : "Desempenho na média do cliente. Mantenha rodando e use como comparação nos próximos testes.");
  }
  return out;
}

function joinPt(list: string[]) {
  return list.length <= 1 ? list.join("") : `${list.slice(0, -1).join(", ")} e ${list[list.length - 1]}`;
}

// Texto pronto para mandar ao time de copy (WhatsApp/Slack)
export function briefing(c: ScoredCreative, fmt: { money: (v: number | null) => string; pct: (v: number | null) => string }): string {
  const L = RESULT_LABEL[c.kind];
  const lines = [
    `*Criativo para modelar — ${c.client_name}*`,
    `${c.name ?? "Anúncio"} · ${FORMAT_LABEL[c.format ?? ""] ?? "Formato não identificado"} · nota ${c.score}/100 (${VERDICT_LABEL[c.verdict]})`,
    "",
    `• ${L.cost}: ${fmt.money(c.costPerResult)}${c.kind === "purchase" && c.roas ? ` · ROAS ${c.roas.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}x` : ""}`,
  ];
  if (c.hookRate !== null) lines.push(`• Gancho (pararam 3 s): ${fmt.pct(c.hookRate)}`);
  if (c.holdRate !== null) lines.push(`• Retenção (ThruPlay): ${fmt.pct(c.holdRate)}`);
  if (c.ctr !== null) lines.push(`• CTR: ${fmt.pct(c.ctr)}`);
  lines.push("", "*Leitura*", ...c.diagnosis.map((d) => `- ${d}`));
  if (c.title || c.body) {
    lines.push("", "*Copy do anúncio*");
    if (c.title) lines.push(`Título: ${c.title}`);
    if (c.body) lines.push(c.body);
  }
  if (c.cta_type) lines.push(`Botão: ${CTA_LABEL[c.cta_type] ?? c.cta_type}`);
  if (c.preview_url || c.post_url) lines.push("", `Ver anúncio: ${c.post_url ?? c.preview_url}`);
  return lines.join("\n");
}
