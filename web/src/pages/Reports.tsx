import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { getClients, getPeriod } from "../lib/api";
import { useAsync } from "../lib/hooks";
import { PRESETS, presetRange, brToday, daysBetween, brDate, type PeriodResult, type PresetId } from "../lib/period";
import { DEFAULTS, METRICS, buildMessage } from "../lib/report";
import { timeAgo } from "../lib/format";

export function ReportsPage() {
  const [params] = useSearchParams();
  const clients = useAsync(getClients, []);
  const [clientId, setClientId] = useState(params.get("cliente") ?? "");
  const [preset, setPreset] = useState<PresetId>("last7");
  const initial = presetRange("last7");
  const [since, setSince] = useState(initial.since);
  const [until, setUntil] = useState(initial.until);
  const [metrics, setMetrics] = useState<string[]>(DEFAULTS.a_definir);
  const [compare, setCompare] = useState(true);
  const [emojis, setEmojis] = useState(true);
  const [title, setTitle] = useState("Relatório semanal");
  const [note, setNote] = useState("");
  const [data, setData] = useState<PeriodResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [copied, setCopied] = useState(false);

  const active = (clients.data ?? []).filter((c) => c.active);
  const client = active.find((c) => c.id === clientId);

  // Ao escolher o cliente, marca as métricas que fazem sentido para o objetivo dele
  useEffect(() => {
    if (client) setMetrics(DEFAULTS[client.objective]);
    setData(null);
  }, [clientId, client?.objective]); // eslint-disable-line react-hooks/exhaustive-deps

  function pickPreset(id: PresetId) {
    setPreset(id);
    if (id !== "custom") { const r = presetRange(id); setSince(r.since); setUntil(r.until); }
    if (id === "lastweek" || id === "last7") setTitle("Relatório semanal");
    if (id === "thismonth" || id === "lastmonth") setTitle("Relatório mensal");
    setData(null);
  }

  const today = brToday();
  const invalid = !since || !until || since > until ? "A data inicial precisa ser antes da final."
    : until > today ? "A data final não pode ser depois de hoje."
    : daysBetween(since, until) > 400 ? "Escolha um período de até 400 dias." : null;

  async function generate() {
    if (!clientId || invalid) return;
    setLoading(true); setError(null); setCopied(false);
    try { setData(await getPeriod(clientId, since, until, compare)); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); setData(null); }
    finally { setLoading(false); }
  }

  const message = useMemo(() => {
    if (!data?.totals || !client) return "";
    return buildMessage({
      clientName: client.name, title, since: data.since, until: data.until, metrics,
      totals: data.totals, previous: compare ? data.previous_totals : null, emojis, note,
    });
  }, [data, client, title, metrics, compare, emojis, note]);

  useEffect(() => { setText(message); setCopied(false); }, [message]);

  async function copy() {
    try { await navigator.clipboard.writeText(text); setCopied(true); }
    catch { setCopied(false); }
  }

  const toggle = (id: string) =>
    setMetrics((m) => (m.includes(id) ? m.filter((x) => x !== id) : METRICS.map((x) => x.id).filter((x) => x === id || m.includes(x))));

  const partialToday = until === today;
  const failed = data?.accounts.filter((a) => a.error) ?? [];

  return (
    <>
      <header className="page-head">
        <div>
          <p className="eyebrow"><span className="eyebrow-dot" />Mensagem para o grupo do cliente</p>
          <h1>Relatórios</h1>
          <p className="sub">Os números são consultados no Meta na hora de gerar, com a mesma atribuição do Gerenciador de Anúncios.</p>
        </div>
      </header>

      <div className="report-grid">
        <section className="card report-form">
          <div className="field">
            <label htmlFor="r-client">Cliente</label>
            <select id="r-client" className="select" value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">Escolha o cliente</option>
              {active.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          <div className="field">
            <span className="field-label">Período</span>
            <div className="chips">
              {PRESETS.map((p) => (
                <button key={p.id} type="button" className={`chip ${preset === p.id ? "on" : ""}`} onClick={() => pickPreset(p.id)}>{p.label}</button>
              ))}
            </div>
            <div className="dates">
              <input type="date" className="input" aria-label="Data inicial" value={since} max={today}
                onChange={(e) => { setSince(e.target.value); setPreset("custom"); setData(null); }} />
              <span className="muted">até</span>
              <input type="date" className="input" aria-label="Data final" value={until} max={today}
                onChange={(e) => { setUntil(e.target.value); setPreset("custom"); setData(null); }} />
            </div>
            {invalid ? <span className="err-text">{invalid}</span>
              : <span className="help">{daysBetween(since, until)} dias · {brDate(since, true)} a {brDate(until, true)}
                  {partialToday && " · inclui hoje, que ainda está em andamento"}</span>}
          </div>

          <div className="field">
            <span className="field-label">Métricas do relatório</span>
            <div className="metric-list">
              {METRICS.map((m) => (
                <label key={m.id} className={`metric ${metrics.includes(m.id) ? "on" : ""}`}>
                  <input type="checkbox" checked={metrics.includes(m.id)} onChange={() => toggle(m.id)} />
                  <span>{m.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="field">
            <label htmlFor="r-title">Título</label>
            <input id="r-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>

          <div className="field">
            <label htmlFor="r-note">Observação no fim <span className="opt">opcional</span></label>
            <textarea id="r-note" className="input" rows={3} value={note} onChange={(e) => setNote(e.target.value)}
              placeholder="Ex.: Nesta semana testamos um criativo novo de vídeo, que já é o de menor custo por conversa." />
          </div>

          <div className="toggles">
            <label className="switch"><input type="checkbox" checked={compare} onChange={(e) => { setCompare(e.target.checked); setData(null); }} />Comparar com o período anterior</label>
            <label className="switch"><input type="checkbox" checked={emojis} onChange={(e) => setEmojis(e.target.checked)} />Usar emojis</label>
          </div>

          <button className="btn primary wide" onClick={generate} disabled={!clientId || !!invalid || loading || metrics.length === 0}>
            {loading ? "Consultando o Meta…" : data ? "Atualizar números" : "Gerar relatório"}
          </button>
          {!clientId && <span className="help">Escolha o cliente para gerar.</span>}
        </section>

        <section className="card report-preview">
          {error && <div className="form-error" role="alert">{error}</div>}
          {!data && !error && (
            <div className="empty">
              {loading ? "Buscando os números no Meta…" : "A mensagem aparece aqui depois de gerar."}
            </div>
          )}
          {data && (
            <>
              <div className="preview-head">
                <h2>Mensagem</h2>
                <span className="help">Dados do Meta consultados {timeAgo(data.fetched_at)}</span>
              </div>
              {failed.length > 0 && (
                <p className="err-text">Não foi possível ler {failed.length === 1 ? "uma conta" : `${failed.length} contas`} deste cliente: o relatório está incompleto. {failed[0].error}</p>
              )}
              {data.multiple_accounts && metrics.some((m) => m === "reach" || m === "frequency") && (
                <p className="help">Este cliente tem mais de uma conta: o alcance é a soma das contas e pode contar a mesma pessoa duas vezes.</p>
              )}
              <textarea className="input message" value={text} onChange={(e) => setText(e.target.value)} rows={16} aria-label="Texto do relatório" />
              <div className="preview-actions">
                <button className="btn primary" onClick={copy}>{copied ? "Copiado" : "Copiar mensagem"}</button>
                <a className="btn" href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer">Abrir no WhatsApp</a>
              </div>
              <p className="help">“Abrir no WhatsApp” abre a mensagem pronta; escolha o grupo do cliente para enviar. Se você mudar as opções, o texto é refeito.</p>
            </>
          )}
        </section>
      </div>
    </>
  );
}

