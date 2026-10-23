import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { getClients, getCreatives } from "../lib/api";
import { useAsync } from "../lib/hooks";
import { scoreCreatives, FORMAT_LABEL, MIN_IMPRESSIONS, type ScoredCreative, type Verdict } from "../lib/creative";
import { CreativeCard, CreativeDrawer, pct1, pct2 } from "../components/Creatives";
import { count, money } from "../lib/format";

const PERIODS = [7, 14, 30, 90];
type Filter = "todos" | Verdict | "saturando";
const FILTERS: { id: Filter; label: string }[] = [
  { id: "todos", label: "Todos" },
  { id: "campeao", label: "Modelar" },
  { id: "bom", label: "Bons" },
  { id: "saturando", label: "Saturando" },
  { id: "fraco", label: "Fracos" },
  { id: "teste", label: "Em teste" },
];
type Sort = "score" | "spend" | "hook" | "ctr";

function avg(list: ScoredCreative[], f: (c: ScoredCreative) => number | null) {
  const v = list.map(f).filter((x): x is number => x !== null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

export function CreativesPage() {
  const [params, setParams] = useSearchParams();
  const client = params.get("cliente") ?? "";
  const days = Number(params.get("dias")) || 30;
  const [format, setFormat] = useState("todos");
  const [onlyActive, setOnlyActive] = useState(false);
  const [filter, setFilter] = useState<Filter>("todos");
  const [sort, setSort] = useState<Sort>("score");
  const [open, setOpen] = useState<string | null>(null);

  const clients = useAsync(getClients, []);
  const data = useAsync(() => getCreatives(client || null, days), [client, days]);

  const set = (k: string, v: string) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v); else p.delete(k);
    setParams(p, { replace: true });
  };

  // A nota é calculada sobre todos os criativos do cliente no período; os filtros só escondem cartões
  const scored = useMemo(() => scoreCreatives(data.data ?? []), [data.data]);
  const formats = [...new Set(scored.map((c) => c.format ?? "outro"))];

  const shown = scored
    .filter((c) => format === "todos" || (c.format ?? "outro") === format)
    .filter((c) => !onlyActive || c.effective_status === "ACTIVE")
    .filter((c) => filter === "todos" || (filter === "saturando" ? c.fatigue : c.verdict === filter))
    .sort((a, b) => {
      const tst = (c: ScoredCreative) => (c.verdict === "teste" ? 1 : 0);
      switch (sort) {
        case "spend": return b.spend - a.spend;
        case "hook": return (b.hookRate ?? -1) - (a.hookRate ?? -1);
        case "ctr": return (b.ctr ?? -1) - (a.ctr ?? -1);
        default: return tst(a) - tst(b) || b.score - a.score || b.spend - a.spend;
      }
    });

  const rated = scored.filter((c) => c.verdict !== "teste");
  const counts = {
    campeao: scored.filter((c) => c.verdict === "campeao").length,
    saturando: scored.filter((c) => c.fatigue).length,
    fraco: scored.filter((c) => c.verdict === "fraco").length,
  };
  const videos = rated.filter((c) => c.isVideo);
  const spendBy = (v: Verdict) => scored.filter((c) => c.verdict === v).reduce((t, c) => t + c.spend, 0);
  const totalSpend = scored.reduce((t, c) => t + c.spend, 0);

  // Padrões por formato: o que tende a funcionar melhor
  const byFormat = formats.map((f) => {
    const list = rated.filter((c) => (c.format ?? "outro") === f);
    return {
      f, n: list.length, score: avg(list, (c) => c.score), hook: avg(list, (c) => c.hookRate), hold: avg(list, (c) => c.holdRate),
      ctr: avg(list, (c) => c.ctr), champions: list.filter((c) => c.verdict === "campeao").length,
    };
  }).filter((x) => x.n > 0).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  const current = scored.find((c) => c.ad_id === open) ?? null;
  const clientName = clients.data?.find((c) => c.id === client)?.name;

  return (
    <>
      <header className="page-head">
        <div>
          <p className="eyebrow"><span className="eyebrow-dot" />Análise de criativos</p>
          <h1>{clientName ? `Criativos · ${clientName}` : "Criativos"}</h1>
          <p className="sub">Quais anúncios estão performando, por quê, e o que o time de copy deve modelar.</p>
        </div>
        <div className="head-actions">
          <select className="select" value={client} onChange={(e) => set("cliente", e.target.value)} aria-label="Cliente">
            <option value="">Todos os clientes</option>
            {(clients.data ?? []).filter((c) => c.active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <div className="seg" role="group" aria-label="Período">
            {PERIODS.map((p) => (
              <button key={p} className={p === days ? "on" : ""} aria-pressed={p === days} onClick={() => set("dias", p === 30 ? "" : String(p))}>{p}d</button>
            ))}
          </div>
        </div>
      </header>

      {data.error && <div className="card empty err-text">{data.error}</div>}
      {data.loading && <div className="loading">Analisando criativos…</div>}

      {!data.loading && !data.error && (
        <>
          <section className="card">
            <div className="kpis cr-kpis">
              <div className="stat"><div className="stat-label">Criativos analisados</div><div className="stat-value">{count(scored.length)}</div>
                <div className="stat-note">{count(scored.length - rated.length)} ainda em teste</div></div>
              <div className="stat"><div className="stat-label">Para modelar</div><div className="stat-value good">{count(counts.campeao)}</div>
                <div className="stat-note">{totalSpend ? `${Math.round((spendBy("campeao") / totalSpend) * 100)}% da verba` : "—"}</div></div>
              <div className="stat"><div className="stat-label">Saturando</div><div className="stat-value warnc">{count(counts.saturando)}</div>
                <div className="stat-note">precisam de variações</div></div>
              <div className="stat"><div className="stat-label">Fracos</div><div className="stat-value bad">{count(counts.fraco)}</div>
                <div className="stat-note">{totalSpend ? `${money(spendBy("fraco"))} investidos` : "—"}</div></div>
              <div className="stat"><div className="stat-label">Gancho médio (vídeo)</div><div className="stat-value">{pct1(avg(videos, (c) => c.hookRate))}</div>
                <div className="stat-note">retenção {pct1(avg(videos, (c) => c.holdRate))}</div></div>
            </div>
          </section>

          {byFormat.length > 1 && (
            <section className="section">
              <div className="section-head"><h2>O que está funcionando</h2><span className="hint">média por formato, últimos {days} dias</span></div>
              <div className="card table-wrap">
                <table>
                  <thead><tr><th>Formato</th><th>Criativos</th><th>Nota média</th><th>Para modelar</th><th>Gancho</th><th className="hide-sm">Retenção</th><th>CTR</th></tr></thead>
                  <tbody>
                    {byFormat.map((x) => (
                      <tr key={x.f}>
                        <td className="camp-name">{FORMAT_LABEL[x.f] ?? x.f}</td>
                        <td className="num">{x.n}</td>
                        <td className="num"><b>{x.score === null ? "—" : Math.round(x.score)}</b></td>
                        <td className="num">{x.champions}</td>
                        <td className="num">{pct1(x.hook)}</td>
                        <td className="num hide-sm">{pct1(x.hold)}</td>
                        <td className="num">{pct2(x.ctr)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section className="section">
            <div className="cr-toolbar">
              <div className="chips" role="group" aria-label="Filtrar por situação">
                {FILTERS.map((f) => {
                  const n = f.id === "todos" ? scored.length : f.id === "saturando" ? counts.saturando : scored.filter((c) => c.verdict === f.id).length;
                  return (
                    <button key={f.id} className={`chip ${filter === f.id ? "on" : ""}`} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
                      {f.label} <span>{n}</span>
                    </button>
                  );
                })}
              </div>
              <div className="cr-tools">
                {formats.length > 1 && (
                  <select className="select" value={format} onChange={(e) => setFormat(e.target.value)} aria-label="Formato">
                    <option value="todos">Todos os formatos</option>
                    {formats.map((f) => <option key={f} value={f}>{FORMAT_LABEL[f] ?? f}</option>)}
                  </select>
                )}
                <select className="select" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Ordenar">
                  <option value="score">Maior nota</option>
                  <option value="spend">Maior investimento</option>
                  <option value="hook">Melhor gancho</option>
                  <option value="ctr">Maior CTR</option>
                </select>
                <label className="switch"><input type="checkbox" checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)} /> Só ativos</label>
              </div>
            </div>

            {shown.length === 0
              ? <div className="card empty">{scored.length ? "Nenhum criativo com esses filtros." : `Nenhum anúncio com investimento nos últimos ${days} dias.`}</div>
              : <div className="cr-grid">{shown.map((c) => <CreativeCard key={c.ad_id} c={c} showClient={!client} onOpen={() => setOpen(c.ad_id)} />)}</div>}
          </section>

          <details className="card how">
            <summary>Como a nota é calculada</summary>
            <div className="how-body">
              <p>Cada criativo recebe uma nota de 0 a 100 comparando seus indicadores com uma referência. Igual à referência = 50; duas vezes melhor ≈ 85; duas vezes pior ≈ 15.</p>
              <p>O resultado pesa mais: é ele que decide se o criativo é referência. Gancho, retenção e CTR explicam o porquê e mostram o que melhorar.</p>
              <ul>
                <li><b>Resultado (peso 55)</b> — custo por conversa, lead ou venda (ROAS para vendas) comparado com a média do próprio cliente no período, entre criativos com o mesmo objetivo. Campanhas de tráfego são julgadas pelo custo por clique e as de reconhecimento pelo CPM.</li>
                <li><b>Gancho (10)</b> — quem parou para ver 3 segundos ÷ impressões. Mede a força da abertura.</li>
                <li><b>Retenção (10)</b> — ThruPlays (assistiu 15 s ou até o fim) ÷ impressões. Mede se o conteúdo segura.</li>
                <li><b>CTR (10)</b> — cliques no link ÷ impressões. Mede se a chamada convence.</li>
                <li><b>Engajamento (5)</b> — reações, comentários, compartilhamentos e salvamentos por mil impressões.</li>
                <li><b>Qualidade Meta (10)</b> — rankings de qualidade, engajamento e conversão do próprio Meta.</li>
              </ul>
              <p>Gancho, retenção, CTR e engajamento são comparados com a mediana dos criativos do cliente (ou da carteira inteira, quando o cliente tem menos de 3 criativos com volume). Imagens não têm gancho e retenção, e o peso é redistribuído.</p>
              <p>Pouco dado puxa a nota para o meio: um anúncio com uma conversa barata não vira campeão por sorte. Abaixo de {count(MIN_IMPRESSIONS)} impressões o criativo fica <b>Em teste</b>. <b>Saturando</b> = CTR caiu 25% ou mais na última semana, ou frequência acima de 3,5.</p>
              <p>Faixas: <b>Modelar</b> 65+ (ou resultado muito acima da média com nota 55+), <b>Bom</b> 55–64, <b>Mediano</b> 42–54, <b>Fraco</b> abaixo de 42. Um criativo com resultado acima da média nunca é marcado como fraco.</p>
            </div>
          </details>
        </>
      )}

      {current && <CreativeDrawer c={current} days={days} onClose={() => setOpen(null)} />}
    </>
  );
}
