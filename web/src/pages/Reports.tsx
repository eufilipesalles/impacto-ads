import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { getClientCampaigns, getClients, getPeriod, getReports, saveReport, type SavedReport } from "../lib/api";
import { useAsync } from "../lib/hooks";
import { PRESETS, presetRange, brToday, daysBetween, brDate, type PeriodResult, type PresetId } from "../lib/period";
import { DEFAULTS, METRICS, buildMessage } from "../lib/report";
import { clearDraft, loadDraft, saveDraft } from "../lib/draft";
import { timeAgo } from "../lib/format";

const STATUS: Record<string, string> = { ACTIVE: "ativa", PAUSED: "pausada", CAMPAIGN_PAUSED: "pausada", WITH_ISSUES: "com problema", IN_PROCESS: "em análise" };

export function ReportsPage() {
  const [params] = useSearchParams();
  const urlClient = params.get("cliente") ?? "";
  // Recupera o relatório em andamento (o da URL tem prioridade se for de outro cliente)
  const draft = useRef(loadDraft()).current;
  const d = draft && (!urlClient || draft.clientId === urlClient) ? draft : null;
  const first = presetRange("last7");

  const clients = useAsync(getClients, []);
  const [clientId, setClientId] = useState(d?.clientId ?? urlClient);
  const [preset, setPreset] = useState<PresetId>(d?.preset ?? "last7");
  const [since, setSince] = useState(d?.since ?? first.since);
  const [until, setUntil] = useState(d?.until ?? first.until);
  const [campaignIds, setCampaignIds] = useState<string[]>(d?.campaignIds ?? []);
  const [metrics, setMetrics] = useState<string[]>(d?.metrics ?? DEFAULTS.a_definir);
  const [compare, setCompare] = useState(d?.compare ?? true);
  const [emojis, setEmojis] = useState(d?.emojis ?? true);
  const [showCampaigns, setShowCampaigns] = useState(d?.showCampaigns ?? true);
  const [title, setTitle] = useState(d?.title ?? "Relatório semanal");
  const [note, setNote] = useState(d?.note ?? "");
  const [data, setData] = useState<PeriodResult | null>(d?.data ?? null);
  const [base, setBase] = useState(d?.base ?? "");
  const [text, setText] = useState(d?.text ?? "");
  const [reportId, setReportId] = useState<string | null>(d?.reportId ?? null);
  const [needDefaults, setNeedDefaults] = useState(!d && !!urlClient);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [showPaused, setShowPaused] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const active = (clients.data ?? []).filter((c) => c.active);
  const client = active.find((c) => c.id === clientId);
  const campaigns = useAsync(() => (clientId ? getClientCampaigns(clientId) : Promise.resolve([])), [clientId]);
  const history = useAsync(() => getReports(clientId || undefined), [clientId]);

  // Cliente vindo da página do cliente: aplica as métricas do objetivo dele assim que a lista carrega
  useEffect(() => {
    if (needDefaults && client) { setMetrics(DEFAULTS[client.objective]); setNeedDefaults(false); }
  }, [needDefaults, client]);

  function pickClient(id: string) {
    setClientId(id);
    const c = active.find((x) => x.id === id);
    if (c) setMetrics(DEFAULTS[c.objective]);
    setCampaignIds([]);
    resetResult();
  }

  function resetResult() { setData(null); setReportId(null); setSavedMsg(null); }

  function pickPreset(id: PresetId) {
    setPreset(id);
    if (id !== "custom") { const r = presetRange(id); setSince(r.since); setUntil(r.until); }
    if (id === "lastweek" || id === "last7") setTitle("Relatório semanal");
    if (id === "thismonth" || id === "lastmonth") setTitle("Relatório mensal");
    resetResult();
  }

  const today = brToday();
  const invalid = !since || !until || since > until ? "A data inicial precisa ser antes da final."
    : until > today ? "A data final não pode ser depois de hoje."
    : daysBetween(since, until) > 400 ? "Escolha um período de até 400 dias." : null;

  async function generate() {
    if (!clientId || invalid) return;
    setLoading(true); setError(null); setCopied(false); setSavedMsg(null);
    try { setData(await getPeriod(clientId, since, until, compare, campaignIds)); setReportId(null); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); setData(null); }
    finally { setLoading(false); }
  }

  const campaignNames = (data?.campaigns ?? []).map((c) => c.name ?? c.id);
  const message = useMemo(() => {
    if (!data?.totals || !client) return "";
    return buildMessage({
      clientName: client.name, title, since: data.since, until: data.until, metrics,
      campaignNames: showCampaigns ? campaignNames : [],
      totals: data.totals, previous: compare ? data.previous_totals : null, emojis, note,
    });
  }, [data, client, title, metrics, compare, emojis, note, showCampaigns]); // eslint-disable-line react-hooks/exhaustive-deps

  // Opções mudaram → refaz o texto. Mesmas opções (ex.: voltando para a página) → mantém as edições manuais.
  // Ao reabrir do histórico, mostra exatamente o texto que foi enviado.
  const pendingText = useRef<string | null>(null);
  useEffect(() => {
    if (!message) return;
    if (pendingText.current !== null) { setText(pendingText.current); setBase(message); pendingText.current = null; return; }
    if (message !== base) { setText(message); setBase(message); setCopied(false); }
  }, [message, base]);

  // Guarda tudo no navegador a cada mudança
  useEffect(() => {
    saveDraft({ clientId, preset, since, until, campaignIds, metrics, compare, emojis, showCampaigns, title, note, data, base, text, reportId });
  }, [clientId, preset, since, until, campaignIds, metrics, compare, emojis, showCampaigns, title, note, data, base, text, reportId]);

  async function record(): Promise<void> {
    if (!data?.totals || !client) return;
    try {
      const id = await saveReport({
        client_id: client.id, since: data.since, until: data.until,
        campaign_ids: (data.campaigns ?? []).map((c) => c.id), campaign_names: campaignNames,
        metrics, title, message: text, totals: data.totals, previous_totals: compare ? data.previous_totals : null,
        options: { compare, emojis, note }, fetched_at: data.fetched_at,
      }, reportId);
      setReportId(id);
      setSavedMsg("Salvo no histórico");
      history.reload();
    } catch (e) {
      setSavedMsg(`Não foi possível salvar no histórico: ${e instanceof Error ? e.message : e}`);
    }
  }

  async function copy() {
    try { await navigator.clipboard.writeText(text); setCopied(true); } catch { setCopied(false); }
    record();
  }

  function startNew() {
    clearDraft();
    setText(""); setBase(""); setNote(""); setCampaignIds([]); resetResult(); setError(null);
  }

  // Reabre um relatório do histórico com os números da época (sem consultar o Meta de novo)
  function openSaved(r: SavedReport) {
    setClientId(r.client_id);
    setPreset("custom"); setSince(r.since); setUntil(r.until);
    setCampaignIds(r.campaign_ids ?? []); setMetrics(r.metrics); setTitle(r.title);
    setCompare(!!r.options?.compare); setEmojis(r.options?.emojis ?? true); setNote(r.options?.note ?? "");
    const restored: PeriodResult = {
      since: r.since, until: r.until, days: daysBetween(r.since, r.until), previous_range: null, fetched_at: r.fetched_at,
      multiple_accounts: false, campaigns: (r.campaign_ids ?? []).map((id, i) => ({ id, name: r.campaign_names?.[i] ?? id })),
      totals: r.totals, previous_totals: r.previous_totals,
      panel: { spend: 0, impressions: 0, clicks: 0, link_clicks: 0, conversations: 0, leads: 0, video_views: 0, days: 0 },
      accounts: [],
    };
    pendingText.current = r.message;
    setData(restored); setReportId(r.id); setSavedMsg(null); setCopied(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const toggle = (id: string) =>
    setMetrics((m) => (m.includes(id) ? m.filter((x) => x !== id) : METRICS.map((x) => x.id).filter((x) => x === id || m.includes(x))));

  const toggleCampaign = (id: string) => {
    setCampaignIds((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
    resetResult();
  };

  const allCampaigns = campaigns.data ?? [];
  const visibleCampaigns = allCampaigns.filter((c) => showPaused || c.effective_status === "ACTIVE" || campaignIds.includes(c.id));
  const hiddenCount = allCampaigns.length - visibleCampaigns.length;
  const partialToday = until === today;
  const failed = data?.accounts.filter((a) => a.error) ?? [];
  const clientName = (id: string) => (clients.data ?? []).find((c) => c.id === id)?.name ?? "Cliente";

  return (
    <>
      <header className="page-head">
        <div>
          <p className="eyebrow"><span className="eyebrow-dot" />Mensagem para o grupo do cliente</p>
          <h1>Relatórios</h1>
          <p className="sub">Os números são consultados no Meta na hora de gerar, com a mesma atribuição do Gerenciador de Anúncios. O que você preencher fica salvo neste navegador.</p>
        </div>
        {(data || clientId) && <button className="btn" onClick={startNew}>Começar outro relatório</button>}
      </header>

      <div className="report-grid">
        <section className="card report-form">
          <div className="field">
            <label htmlFor="r-client">Cliente</label>
            <select id="r-client" className="select" value={clientId} onChange={(e) => pickClient(e.target.value)}>
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
                onChange={(e) => { setSince(e.target.value); setPreset("custom"); resetResult(); }} />
              <span className="muted">até</span>
              <input type="date" className="input" aria-label="Data final" value={until} max={today}
                onChange={(e) => { setUntil(e.target.value); setPreset("custom"); resetResult(); }} />
            </div>
            {invalid ? <span className="err-text">{invalid}</span>
              : <span className="help">{daysBetween(since, until)} dias · {brDate(since, true)} a {brDate(until, true)}
                  {partialToday && " · inclui hoje, que ainda está em andamento"}</span>}
          </div>

          {clientId && (
            <div className="field">
              <span className="field-label">Campanhas</span>
              <div className="chips">
                <button type="button" className={`chip ${campaignIds.length === 0 ? "on" : ""}`}
                  onClick={() => { setCampaignIds([]); resetResult(); }}>Todas as campanhas</button>
                {campaignIds.length > 0 && <span className="chip on">{campaignIds.length === 1 ? "1 campanha" : `${campaignIds.length} campanhas`}</span>}
              </div>
              <div className="camp-list">
                {campaigns.loading && <span className="help">Carregando campanhas…</span>}
                {!campaigns.loading && allCampaigns.length === 0 && <span className="help">Nenhuma campanha encontrada nesta conta.</span>}
                {visibleCampaigns.map((c) => (
                  <label key={c.id} className={`metric ${campaignIds.includes(c.id) ? "on" : ""}`}>
                    <input type="checkbox" checked={campaignIds.includes(c.id)} onChange={() => toggleCampaign(c.id)} />
                    <span className="camp-label">{c.name ?? c.id}</span>
                    <span className={`camp-status ${c.effective_status === "ACTIVE" ? "on" : ""}`}>{STATUS[c.effective_status ?? ""] ?? (c.effective_status ?? "").toLowerCase()}</span>
                  </label>
                ))}
              </div>
              {(hiddenCount > 0 || showPaused) && (
                <button type="button" className="link-btn" onClick={() => setShowPaused((v) => !v)}>
                  {showPaused ? "Mostrar só as ativas" : `Mostrar também as pausadas (${hiddenCount})`}
                </button>
              )}
            </div>
          )}

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
            <label className="switch"><input type="checkbox" checked={compare} onChange={(e) => { setCompare(e.target.checked); resetResult(); }} />Comparar com o período anterior</label>
            <label className="switch"><input type="checkbox" checked={emojis} onChange={(e) => setEmojis(e.target.checked)} />Usar emojis</label>
            {campaignIds.length > 0 && (
              <label className="switch"><input type="checkbox" checked={showCampaigns} onChange={(e) => setShowCampaigns(e.target.checked)} />Mostrar o nome da campanha na mensagem</label>
            )}
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
                <span className="help">Números do Meta de {new Date(data.fetched_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
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
                <a className="btn" href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer" onClick={() => record()}>Abrir no WhatsApp</a>
                {savedMsg && <span className={savedMsg.startsWith("Salvo") ? "saved" : "err-text"}>{savedMsg}</span>}
              </div>
              <p className="help">Ao copiar ou abrir no WhatsApp, o relatório vai para o histórico. Se você mudar as opções, o texto é refeito.</p>
            </>
          )}
        </section>
      </div>

      <section className="section">
        <div className="section-head">
          <h2>Histórico{client ? ` · ${client.name}` : ""}</h2>
          <span className="hint">{client ? "relatórios deste cliente" : "últimos relatórios de todos os clientes"}</span>
        </div>
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>Relatório</th>
                <th style={{ textAlign: "left" }}>Período</th>
                <th style={{ textAlign: "left" }} className="hide-sm">Campanhas</th>
                <th style={{ textAlign: "left" }} className="hide-sm">Enviado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(history.data ?? []).map((r) => (
                <tr key={r.id} className={r.id === reportId ? "row-current" : ""}>
                  <td>
                    <div className="client-name">{r.title}</div>
                    <div className="client-obj">{clientName(r.client_id)}</div>
                  </td>
                  <td style={{ textAlign: "left" }} className="num">{brDate(r.since)} a {brDate(r.until, true)}</td>
                  <td style={{ textAlign: "left" }} className="hide-sm">{r.campaign_names?.length ? r.campaign_names.join(", ") : <span className="muted">Todas</span>}</td>
                  <td style={{ textAlign: "left" }} className="hide-sm muted">{timeAgo(r.updated_at)}{r.created_by ? ` · ${r.created_by.split("@")[0]}` : ""}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button className="btn small" onClick={() => openSaved(r)}>Abrir</button>{" "}
                    <button className="btn small" onClick={() => navigator.clipboard.writeText(r.message).then(() => setCopiedId(r.id)).catch(() => setCopiedId(null))}>
                      {copiedId === r.id ? "Copiado" : "Copiar"}
                    </button>
                  </td>
                </tr>
              ))}
              {!history.loading && (history.data ?? []).length === 0 && (
                <tr><td colSpan={5} className="empty">Nenhum relatório no histórico ainda. Eles aparecem aqui quando você copia ou abre no WhatsApp.</td></tr>
              )}
              {history.error && <tr><td colSpan={5} className="empty err-text">{history.error}</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
