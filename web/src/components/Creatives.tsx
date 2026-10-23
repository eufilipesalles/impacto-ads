import { useEffect, useState } from "react";
import { getCreativeDaily } from "../lib/api";
import { useAsync } from "../lib/hooks";
import { count, money } from "../lib/format";
import {
  briefing, CTA_LABEL, FORMAT_LABEL, PART_LABEL, RANKING_LABEL, RESULT_LABEL, VERDICT_LABEL,
  type Part, type ScoredCreative,
} from "../lib/creative";
import { DailyChart } from "./DailyChart";

const dec1 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const dec2 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const pct1 = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${dec1.format(v)}%`);
export const pct2 = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${dec2.format(v)}%`);
const roasFmt = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${dec2.format(v)}x`);

const SHORT_COST = { purchase: "Custo/venda", conversation: "Custo/conv.", lead: "Custo/lead", click: "CPC", impression: "CPM" } as const;
const tone = (s: number | null | undefined) => (s === null || s === undefined ? "" : s >= 60 ? "good" : s < 40 ? "bad" : "mid");
const partScore = (c: ScoredCreative, id: Part["id"]) => c.parts.find((p) => p.id === id)?.score ?? null;

// Valor principal de resultado: ROAS para vendas com faturamento, senão custo por resultado
export function resultValue(c: ScoredCreative) {
  if (c.kind === "purchase" && c.purchase_value > 0) return { label: "ROAS", text: roasFmt(c.roas) };
  return { label: RESULT_LABEL[c.kind].cost, text: c.results ? money(c.costPerResult) : "sem resultado" };
}

export function ScoreBadge({ c, size = "md" }: { c: ScoredCreative; size?: "md" | "lg" }) {
  const r = size === "lg" ? 30 : 21, w = size === "lg" ? 5 : 4, d = (r + w) * 2;
  const len = 2 * Math.PI * r;
  return (
    <span className={`score ${size} v-${c.verdict}`} title={`Nota ${c.score} de 100`}>
      <svg width={d} height={d} viewBox={`0 0 ${d} ${d}`} aria-hidden="true">
        <circle cx={d / 2} cy={d / 2} r={r} fill="none" strokeWidth={w} className="score-track" />
        <circle cx={d / 2} cy={d / 2} r={r} fill="none" strokeWidth={w} className="score-arc"
          strokeDasharray={`${(len * c.score) / 100} ${len}`} transform={`rotate(-90 ${d / 2} ${d / 2})`} strokeLinecap="round" />
      </svg>
      <b>{c.verdict === "teste" ? "—" : c.score}</b>
    </span>
  );
}

function Thumb({ c }: { c: ScoredCreative }) {
  const src = c.thumbnail_url ?? c.image_url;
  const [broken, setBroken] = useState(false);
  return src && !broken
    ? <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
    : <span>{FORMAT_LABEL[c.format ?? ""] ?? "sem prévia"}</span>;
}

export function CreativeCard({ c, onOpen, showClient = true }: { c: ScoredCreative; onOpen: () => void; showClient?: boolean }) {
  const rv = resultValue(c);
  return (
    <article className={`card cr v-${c.verdict}`}>
      <button className="cr-hit" onClick={onOpen} aria-label={`Abrir análise de ${c.name ?? "criativo"}`} />
      <div className="cr-thumb">
        <Thumb c={c} />
        <div className="cr-tags">
          <span className={`verdict v-${c.verdict}`}>{VERDICT_LABEL[c.verdict]}</span>
          {c.fatigue && <span className="verdict v-fatigue">Saturando</span>}
        </div>
        <ScoreBadge c={c} />
      </div>
      <div className="cr-body">
        <div>
          <div className="cr-name">{c.name ?? "Anúncio sem nome"}</div>
          <div className="cr-sub">
            {showClient ? `${c.client_name} · ` : ""}{FORMAT_LABEL[c.format ?? ""] ?? "—"}
            {c.effective_status && c.effective_status !== "ACTIVE" ? " · pausado" : ""}
          </div>
        </div>
        <div className="cr-nums">
          <div className={tone(partScore(c, "result"))}>{rv.label === "ROAS" ? "ROAS" : SHORT_COST[c.kind]}<b>{c.results || rv.label === "ROAS" ? rv.text.replace("R$\u00a0", "R$") : "—"}</b></div>
          <div className={tone(partScore(c, "hook"))}>Gancho<b>{c.isVideo ? pct1(c.hookRate) : "—"}</b></div>
          <div className={tone(partScore(c, "hold"))}>Retenção<b>{c.isVideo ? pct1(c.holdRate) : "—"}</b></div>
          <div className={tone(partScore(c, "ctr"))}>CTR<b>{pct2(c.ctr)}</b></div>
        </div>
        <p className="cr-read">{c.diagnosis[0]}</p>
        <div className="cr-foot"><span>{money(c.spend)} no período</span><span>{count(c.kind === "impression" ? c.impressions : c.results)} {RESULT_LABEL[c.kind].name.toLowerCase()}</span></div>
      </div>
    </article>
  );
}

function partValue(c: ScoredCreative, p: Part) {
  switch (p.id) {
    case "result": return c.kind === "purchase" && c.purchase_value > 0
      ? { now: roasFmt(p.value), ref: roasFmt(p.bench) }
      : { now: p.value === null ? "sem resultado" : money(p.value), ref: money(p.bench) };
    case "hook": case "hold": return { now: pct1(p.value === null ? null : p.value * 100), ref: pct1(p.bench === null ? null : p.bench * 100) };
    case "ctr": return { now: pct2(p.value === null ? null : p.value * 100), ref: pct2(p.bench === null ? null : p.bench * 100) };
    case "engagement": return { now: p.value === null ? "—" : `${dec1.format(p.value * 1000)}/mil`, ref: p.bench === null ? "—" : `${dec1.format(p.bench * 1000)}/mil` };
    case "quality": return { now: "rankings do Meta", ref: "" };
  }
}

export function CreativeDrawer({ c, days, onClose }: { c: ScoredCreative; days: number; onClose: () => void }) {
  const daily = useAsync(() => getCreativeDaily(c.ad_id, days), [c.ad_id, days]);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", key);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", key); document.body.style.overflow = ""; };
  }, [onClose]);

  async function copy(what: string, text: string) {
    try { await navigator.clipboard.writeText(text); setCopied(what); setTimeout(() => setCopied(null), 2000); }
    catch { setCopied("erro"); }
  }

  const line = c.kind === "purchase" ? "purchases" : c.kind === "lead" ? "leads" : c.kind === "click" ? "link_clicks" : "conversations";
  const eng = [["Reações", c.reactions], ["Comentários", c.comments], ["Compartilhamentos", c.shares], ["Salvamentos", c.saves]] as const;
  const ranks = [["Qualidade", c.quality_ranking], ["Engajamento", c.engagement_ranking], ["Conversão", c.conversion_ranking]] as const;
  const copyText = [c.title && `Título: ${c.title}`, c.body].filter(Boolean).join("\n\n");

  return (
    <div className="drawer-wrap" onClick={onClose}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={c.name ?? "Criativo"} onClick={(e) => e.stopPropagation()}>
        <header className="dr-head">
          <div className="dr-thumb"><Thumb c={c} /></div>
          <div className="dr-title">
            <p className="eyebrow">{c.client_name} · {FORMAT_LABEL[c.format ?? ""] ?? "—"}</p>
            <h2>{c.name ?? "Anúncio sem nome"}</h2>
            <p className="help">{c.campaign_name}</p>
            <div className="dr-tags">
              <span className={`verdict v-${c.verdict}`}>{VERDICT_LABEL[c.verdict]}</span>
              {c.fatigue && <span className="verdict v-fatigue">Saturando</span>}
              {c.effective_status && c.effective_status !== "ACTIVE" && <span className="verdict v-teste">Pausado</span>}
            </div>
          </div>
          <ScoreBadge c={c} size="lg" />
          <button className="dr-close" onClick={onClose} aria-label="Fechar">×</button>
        </header>

        <div className="dr-actions">
          <button className="btn primary small" onClick={() => copy("brief", briefing(c, { money, pct: pct2 }))}>
            {copied === "brief" ? "Copiado ✓" : "Copiar briefing para o time"}
          </button>
          {c.post_url && <a className="btn small" href={c.post_url} target="_blank" rel="noreferrer">Ver publicação</a>}
          {c.preview_url && <a className="btn small" href={c.preview_url} target="_blank" rel="noreferrer">Prévia no Meta</a>}
        </div>

        <section className="dr-sec">
          <h3>Leitura</h3>
          <ul className="dr-read">{c.diagnosis.map((d, i) => <li key={i}>{d}</li>)}</ul>
        </section>

        <section className="dr-sec">
          <h3>Por que a nota {c.verdict === "teste" ? "ainda não vale" : c.score}</h3>
          <p className="help">Cada indicador comparado com a referência ({c.benchScope === "cliente" ? "criativos do próprio cliente" : "média da carteira, porque o cliente tem poucos criativos"}). 50 = igual à referência.</p>
          <div className="parts">
            {c.parts.map((p) => {
              const v = partValue(c, p);
              return (
                <div key={p.id} className="part">
                  <div className="part-top">
                    <span title={PART_LABEL[p.id].help}>{PART_LABEL[p.id].name} <i className="muted">· peso {p.weight}</i></span>
                    <b className={tone(p.score)}>{Math.round(p.score)}</b>
                  </div>
                  <div className="part-bar"><i className={tone(p.score)} style={{ width: `${p.score}%` }} /><em /></div>
                  <div className="part-val">{v.now}{v.ref ? <span className="muted"> · referência {v.ref}</span> : null}</div>
                </div>
              );
            })}
          </div>
        </section>

        {c.curve && (
          <section className="dr-sec">
            <h3>Retenção do vídeo</h3>
            <p className="help">De cada 100 reproduções, quantas chegaram a cada ponto do vídeo. Tempo médio assistido: <b>{c.video_avg_time ? `${dec1.format(c.video_avg_time)} s` : "—"}</b>.</p>
            <div className="curve">
              <div className="curve-col"><div className="curve-bar"><i style={{ height: "100%" }} /></div><b>100</b><span>início</span></div>
              {c.curve.map((p) => (
                <div key={p.label} className="curve-col">
                  <div className="curve-bar"><i style={{ height: `${Math.min(p.pct, 100)}%` }} /></div>
                  <b>{Math.round(p.pct)}</b><span>{p.label}</span>
                </div>
              ))}
            </div>
            <div className="dr-grid">
              <div>Pararam 3 s<b>{count(c.video_3s)}</b><span className="muted">{pct1(c.hookRate)} das impressões</span></div>
              <div>ThruPlays<b>{count(c.thruplays)}</b><span className="muted">{pct1(c.holdRate)} das impressões</span></div>
              <div>Assistiram até o fim<b>{count(c.video_p100)}</b><span className="muted">{c.video_plays ? pct1((c.video_p100 / c.video_plays) * 100) : "—"} das reproduções</span></div>
            </div>
          </section>
        )}

        {(c.body || c.title) && (
          <section className="dr-sec">
            <div className="dr-sec-head">
              <h3>Copy do anúncio</h3>
              <button className="btn small" onClick={() => copy("copy", copyText)}>{copied === "copy" ? "Copiado ✓" : "Copiar texto"}</button>
            </div>
            {c.title && <p className="dr-copy-title">{c.title}</p>}
            {c.body && <p className="dr-copy">{c.body}</p>}
            {c.cta_type && <p className="help">Botão: <b>{CTA_LABEL[c.cta_type] ?? c.cta_type}</b></p>}
          </section>
        )}

        <section className="dr-sec">
          <h3>Números do período</h3>
          <div className="dr-grid">
            <div>Investimento<b>{money(c.spend)}</b></div>
            <div>{RESULT_LABEL[c.kind].name}<b>{c.kind === "impression" ? count(c.impressions) : count(c.results)}</b></div>
            <div>{resultValue(c).label}<b>{resultValue(c).text}</b></div>
            {c.kind === "purchase" && <div>Faturamento<b>{money(c.purchase_value)}</b></div>}
            <div>Impressões<b>{count(c.impressions)}</b></div>
            <div>CPM<b>{money(c.cpm)}</b></div>
            <div>Cliques no link<b>{count(c.link_clicks)}</b></div>
            <div>CTR<b>{pct2(c.ctr)}</b></div>
            <div>Frequência (7 dias)<b>{c.freq_7d ? dec2.format(c.freq_7d) : "—"}</b></div>
            <div>Dias com veiculação<b>{count(c.days_active)}</b></div>
            {c.ctrChange !== null && <div>CTR na última semana<b className={c.ctrChange <= -25 ? "bad" : c.ctrChange >= 10 ? "good" : ""}>{c.ctrChange > 0 ? "+" : ""}{Math.round(c.ctrChange)}%</b></div>}
          </div>
          <div className="dr-grid four">
            {eng.map(([l, v]) => <div key={l}>{l}<b>{count(v)}</b></div>)}
          </div>
        </section>

        <section className="dr-sec">
          <h3>Rankings do Meta <span className="muted">· últimos 7 dias</span></h3>
          {ranks.some(([, r]) => r) ? (
            <div className="ranks">
              {ranks.map(([l, r]) => (
                <div key={l}><span>{l}</span><b className={r ? RANKING_LABEL[r]?.tone : ""}>{r ? RANKING_LABEL[r]?.text ?? r : "—"}</b></div>
              ))}
            </div>
          ) : <p className="help">O Meta só mostra os rankings para anúncios com mais de 500 impressões nos últimos 7 dias.</p>}
        </section>

        <section className="dr-sec">
          <h3>Dia a dia</h3>
          <div style={{ height: 200 }}>
            {(daily.data ?? []).length > 0 && <DailyChart data={daily.data ?? []} height={200} line={line} />}
          </div>
          <div className="legend" style={{ padding: "6px 0 0" }}>
            <span><i style={{ background: "var(--chart-spend)" }} />Gasto</span>
            <span><i style={{ background: "var(--chart-conv)" }} />{RESULT_LABEL[c.kind].name}</span>
          </div>
        </section>
      </aside>
    </div>
  );
}
