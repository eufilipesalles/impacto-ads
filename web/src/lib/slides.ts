// Relatório em slides (.pptx): abre no PowerPoint, Keynote e Google Slides
import PptxGenJS from "pptxgenjs";
import type { Analysis, AiReport, Kind } from "./strategy";
import type { DailyPoint } from "./types";
import type { ScoredCreative } from "./creative";

// mesmo padrão visual do relatório mensal: fundo escuro, cartões grafite, destaque laranja
const BLACK = "0B0B0C", ORANGE = "FF6B00", PAPER = "141312", INK = "F3EFE8", MUTED = "A8A29A", LINE = "34302C", OK = "4CC38A", BAD = "FF6E63", CARD = "201E1C";
const FONT = "Arial", HEAD = "Arial Black";

const brl = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
const int = (v: number | null | undefined) => (v === null || v === undefined ? "—" : Math.round(v).toLocaleString("pt-BR"));
const pct = (v: number | null | undefined, d = 1) => (v === null || v === undefined ? "—" : `${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: d, minimumFractionDigits: d })}%`);
const rate = (v: number | null) => (v === null ? "—" : v > 1 ? `${v.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} por etapa` : pct(v, 2));
const dmy = (iso: string) => iso.split("-").reverse().join("/");
const delta = (now: number | null, prev: number | null, lowerIsBetter = false) => {
  if (now === null || prev === null || !prev) return { text: "", color: MUTED };
  const p = (now - prev) / prev;
  const good = lowerIsBetter ? p < 0 : p > 0;
  return { text: `${p > 0 ? "▲" : "▼"} ${Math.abs(Math.round(p * 100))}% vs período anterior`, color: Math.abs(p) < 0.03 ? MUTED : good ? OK : BAD };
};
const RES: Record<Kind, { many: string; cost: string }> = {
  purchase: { many: "Vendas", cost: "Custo por venda" }, conversation: { many: "Conversas", cost: "Custo por conversa" },
  lead: { many: "Leads", cost: "Custo por lead" }, click: { many: "Cliques", cost: "Custo por clique" },
};

function header(s: PptxGenJS.Slide, title: string, subtitle?: string) {
  s.background = { color: PAPER };
  s.addText(title, { x: 0.6, y: 0.35, w: 12, h: 0.6, fontFace: HEAD, fontSize: 26, color: INK });
  if (subtitle) s.addText(subtitle, { x: 0.6, y: 0.92, w: 12, h: 0.4, fontFace: FONT, fontSize: 13, color: ORANGE });
}
function footer(s: PptxGenJS.Slide, client: string, n: number) {
  s.addText([{ text: "IMPACTO", options: { bold: true, color: ORANGE } }, { text: ` · ${client}`, options: { color: MUTED } }], { x: 0.6, y: 7.05, w: 8, h: 0.3, fontFace: FONT, fontSize: 9 });
  s.addText(String(n), { x: 12.2, y: 7.05, w: 0.6, h: 0.3, fontFace: FONT, fontSize: 9, color: MUTED, align: "right" });
}
function kpi(s: PptxGenJS.Slide, x: number, y: number, w: number, label: string, value: string, note?: { text: string; color: string }) {
  s.addShape("roundRect", { x, y, w, h: 1.55, rectRadius: 0.1, fill: { color: CARD }, line: { color: LINE, width: 1 } });
  s.addText(label, { x: x + 0.2, y: y + 0.15, w: w - 0.4, h: 0.3, fontFace: FONT, fontSize: 11, color: MUTED });
  s.addText(value, { x: x + 0.2, y: y + 0.45, w: w - 0.4, h: 0.6, fontFace: FONT, fontSize: 26, bold: true, color: INK });
  if (note?.text) s.addText(note.text, { x: x + 0.2, y: y + 1.08, w: w - 0.4, h: 0.3, fontFace: FONT, fontSize: 10, color: note.color });
}
const cell = (text: string, o: PptxGenJS.TableCellProps = {}): PptxGenJS.TableCell => ({ text, options: { fontFace: FONT, fontSize: 10.5, color: INK, ...o } });
const head = (labels: string[], aligns: ("left" | "right")[] = []) =>
  labels.map((l, i) => cell(l, { bold: true, color: "FFFFFF", fill: { color: BLACK }, align: aligns[i] ?? (i ? "right" : "left") }));

export async function buildSlides(o: {
  a: Analysis; ai: AiReport | null; daily: DailyPoint[]; creatives: ScoredCreative[]; images: Record<string, string>;
}): Promise<void> {
  const { a, ai, daily, creatives, images } = o;
  const kind: Kind = a.client.kind ?? "click";
  const R = RES[kind];
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "Impacto";
  pptx.title = `Relatório ${a.client.name}`;
  let n = 0;
  const period = `${dmy(a.since)} a ${dmy(a.until)}`;

  // 1) capa
  {
    const s = pptx.addSlide(); n++;
    s.background = { color: BLACK };
    s.addShape("rect", { x: 0.6, y: 2.2, w: 0.12, h: 2.2, fill: { color: ORANGE }, line: { color: ORANGE } });
    s.addText("RELATÓRIO DE PERFORMANCE", { x: 0.95, y: 2.15, w: 11, h: 0.4, fontFace: FONT, fontSize: 14, color: ORANGE, bold: true, charSpacing: 3 });
    s.addText(a.client.name, { x: 0.95, y: 2.6, w: 11.5, h: 1.1, fontFace: HEAD, fontSize: 48, color: INK });
    s.addText(`Meta Ads · ${period}`, { x: 0.95, y: 3.75, w: 11, h: 0.5, fontFace: FONT, fontSize: 18, color: MUTED });
    s.addText("Impacto", { x: 0.95, y: 6.6, w: 6, h: 0.4, fontFace: FONT, fontSize: 14, bold: true, color: "FFFFFF" });
  }

  // 2) resumo
  {
    const s = pptx.addSlide(); n++;
    header(s, "Resumo do período", period);
    const sm = a.summary;
    kpi(s, 0.6, 1.6, 2.9, "Investimento", brl(sm.spend), { ...delta(sm.spend, sm.prev_spend), color: MUTED });
    kpi(s, 3.7, 1.6, 2.9, R.many, int(sm.result), delta(sm.result, sm.prev_result));
    kpi(s, 6.8, 1.6, 2.9, R.cost, brl(sm.cpr), delta(sm.cpr, sm.prev_cpr, true));
    if (kind === "purchase") kpi(s, 9.9, 1.6, 2.85, "Faturamento · ROAS", `${brl(sm.value)}`, { text: `ROAS ${sm.roas ? sm.roas.toLocaleString("pt-BR", { maximumFractionDigits: 2 }) + "x" : "—"}`, color: INK });
    else kpi(s, 9.9, 1.6, 2.85, "Impressões", int(sm.impressions), { text: `${int(sm.clicks)} cliques no link`, color: MUTED });
    const text = ai?.analysis.resumo ?? [
      sm.cpr && sm.bench_cpr ? `${R.cost} de ${brl(sm.cpr)} no período, contra ${brl(sm.bench_cpr)} na média dos últimos 90 dias.` : "",
      ...a.insights.slice(0, 2).map((i) => i.text),
    ].filter(Boolean).join(" ");
    s.addShape("rect", { x: 0.6, y: 3.5, w: 12.15, h: 3.2, fill: { color: CARD }, line: { color: LINE, width: 1 } });
    s.addText("Leitura do período", { x: 0.85, y: 3.65, w: 11.6, h: 0.35, fontFace: FONT, fontSize: 13, bold: true, color: ORANGE });
    s.addText(text || "Sem leitura disponível.", { x: 0.85, y: 4.05, w: 11.6, h: 2.5, fontFace: FONT, fontSize: 15, color: INK, valign: "top", lineSpacingMultiple: 1.2 });
    footer(s, a.client.name, n);
  }

  // 3) evolução diária
  if (daily.length) {
    const s = pptx.addSlide(); n++;
    header(s, "Evolução diária", `Investimento e ${R.many.toLowerCase()} por dia`);
    const labels = daily.map((d) => dmy(d.date).slice(0, 5));
    const resOf = (d: DailyPoint) => kind === "purchase" ? d.purchases ?? 0 : kind === "lead" ? d.leads ?? 0 : kind === "click" ? d.link_clicks ?? 0 : d.conversations;
    // gráfico combinado (barras + linha): a assinatura da biblioteca para vários tipos é addChart(tipos, opções)
    (s.addChart as unknown as (t: unknown, o: unknown) => void)([
      { type: "bar", data: [{ name: "Investimento (R$)", labels, values: daily.map((d) => Math.round(d.spend * 100) / 100) }], options: { chartColors: ["4A4540"], barGapWidthPct: 40 } },
      { type: "line", data: [{ name: R.many, labels, values: daily.map(resOf) }], options: { chartColors: [ORANGE], lineSize: 3, lineDataSymbol: "circle", lineDataSymbolSize: 6, secondaryValAxis: true, secondaryCatAxis: true } },
    ], {
      x: 0.6, y: 1.5, w: 12.15, h: 5.3, fontFace: FONT, showLegend: true, legendPos: "b", legendFontSize: 11,
      catAxisLabelColor: MUTED, valAxisLabelColor: MUTED, legendColor: MUTED, dataLabelColor: INK, catAxisLabelFontSize: 9, valAxisLabelFontSize: 9, valGridLine: { color: "4A4540", size: 0.5 },
      valAxes: [{ showValAxisTitle: false, valAxisLabelFormatCode: "#,##0" }, { showValAxisTitle: false }],
      catAxes: [{ catAxisTitle: "" }, { catAxisHidden: true }],
    });
    footer(s, a.client.name, n);
  }

  // 4) campanhas
  if (a.funnels.length) {
    const s = pptx.addSlide(); n++;
    header(s, "Campanhas", `${R.cost} comparado com a média do cliente nos últimos 90 dias`);
    const rows: PptxGenJS.TableRow[] = [head(["Campanha", "Investimento", R.many, R.cost, "Referência", "Gargalo"], ["left", "right", "right", "right", "right", "left"])];
    for (const f of a.funnels.slice(0, 9)) {
      const better = f.cpr !== null && f.bench_cpr !== null && f.cpr <= f.bench_cpr;
      const bn = f.steps.find((x) => x.id === f.bottleneck);
      rows.push([cell(f.name), cell(brl(f.spend), { align: "right" }), cell(int(f.result), { align: "right" }),
        cell(brl(f.cpr), { align: "right", bold: true, color: f.cpr === null ? MUTED : better ? OK : BAD }), cell(brl(f.bench_cpr), { align: "right", color: MUTED }),
        cell(bn ? bn.label : "—", { color: bn ? BAD : MUTED })]);
    }
    s.addTable(rows, { x: 0.6, y: 1.55, w: 12.15, colW: [4.6, 1.5, 1.2, 1.6, 1.4, 1.85], border: { type: "solid", color: LINE, pt: 0.75 }, fill: { color: CARD }, rowH: 0.42 });
    footer(s, a.client.name, n);
  }

  // 5) funil das principais campanhas
  for (const f of a.funnels.slice(0, 2)) {
    const s = pptx.addSlide(); n++;
    header(s, `Funil · ${f.name}`, `${int(f.result)} ${R.many.toLowerCase()} · ${brl(f.cpr)} por resultado · referência ${brl(f.bench_cpr)}`);
    f.steps.forEach((st, i) => {
      // cada etapa na própria escala: compara a campanha com a referência daquela etapa
      const max = Math.max(st.rate ?? 0, st.bench ?? 0, 0.0001);
      const y = 1.7 + i * 0.95;
      const isBn = st.id === f.bottleneck;
      s.addText(st.label, { x: 0.6, y, w: 3.6, h: 0.5, fontFace: FONT, fontSize: 14, bold: isBn, color: isBn ? BAD : INK });
      const w1 = Math.max(0.05, 6 * ((st.rate ?? 0) / max)), w2 = Math.max(0.05, 6 * ((st.bench ?? 0) / max));
      s.addShape("rect", { x: 4.3, y: y + 0.02, w: w1, h: 0.3, fill: { color: isBn ? BAD : (st.index ?? 1) >= 1 ? OK : ORANGE }, line: { type: "none" } });
      s.addShape("rect", { x: 4.3, y: y + 0.37, w: w2, h: 0.14, fill: { color: "4A4540" }, line: { type: "none" } });
      s.addText(`${rate(st.rate)}  ·  ref. ${rate(st.bench)}`, { x: 10.5, y, w: 2.3, h: 0.5, fontFace: FONT, fontSize: 11, color: INK, align: "right" });
    });
    const issue = f.issues[0];
    if (issue) {
      const y = 1.9 + f.steps.length * 0.95;
      s.addShape("rect", { x: 0.6, y, w: 12.15, h: Math.min(6.8 - y, 1.9), fill: { color: CARD }, line: { color: BAD, width: 1 } });
      s.addText([
        { text: issue.text, options: { bold: true, color: BAD, breakLine: true } },
        ...issue.fixes.slice(0, 2).map((x) => ({ text: `• ${x}`, options: { color: INK, breakLine: true } })),
      ], { x: 0.8, y: y + 0.1, w: 11.8, h: Math.min(6.6 - y, 1.7), fontFace: FONT, fontSize: 12, valign: "top" });
    }
    s.addText("Barra colorida = campanha · barra cinza = média do cliente", { x: 0.6, y: 6.75, w: 8, h: 0.3, fontFace: FONT, fontSize: 9, color: MUTED });
    footer(s, a.client.name, n);
  }

  // 6) posicionamentos
  const plc = (a.cuts.placement ?? []).filter((x) => x.spend > 1).slice(0, 10);
  if (plc.length) {
    const s = pptx.addSlide(); n++;
    header(s, "Onde o anúncio performa melhor", `Posicionamentos nos últimos 30 dias · ${R.cost.toLowerCase()}`);
    const withRes = plc.filter((x) => x.cpr !== null);
    if (withRes.length) s.addChart("bar", [{ name: R.cost, labels: withRes.map((x) => x.label), values: withRes.map((x) => Math.round((x.cpr ?? 0) * 100) / 100) }], {
      x: 0.6, y: 1.5, w: 6.4, h: 5.2, barDir: "bar", chartColors: [ORANGE], fontFace: FONT, catAxisLabelColor: MUTED, valAxisLabelColor: MUTED, legendColor: MUTED, dataLabelColor: INK, catAxisLabelFontSize: 10, valAxisLabelFontSize: 9,
      showValue: true, dataLabelFormatCode: "R$ #,##0.00", dataLabelFontSize: 9, valGridLine: { style: "none" },
    } as PptxGenJS.IChartOpts);
    const rows: PptxGenJS.TableRow[] = [head(["Posicionamento", "% verba", R.many])];
    for (const x of plc) rows.push([cell(x.label), cell(pct(x.share, 0), { align: "right" }), cell(int(x.result), { align: "right" })]);
    s.addTable(rows, { x: 7.3, y: 1.5, w: 5.45, colW: [3.25, 1.1, 1.1], border: { type: "solid", color: LINE, pt: 0.75 }, fill: { color: CARD }, rowH: 0.38, fontSize: 10 });
    footer(s, a.client.name, n);
  }

  // 7) público e horário
  const ag = (a.cuts.age_gender ?? []).filter((x) => x.spend > 1);
  const hr = a.cuts.hour ?? [];
  if (ag.length || hr.length) {
    const s = pptx.addSlide(); n++;
    header(s, "Quem responde e quando", "Idade, gênero e horário dos últimos 30 dias");
    const top = [...ag].sort((x, y) => (y.index ?? 0) - (x.index ?? 0)).slice(0, 8);
    const rows: PptxGenJS.TableRow[] = [head(["Público", R.many, R.cost])];
    for (const x of top) rows.push([cell(x.label), cell(int(x.result), { align: "right" }), cell(brl(x.cpr), { align: "right", bold: true })]);
    s.addTable(rows, { x: 0.6, y: 1.5, w: 5.6, colW: [2.8, 1.2, 1.6], border: { type: "solid", color: LINE, pt: 0.75 }, fill: { color: CARD }, rowH: 0.4 });
    if (hr.length) s.addChart("bar", [{ name: R.many, labels: hr.map((x) => x.key), values: hr.map((x) => x.result) }], {
      x: 6.5, y: 1.5, w: 6.25, h: 5.2, chartColors: [ORANGE], fontFace: FONT, catAxisLabelColor: MUTED, valAxisLabelColor: MUTED, legendColor: MUTED, dataLabelColor: INK, catAxisLabelFontSize: 8, valAxisLabelFontSize: 9,
      showTitle: true, title: `${R.many} por hora do dia`, titleFontSize: 12, titleColor: INK, valGridLine: { color: "4A4540", size: 0.5 },
    } as PptxGenJS.IChartOpts);
    footer(s, a.client.name, n);
  }

  // 8) regiões e conjuntos
  const sets = (a.cuts.adset ?? []).filter((x) => x.spend > 1).slice(0, 9);
  if (sets.length) {
    const s = pptx.addSlide(); n++;
    header(s, "Regiões e conjuntos de anúncios", "Cidades e raio de cada conjunto, últimos 30 dias");
    const rows: PptxGenJS.TableRow[] = [head(["Conjunto — localização", "Investimento", R.many, R.cost])];
    for (const x of sets) rows.push([cell(x.label), cell(brl(x.spend), { align: "right" }), cell(int(x.result), { align: "right" }),
      cell(brl(x.cpr), { align: "right", bold: true, color: (x.index ?? 1) >= 1.1 ? OK : (x.index ?? 1) <= 0.8 ? BAD : INK })]);
    s.addTable(rows, { x: 0.6, y: 1.5, w: 12.15, colW: [7.3, 1.7, 1.3, 1.85], border: { type: "solid", color: LINE, pt: 0.75 }, fill: { color: CARD }, rowH: 0.42 });
    footer(s, a.client.name, n);
  }

  // 9) melhores criativos
  const best = creatives.filter((c) => c.verdict !== "teste" && c.score >= 55).sort((x, y) => y.score - x.score).slice(0, 4);
  if (best.length) {
    const s = pptx.addSlide(); n++;
    header(s, "Criativos que mais performaram", "Nota 0–100 da análise de criativos");
    best.forEach((c, i) => {
      const x = 0.6 + i * 3.1;
      s.addShape("rect", { x, y: 1.5, w: 2.9, h: 5.3, fill: { color: CARD }, line: { color: LINE, width: 1 } });
      const img = (c.image_url && images[c.image_url]) || (c.thumbnail_url && images[c.thumbnail_url]);
      if (img) s.addImage({ data: img, x: x + 0.1, y: 1.6, w: 2.7, h: 3.375, sizing: { type: "contain", w: 2.7, h: 3.375 } });
      else s.addShape("rect", { x: x + 0.1, y: 1.6, w: 2.7, h: 3.375, fill: { color: "4A4540" }, line: { type: "none" } });
      s.addText(`${c.score}`, { x: x + 2.05, y: 1.7, w: 0.65, h: 0.5, fontFace: FONT, fontSize: 16, bold: true, color: "FFFFFF", align: "center", fill: { color: BLACK } });
      s.addText(c.name ?? "Anúncio", { x: x + 0.15, y: 5.05, w: 2.6, h: 0.4, fontFace: FONT, fontSize: 12, bold: true, color: INK });
      s.addText([
        { text: `${c.kind === "purchase" && c.roas ? `ROAS ${c.roas.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}x` : `${brl(c.costPerResult)} por resultado`}`, options: { breakLine: true } },
        { text: `CTR ${c.ctr === null ? "—" : c.ctr.toLocaleString("pt-BR", { maximumFractionDigits: 2 }) + "%"}${c.hookRate !== null ? ` · gancho ${c.hookRate.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%` : ""}`, options: { breakLine: true } },
        { text: `${brl(c.spend)} investidos`, options: {} },
      ], { x: x + 0.15, y: 5.45, w: 2.6, h: 1.2, fontFace: FONT, fontSize: 10.5, color: MUTED, valign: "top" });
    });
    footer(s, a.client.name, n);
  }

  // 10) diagnóstico
  {
    const s = pptx.addSlide(); n++;
    header(s, "Diagnóstico", ai ? `Análise estratégica · nota de saúde ${ai.analysis.nota_saude}/10` : "Gargalos e oportunidades identificados nos dados");
    const items = ai
      ? [...ai.analysis.gargalos.map((g) => ({ t: g.titulo, d: `${g.evidencia}. ${g.causa_provavel ? `Causa provável: ${g.causa_provavel}.` : ""}`, a: g.acao, bad: true })),
         ...ai.analysis.oportunidades.map((o) => ({ t: o.titulo, d: o.evidencia, a: o.acao, bad: false }))]
      : [...a.funnels.flatMap((f) => f.issues.map((i) => ({ t: f.name, d: i.text, a: i.fixes[0] ?? "", bad: true }))),
         ...a.insights.map((i) => ({ t: i.area, d: i.text, a: i.action, bad: false }))];
    items.slice(0, 5).forEach((it, i) => {
      const y = 1.5 + i * 1.08;
      s.addShape("rect", { x: 0.6, y, w: 0.1, h: 0.95, fill: { color: it.bad ? BAD : OK }, line: { type: "none" } });
      s.addText([
        { text: it.t, options: { bold: true, fontSize: 13, color: INK, breakLine: true } },
        { text: it.d, options: { fontSize: 11, color: MUTED, breakLine: true } },
        { text: `→ ${it.a}`, options: { fontSize: 11, color: INK } },
      ], { x: 0.85, y, w: 11.9, h: 0.98, fontFace: FONT, valign: "top" });
    });
    footer(s, a.client.name, n);
  }

  // 11) plano de ação
  {
    const s = pptx.addSlide(); n++;
    header(s, "Plano de ação", "Próximos 7 dias");
    const plan = ai?.analysis.plano_7_dias?.length ? ai.analysis.plano_7_dias
      : [...a.funnels.flatMap((f) => f.issues.flatMap((i) => i.fixes.slice(0, 1))), ...a.insights.map((i) => i.action)].slice(0, 6);
    s.addText(plan.slice(0, 7).map((p, i) => ({ text: `${i + 1}.  ${p}`, options: { breakLine: true, paraSpaceAfter: 10 } })),
      { x: 0.6, y: 1.5, w: ai?.analysis.testes?.length ? 6.6 : 12.1, h: 5.3, fontFace: FONT, fontSize: 14, color: INK, valign: "top" });
    if (ai?.analysis.testes?.length) {
      s.addShape("rect", { x: 7.5, y: 1.5, w: 5.25, h: 5.3, fill: { color: BLACK }, line: { type: "none" } });
      s.addText("Testes recomendados", { x: 7.75, y: 1.65, w: 4.8, h: 0.4, fontFace: FONT, fontSize: 14, bold: true, color: ORANGE });
      s.addText(ai.analysis.testes.slice(0, 3).flatMap((t) => [
        { text: t.hipotese, options: { bold: true, color: "FFFFFF", breakLine: true } },
        { text: `${t.como_testar} · métrica: ${t.metrica}`, options: { color: MUTED, breakLine: true, paraSpaceAfter: 10 } },
      ]), { x: 7.75, y: 2.1, w: 4.8, h: 4.5, fontFace: FONT, fontSize: 11, valign: "top" });
    }
    footer(s, a.client.name, n);
  }

  const file = `Relatório ${a.client.name} ${dmy(a.since).replace(/\//g, "-")} a ${dmy(a.until).replace(/\//g, "-")}.pptx`;
  await pptx.writeFile({ fileName: file });
}
