// Relatório mensal em slides para o cliente — no padrão visual Impacto (fundo escuro, título com a conclusão, destaque laranja)
import PptxGenJS from "pptxgenjs";
import type { AutoReport } from "./manager";
import { images64 } from "./strategy";

const BG = "141312", CARD = "201E1C", LINE = "34302C", CREAM = "F3EFE8", GREY = "A8A29A", ORANGE = "FF6B00";
const HEAD = "Arial Black", BODY = "Arial";
const W = 13.33, X0 = 0.89, CW = W - 2 * X0;

type Kind = "purchase" | "conversation" | "lead" | "click";
const TXT: Record<Kind, { one: string; many: string; per: string; label: string; sub: string }> = {
  conversation: { one: "conversa", many: "conversas", per: "por conversa", label: "Conversas iniciadas", sub: "Campanha de mensagens: conversas no WhatsApp" },
  lead: { one: "cadastro", many: "cadastros", per: "por cadastro", label: "Cadastros recebidos", sub: "Campanha de cadastros (leads)" },
  purchase: { one: "venda", many: "vendas", per: "por venda", label: "Vendas no site", sub: "Campanha de vendas" },
  click: { one: "clique", many: "cliques", per: "por clique", label: "Cliques no link", sub: "Campanha de tráfego" },
};
const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const MON = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const brl = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
const int = (v: number | null | undefined) => (v === null || v === undefined ? "—" : Math.round(v).toLocaleString("pt-BR"));
const day = (iso: string) => Number(iso.slice(8));
const mon = (iso: string) => Number(iso.slice(5, 7)) - 1;
function periodLong(since: string, until: string) {
  if (mon(since) === mon(until)) return `${day(since)} a ${day(until)} de ${MONTHS[mon(until)]} de ${until.slice(0, 4)}`;
  return `${day(since)} de ${MONTHS[mon(since)]} a ${day(until)} de ${MONTHS[mon(until)]} de ${until.slice(0, 4)}`;
}
const periodShort = (since: string, until: string) => mon(since) === mon(until) ? `${day(since)} a ${day(until)}/${MON[mon(until)]}` : `${day(since)}/${MON[mon(since)]} a ${day(until)}/${MON[mon(until)]}`;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// painel laranja em degradê (o pptx não tem degradê em formas: vai como imagem)
function gradientPng(): string | null {
  try {
    const c = document.createElement("canvas"); c.width = 600; c.height = 1125;
    const g = c.getContext("2d")!;
    const gr = g.createLinearGradient(0, 0, 300, 1125);
    gr.addColorStop(0, "#FF7F2E"); gr.addColorStop(1, "#E0560B");
    g.fillStyle = gr; g.fillRect(0, 0, 600, 1125);
    return c.toDataURL("image/png");
  } catch { return null; }
}

interface Ad { id: string; name: string; result: number; spend: number; cpr: number | null; image_url: string | null; status: string | null }
interface Act { kind: string; rule: string; object_type: string; object_name: string; campaign_name: string | null; evidence: Record<string, number> | null }

export async function buildMonthlyDeck(r: AutoReport, clientName: string) {
  const d = r.data as {
    kind: Kind | null; summary: { spend: number; result: number; cpr: number | null; value: number; roas: number | null; reach: number | null; frequency: number | null;
      period_impressions: number; impressions: number; prev_result: number; prev_cpr: number | null; prev_spend: number };
    ads: Ad[]; actions: Act[]; next: string[]; daily?: { date: string; spend: number; conversations: number; leads: number; purchases: number; link_clicks: number }[];
    analysis?: { cuts?: Record<string, { label: string; result: number; spend: number; share: number; cpr: number | null }[]> };
  };
  const kind: Kind = d.kind ?? "click";
  const T = TXT[kind];
  const sm = d.summary;
  const short = periodShort(r.since, r.until);
  const monthName = MONTHS[mon(r.until)];
  const wholeMonth = day(r.since) === 1 && mon(r.since) === mon(r.until);

  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "Impacto";
  pptx.title = `Relatório ${clientName} — ${monthName}`;
  let n = 0;

  const base = (eyebrow: string, headline: string) => {
    const s = pptx.addSlide(); n++;
    s.background = { color: BG };
    s.addText(eyebrow.toUpperCase(), { x: X0, y: 0.55, w: CW, h: 0.35, fontFace: BODY, fontSize: 13, bold: true, color: ORANGE, charSpacing: 3, margin: 0 });
    s.addText(headline, { x: X0, y: 0.9, w: CW, h: 0.95, fontFace: HEAD, fontSize: 32, color: CREAM, margin: 0, valign: "middle", fit: "shrink" });
    s.addText([
      { text: "IMPACTO", options: { bold: true, color: ORANGE } },
      { text: ` · ${clientName} · ${short}`, options: { color: GREY } },
    ], { x: X0, y: 6.8, w: 9, h: 0.35, fontFace: BODY, fontSize: 12, margin: 0 });
    s.addText(String(n).padStart(2, "0"), { x: W - X0 - 1, y: 6.8, w: 1, h: 0.35, fontFace: BODY, fontSize: 12, color: GREY, align: "right", margin: 0 });
    return s;
  };
  const card = (s: PptxGenJS.Slide, x: number, y: number, w: number, h: number, hi = false) =>
    s.addShape("roundRect", { x, y, w, h, rectRadius: 0.12, fill: { color: CARD }, line: { color: hi ? ORANGE : LINE, width: hi ? 1.5 : 0.75 } });

  // 1) capa
  {
    const s = pptx.addSlide(); n++;
    s.background = { color: BG };
    const g = gradientPng();
    if (g) s.addImage({ data: g, x: 9.33, y: 0, w: 4, h: 7.5 });
    else s.addShape("rect", { x: 9.33, y: 0, w: 4, h: 7.5, fill: { color: ORANGE }, line: { type: "none" } });
    s.addText([{ text: "IMPACTO", options: { color: CREAM } }, { text: ".", options: { color: ORANGE } }],
      { x: X0, y: 0.8, w: 4, h: 0.5, fontFace: HEAD, fontSize: 22, charSpacing: 4, margin: 0 });
    s.addText("RELATÓRIO DE PERFORMANCE · META ADS", { x: X0, y: 2.4, w: 8.2, h: 0.35, fontFace: BODY, fontSize: 13, bold: true, color: ORANGE, charSpacing: 3, margin: 0 });
    s.addText(clientName, { x: X0, y: 2.8, w: 8.2, h: 1.9, fontFace: HEAD, fontSize: clientName.length > 22 ? 44 : 54, color: CREAM, margin: 0, valign: "top", fit: "shrink" });
    s.addText(T.sub, { x: X0, y: 4.75, w: 8.2, h: 0.5, fontFace: BODY, fontSize: 22, color: GREY, margin: 0 });
    s.addText(`Período: ${periodLong(r.since, r.until)}`, { x: X0, y: 6.35, w: 8.2, h: 0.35, fontFace: BODY, fontSize: 13, color: GREY, margin: 0 });
  }

  // 2) visão geral
  {
    const diff = sm.prev_result ? (sm.result - sm.prev_result) / sm.prev_result : null;
    const headline = `${int(sm.result)} ${sm.result === 1 ? T.one : T.many} ${wholeMonth ? `em ${monthName}` : `de ${short}`}` +
      (diff !== null && Math.abs(diff) >= 0.05 ? `, ${Math.abs(Math.round(diff * 100))}% ${diff > 0 ? "a mais" : "a menos"} que no mês anterior` : "");
    const s = base(`Visão geral · ${periodLong(r.since, r.until).replace(/ de \d{4}$/, "")}`, headline);
    const cards: [string, string, boolean][] = kind === "purchase"
      ? [[int(sm.result), T.label, true], [brl(sm.cpr), `Custo médio ${T.per}`, false], [brl(sm.value), "Faturamento atribuído", false],
         [sm.roas ? `${sm.roas.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}×` : "—", "Retorno sobre o investimento", false], [brl(sm.spend), "Investimento no período", false], [int(sm.reach), "Pessoas alcançadas", false]]
      : [[int(sm.result), T.label, true], [brl(sm.cpr), `Custo médio ${T.per}`, false], [brl(sm.spend), "Investimento no período", false],
         [int(sm.reach), "Pessoas alcançadas", false], [int(sm.period_impressions || sm.impressions), "Impressões", false],
         [sm.frequency ? `${sm.frequency.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}×` : "—", "Frequência média", false]];
    const cw = (CW - 2 * 0.34) / 3;
    cards.forEach(([v, l, hi], i) => {
      const x = X0 + (i % 3) * (cw + 0.34), y = 2.2 + Math.floor(i / 3) * 1.65;
      card(s, x, y, cw, 1.4, hi);
      s.addText(v, { x: x + 0.3, y: y + 0.18, w: cw - 0.5, h: 0.65, fontFace: HEAD, fontSize: 30, color: hi ? ORANGE : CREAM, margin: 0, fit: "shrink" });
      s.addText(l, { x: x + 0.3, y: y + 0.85, w: cw - 0.5, h: 0.35, fontFace: BODY, fontSize: 15, color: hi ? CREAM : GREY, margin: 0 });
    });
  }

  // 3) evolução diária
  // começa no primeiro dia com investimento (campanhas que começaram no meio do mês)
  const firstSpend = (d.daily ?? []).findIndex((x) => x.spend > 0);
  const daily = firstSpend >= 0 ? (d.daily ?? []).slice(firstSpend) : [];
  if (daily.length >= 5) {
    const res = (x: (typeof daily)[number]) => kind === "purchase" ? x.purchases : kind === "lead" ? x.leads : kind === "click" ? x.link_clicks : x.conversations;
    const best = [...daily].sort((a, b) => res(b) - res(a))[0];
    const s = base("Evolução no período", `Melhor dia: ${day(best.date)}/${MON[mon(best.date)]}, com ${int(res(best))} ${res(best) === 1 ? T.one : T.many}`);
    s.addChart("bar", [{ name: cap(T.many), labels: daily.map((x) => `${day(x.date)}`), values: daily.map(res) }], {
      x: X0, y: 2.1, w: CW, h: 4.4, chartColors: [ORANGE], barGapWidthPct: 35, fontFace: BODY,
      catAxisLabelColor: GREY, valAxisLabelColor: GREY, catAxisLabelFontSize: 10, valAxisLabelFontSize: 10,
      catAxisLineShow: false, valAxisLineShow: false, valGridLine: { color: LINE, size: 0.5 },
      showValue: false, plotArea: { fill: { color: BG } },
    } as PptxGenJS.IChartOpts);
  }

  // 4) criativos
  const ads = (d.ads ?? []).filter((a) => a.result > 0).slice(0, 3);
  if (ads.length) {
    const top = ads[0];
    const share = sm.result ? top.result / sm.result : 0;
    const cheapest = [...ads].filter((a) => a.cpr !== null && a.result >= 2).sort((a, b) => (a.cpr ?? 9e9) - (b.cpr ?? 9e9))[0];
    const s = base("Criativos", share >= 0.25 ? `O ${top.name} trouxe ${Math.round(share * 100)}% das ${T.many}` : `Os criativos que mais trouxeram ${T.many}`);
    const imgs = await images64(ads.map((a) => a.image_url).filter(Boolean) as string[]).catch(() => ({} as Record<string, string>));
    const cw = (CW - 2 * 0.34) / 3;
    ads.forEach((a, i) => {
      const x = X0 + i * (cw + 0.34), y = 2.1;
      const hi = i === 0;
      card(s, x, y, cw, 3.65, hi);
      const img = a.image_url ? imgs[a.image_url] : undefined;
      if (img) s.addImage({ data: img, x: x + 0.3, y: y + 0.28, w: 1.55, h: 1.55, sizing: { type: "cover", w: 1.55, h: 1.55 }, rounding: false });
      else s.addShape("roundRect", { x: x + 0.3, y: y + 0.28, w: 1.55, h: 1.55, rectRadius: 0.08, fill: { color: LINE }, line: { type: "none" } });
      const validated = hi && (a.result >= 5 || share >= 0.3);
      s.addText(`${a.name.toUpperCase()}${validated ? " · VALIDADO" : ""}`, { x: x + 0.3, y: y + 1.98, w: cw - 0.5, h: 0.3, fontFace: BODY, fontSize: 12, bold: true, color: ORANGE, charSpacing: 2, margin: 0, fit: "shrink" });
      s.addText(`${int(a.result)} ${a.result === 1 ? T.one : T.many}`, { x: x + 0.3, y: y + 2.3, w: cw - 0.5, h: 0.6, fontFace: HEAD, fontSize: 28, color: CREAM, margin: 0, fit: "shrink" });
      s.addText(`${brl(a.cpr)} ${T.per}${cheapest && cheapest.id === a.id ? ", o menor custo" : ""}`, { x: x + 0.3, y: y + 2.9, w: cw - 0.5, h: 0.6, fontFace: BODY, fontSize: 14, color: GREY, margin: 0, valign: "top" });
    });
    const paused = (d.actions ?? []).filter((x) => x.kind === "pause" && x.object_type === "ad").slice(0, 2);
    if (paused.length) {
      const p = paused[0], ev = p.evidence ?? {};
      const detail = ev.resultados ? `${int(ev.resultados)} ${ev.resultados === 1 ? T.one : T.many} a ${brl(ev.custo)}` : ev.gasto ? `${brl(ev.gasto)} sem ${T.many}` : "";
      s.addText(`O ${p.object_name} foi desativado${detail ? ` (${detail})` : ""} para concentrar a verba nos anúncios que convertem melhor.${paused.length > 1 ? ` Outro anúncio também foi pausado pelo mesmo motivo.` : ""}`,
        { x: X0, y: 6.0, w: CW, h: 0.45, fontFace: BODY, fontSize: 14, color: GREY, margin: 0 });
    }
  }

  // 5) onde e quem
  const plc = (d.analysis?.cuts?.placement ?? []).filter((x) => x.result > 0).sort((a, b) => b.result - a.result).slice(0, 4);
  const ag = (d.analysis?.cuts?.age_gender ?? []).filter((x) => x.result > 0).sort((a, b) => b.result - a.result).slice(0, 3);
  if (plc.length >= 2) {
    const tot = (d.analysis?.cuts?.placement ?? []).reduce((t, x) => t + x.result, 0) || 1;
    const s = base("Onde e para quem", `${plc[0].label} trouxe ${Math.round((plc[0].result / tot) * 100)}% das ${T.many}`);
    s.addText("POSICIONAMENTOS", { x: X0, y: 2.1, w: 6, h: 0.3, fontFace: BODY, fontSize: 11, bold: true, color: GREY, charSpacing: 2, margin: 0 });
    plc.forEach((p, i) => {
      const y = 2.55 + i * 0.95, share = p.result / tot;
      s.addText(p.label, { x: X0, y, w: 4.2, h: 0.35, fontFace: BODY, fontSize: 15, color: CREAM, margin: 0 });
      s.addText(`${int(p.result)} · ${brl(p.cpr)}`, { x: X0 + 4.2, y, w: 2.1, h: 0.35, fontFace: BODY, fontSize: 13, color: GREY, align: "right", margin: 0 });
      s.addShape("roundRect", { x: X0, y: y + 0.42, w: 6.3, h: 0.16, rectRadius: 0.08, fill: { color: LINE }, line: { type: "none" } });
      s.addShape("roundRect", { x: X0, y: y + 0.42, w: Math.max(0.12, 6.3 * share), h: 0.16, rectRadius: 0.08, fill: { color: i === 0 ? ORANGE : GREY }, line: { type: "none" } });
    });
    if (ag.length) {
      s.addText("QUEM MAIS RESPONDEU", { x: 7.9, y: 2.1, w: 4.5, h: 0.3, fontFace: BODY, fontSize: 11, bold: true, color: GREY, charSpacing: 2, margin: 0 });
      ag.forEach((x, i) => {
        const y = 2.55 + i * 1.25;
        card(s, 7.9, y, CW - (7.9 - X0), 1.05, i === 0);
        s.addText(x.label, { x: 8.15, y: y + 0.15, w: 3, h: 0.4, fontFace: HEAD, fontSize: 18, color: i === 0 ? ORANGE : CREAM, margin: 0 });
        s.addText(`${int(x.result)} ${x.result === 1 ? T.one : T.many} · ${brl(x.cpr)} ${T.per}`, { x: 8.15, y: y + 0.58, w: 4.1, h: 0.35, fontFace: BODY, fontSize: 13, color: GREY, margin: 0 });
      });
    }
  }

  // 6) o que fizemos
  const did = (d.actions ?? []).map((a) => actionText(a, T)).filter(Boolean) as string[];
  if (did.length) {
    const s = base("O que fizemos", `${did.length} ${did.length === 1 ? "ajuste" : "ajustes"} para melhorar o resultado`);
    did.slice(0, 6).forEach((t, i) => {
      const y = 2.15 + i * 0.72;
      s.addShape("ellipse", { x: X0, y: y + 0.12, w: 0.14, h: 0.14, fill: { color: ORANGE }, line: { type: "none" } });
      s.addText(t, { x: X0 + 0.35, y, w: CW - 0.35, h: 0.4, fontFace: BODY, fontSize: 16, color: CREAM, margin: 0, fit: "shrink" });
    });
  }

  // 7) próximos passos
  {
    const next = (d.next ?? []).slice(0, 3);
    const nextMonth = MONTHS[(mon(r.until) + 1) % 12];
    const s = base("Próximos passos", `O plano para ${nextMonth}`);
    const list = next.length ? next : ["Manter o que está funcionando e seguir testando criativos novos."];
    const cw = (CW - (list.length - 1) * 0.34) / list.length;
    list.forEach((t, i) => {
      const x = X0 + i * (cw + 0.34);
      card(s, x, 2.15, cw, 3.2, i === 0);
      s.addText(String(i + 1).padStart(2, "0"), { x: x + 0.3, y: 2.4, w: 1.2, h: 0.6, fontFace: HEAD, fontSize: 28, color: ORANGE, margin: 0 });
      s.addText(t, { x: x + 0.3, y: 3.15, w: cw - 0.6, h: 2, fontFace: BODY, fontSize: 17, color: CREAM, margin: 0, valign: "top" });
    });
  }

  const file = `Relatório ${clientName} — ${cap(monthName)} ${r.until.slice(0, 4)}.pptx`;
  await pptx.writeFile({ fileName: file });
}

function actionText(a: Act, T: (typeof TXT)[Kind]): string | null {
  const n = `"${a.object_name}"`;
  const what = a.object_type === "ad" ? "o anúncio" : a.object_type === "adset" ? "o público" : "a campanha";
  const ev = a.evidence ?? {};
  if (a.kind === "pause") {
    if (a.rule === "pause_no_result") return `Pausamos ${what} ${n}, que gastou ${brl(ev.gasto)} sem gerar ${T.many}.`;
    if (a.rule === "pause_expensive") return `Pausamos ${what} ${n} (${brl(ev.custo)} ${T.per}) e passamos a verba aos mais eficientes.`;
    return `Pausamos ${what} ${n}.`;
  }
  if (a.kind === "activate") return `Reativamos ${what} ${n}.`;
  if (a.kind === "set_budget") return a.rule === "scale_up" ? `Aumentamos a verba de ${n}, que trazia ${T.many} abaixo do custo médio.`
    : a.rule === "scale_down" ? `Reduzimos a verba de ${n} até o custo voltar à média.` : `Ajustamos a verba de ${n}.`;
  if (a.kind === "create_ad") return `Colocamos no ar um criativo novo${a.campaign_name ? ` em "${a.campaign_name}"` : ""}.`;
  if (a.kind === "launch_campaign") return `Lançamos a campanha ${n}.`;
  return null;
}
