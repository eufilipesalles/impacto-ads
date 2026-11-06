// Relatórios: semanais escritos (prontos para o grupo do WhatsApp), mensais em slides e o montador manual
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { getClients } from "../lib/api";
import { useAsync } from "../lib/hooks";
import { money, timeAgo } from "../lib/format";
import { generateReports, getAutoReports, markSent, type AutoReport } from "../lib/manager";
import { buildMonthlyDeck } from "../lib/monthlyDeck";
import { ReportsPage } from "./Reports";

const MON = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const dm = (iso: string) => `${Number(iso.slice(8))}/${MON[Number(iso.slice(5, 7)) - 1]}`;

export function ReportsHub() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get("aba") ?? (params.get("cliente") ? "montar" : "semanal")) as "semanal" | "mensal" | "montar";
  const setTab = (t: string) => { const p = new URLSearchParams(params); p.set("aba", t); setParams(p, { replace: true }); };
  return (
    <>
      <div className="tabs hub-tabs" role="tablist">
        <button role="tab" aria-selected={tab === "semanal"} className={tab === "semanal" ? "on" : ""} onClick={() => setTab("semanal")}>Semanais · WhatsApp</button>
        <button role="tab" aria-selected={tab === "mensal"} className={tab === "mensal" ? "on" : ""} onClick={() => setTab("mensal")}>Mensais · slides</button>
        <button role="tab" aria-selected={tab === "montar"} className={tab === "montar" ? "on" : ""} onClick={() => setTab("montar")}>Montar relatório</button>
      </div>
      {tab === "montar" ? <ReportsPage /> : <AutoReports kind={tab === "mensal" ? "monthly" : "weekly"} />}
    </>
  );
}

function AutoReports({ kind }: { kind: "weekly" | "monthly" }) {
  const clients = useAsync(getClients, []);
  const [key, setKey] = useState(0);
  const list = useAsync(() => getAutoReports(kind), [kind, key]);
  const [period, setPeriod] = useState<string>("");
  const [pendingOnly, setPendingOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 4000); };
  const name = (id: string) => clients.data?.find((c) => c.id === id)?.name ?? "Cliente";

  const periods = useMemo(() => [...new Set((list.data ?? []).map((r) => `${r.since}|${r.until}`))], [list.data]);
  const cur = period || periods[0] || "";
  const rows = (list.data ?? []).filter((r) => `${r.since}|${r.until}` === cur && (!pendingOnly || !r.sent_at))
    .sort((a, b) => b.internal.filter((x) => x.level === "alto").length - a.internal.filter((x) => x.level === "alto").length || name(a.client_id).localeCompare(name(b.client_id)));
  const all = (list.data ?? []).filter((r) => `${r.since}|${r.until}` === cur);
  const sent = all.filter((r) => r.sent_at).length;

  async function regenerate() {
    setBusy(true);
    try { await generateReports(kind); setKey((k) => k + 1); flash("Relatórios gerados de novo com os números atualizados."); }
    catch (e) { flash(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  return (
    <>
      <header className="page-head">
        <div>
          <p className="eyebrow"><span className="eyebrow-dot" />Relatórios automáticos</p>
          <h1>{kind === "weekly" ? "Relatórios da semana" : "Relatórios do mês"}</h1>
          <p className="sub">
            {kind === "weekly"
              ? "Gerados toda segunda às 8h20 para todos os clientes com investimento. Revise, copie e cole no grupo do cliente."
              : "Gerados todo dia 1º às 8h40 com o mês anterior. Baixe os slides prontos para enviar ao cliente."}
          </p>
        </div>
        <div className="head-actions">
          {periods.length > 0 && (
            <select className="select" value={cur} onChange={(e) => setPeriod(e.target.value)} aria-label="Período">
              {periods.map((p) => { const [s, u] = p.split("|"); return <option key={p} value={p}>{kind === "monthly" ? `${MONTHS[Number(u.slice(5, 7)) - 1]} ${u.slice(0, 4)}` : `${dm(s)} a ${dm(u)}`}</option>; })}
            </select>
          )}
          <button className="btn" onClick={regenerate} disabled={busy}>{busy ? "Gerando… (até 1 min)" : "Gerar de novo"}</button>
        </div>
      </header>

      {all.length > 0 && (
        <div className="rep-bar">
          <span><b>{sent}</b> de <b>{all.length}</b> enviados</span>
          <span className="gauge wide"><i style={{ width: `${all.length ? (sent / all.length) * 100 : 0}%` }} /></span>
          <label className="switch"><input type="checkbox" checked={pendingOnly} onChange={(e) => setPendingOnly(e.target.checked)} /> Só os que faltam enviar</label>
        </div>
      )}

      {list.loading && <div className="card empty">Carregando…</div>}
      {list.error && <div className="card empty err-text">{list.error}</div>}
      {!list.loading && !all.length && <div className="card empty">Nenhum relatório ainda. Clique em "Gerar de novo" para criar agora.</div>}

      <div className="rep-list">
        {rows.map((r) => kind === "weekly"
          ? <WeeklyCard key={r.id} r={r} client={name(r.client_id)} onChange={() => setKey((k) => k + 1)} flash={flash} />
          : <MonthlyCard key={r.id} r={r} client={name(r.client_id)} onChange={() => setKey((k) => k + 1)} flash={flash} />)}
      </div>
      {toast && <div className="toast" role="status">{toast}</div>}
    </>
  );
}

function Internal({ r }: { r: AutoReport }) {
  if (!r.internal.length) return null;
  return (
    <div className="rep-internal">
      <p className="field-label">Só para a equipe · o que precisa de atenção</p>
      <ul>{r.internal.map((n, i) => <li key={i} className={`lv-${n.level}`}><b>{n.level === "alto" ? "Crítico" : n.level === "medio" ? "Atenção" : "Lembrete"}</b> {n.text}</li>)}</ul>
    </div>
  );
}

function SentButton({ r, onChange, text }: { r: AutoReport; onChange: () => void; text?: string }) {
  return (
    <button className={`btn small ${r.sent_at ? "" : "ghost-ok"}`} onClick={async () => { await markSent(r.id, !r.sent_at, text); onChange(); }}>
      {r.sent_at ? `✓ Enviado ${timeAgo(r.sent_at)}` : "Marcar como enviado"}
    </button>
  );
}

function WeeklyCard({ r, client, onChange, flash }: { r: AutoReport; client: string; onChange: () => void; flash: (m: string) => void }) {
  const [text, setText] = useState(r.text ?? "");
  const critical = r.internal.filter((x) => x.level === "alto").length;
  async function copy() {
    await navigator.clipboard.writeText(text);
    flash(`Texto de ${client} copiado. Cole no grupo do WhatsApp.`);
  }
  return (
    <article className={`card rep-card ${r.sent_at ? "sent" : ""}`}>
      <div className="rep-head">
        <div><h3>{client}</h3><span className="muted">{dm(r.since)} a {dm(r.until)}{critical ? <span className="crit-badge">{critical} crítico(s)</span> : null}</span></div>
        <SentButton r={r} onChange={onChange} text={text !== r.text ? text : undefined} />
      </div>
      <div className="rep-body">
        <div className="rep-text">
          <textarea className="input wa" value={text} onChange={(e) => setText(e.target.value)} rows={Math.min(22, text.split("\n").length + 1)} aria-label={`Relatório de ${client}`} />
          <div className="rep-btns">
            <button className="btn small primary" onClick={copy}>Copiar texto</button>
            <a className="btn small" href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer">Abrir no WhatsApp ↗</a>
          </div>
        </div>
        <Internal r={r} />
      </div>
    </article>
  );
}

function MonthlyCard({ r, client, onChange, flash }: { r: AutoReport; client: string; onChange: () => void; flash: (m: string) => void }) {
  const [busy, setBusy] = useState(false);
  const s = (r.data as { summary?: { spend: number; result: number; cpr: number | null; reach: number | null } }).summary;
  const kind = (r.data as { kind?: string }).kind;
  const word = kind === "purchase" ? "vendas" : kind === "lead" ? "leads" : kind === "conversation" ? "conversas" : "cliques";
  async function download() {
    setBusy(true);
    try { await buildMonthlyDeck(r, client); }
    catch (e) { flash(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  return (
    <article className={`card rep-card ${r.sent_at ? "sent" : ""}`}>
      <div className="rep-head">
        <div><h3>{client}</h3><span className="muted">{MONTHS[Number(r.until.slice(5, 7)) - 1]} de {r.until.slice(0, 4)}</span></div>
        <div className="rep-btns">
          <button className="btn small primary" onClick={download} disabled={busy}>{busy ? "Montando…" : "Baixar slides (.pptx)"}</button>
          <SentButton r={r} onChange={onChange} />
        </div>
      </div>
      {s && (
        <div className="rep-kpis">
          <div><span className="field-label">{word}</span><b>{Math.round(s.result).toLocaleString("pt-BR")}</b></div>
          <div><span className="field-label">custo por resultado</span><b>{money(s.cpr)}</b></div>
          <div><span className="field-label">investido</span><b>{money(s.spend)}</b></div>
          <div><span className="field-label">alcance</span><b>{s.reach ? Math.round(s.reach).toLocaleString("pt-BR") : "—"}</b></div>
        </div>
      )}
      <Internal r={r} />
    </article>
  );
}
