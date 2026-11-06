import { useState } from "react";
import { getClients } from "../lib/api";
import { useAsync } from "../lib/hooks";
import { money, timeAgo } from "../lib/format";
import { OBJECTIVE_LABEL, type ClientRow } from "../lib/types";
import {
  decideAction, getAutopilot, runEvaluate, saveAutopilotSettings, setPausedAll, undoAction,
  type AutopilotAction, type AutopilotSettings,
} from "../lib/autopilot";

const LEVELS = [
  { v: 0, label: "Só sugere", help: "Toda ação espera aprovação." },
  { v: 1, label: "Protege a verba", help: "Pausa e reduz sozinho; aumentos esperam aprovação." },
  { v: 2, label: "Autônomo", help: "Também aumenta orçamento sozinho, sempre dentro do teto do mês." },
] as const;

const STATUS: Record<string, { text: string; cls: string }> = {
  proposed: { text: "Aguardando", cls: "warn" },
  approved: { text: "Aprovada", cls: "" },
  executing: { text: "Executando", cls: "" },
  done: { text: "Executada", cls: "ok" },
  failed: { text: "Falhou", cls: "crit" },
  rejected: { text: "Recusada", cls: "" },
  expired: { text: "Expirou", cls: "" },
  undone: { text: "Desfeita", cls: "" },
};

const RULE_LABEL: Record<string, string> = {
  pause_no_result: "Sem resultado", pause_expensive: "Custo alto", scale_down: "Reduzir verba", scale_up: "Escalar",
  monthly_cap: "Teto do mês", create_ad: "Novo anúncio", launch_campaign: "Nova campanha", manual: "Gerenciador", new_creative: "Criativo novo",
};

function detail(a: AutopilotAction) {
  const r = a.result as { targets?: { name?: string; from: number; to: number }[]; ad_id?: string; campaign_id?: string; active?: boolean } | null;
  if (a.kind === "launch_campaign" && r?.campaign_id) return `campanha ${r.campaign_id} criada ${r.active ? "ativa" : "pausada"}`;
  if (r?.targets?.length) return r.targets.map((t) => `${money(t.from)} → ${money(t.to)}/dia`).join(" · ");
  if (a.kind === "pause" && a.status === "done") return a.object_type === "campaign" ? "campanha pausada" : a.object_type === "adset" ? "conjunto pausado" : "anúncio pausado";
  if (a.kind === "activate" && a.status === "done") return "ativado";
  if (a.kind === "create_ad" && r?.ad_id) return `anúncio ${r.ad_id}`;
  return "";
}

function ActionCard({ a, client, onDone }: { a: AutopilotAction; client?: ClientRow; onDone: (msg: string) => void }) {
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const ev = a.evidence as { orcamento_diario?: number; novo_orcamento?: number } | null;
  async function go(d: "approve" | "reject") {
    setBusy(d); setErr(null);
    try { await decideAction(a.id, d); onDone(d === "approve" ? "Ação executada no Meta." : "Ação recusada."); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  }
  return (
    <article className={`card ap-card ${a.protective ? "prot" : "grow"}`}>
      <div className="ap-top">
        <span className={`ap-rule ${a.protective ? "prot" : "grow"}`}>{RULE_LABEL[a.rule] ?? a.rule}</span>
        <span className="muted">{client?.name ?? "—"} · {timeAgo(a.created_at)}</span>
      </div>
      <h3>{a.title}</h3>
      {a.campaign_name && a.object_type === "ad" && <p className="help">Campanha: {a.campaign_name}</p>}
      <p className="ap-reason">{a.reason}</p>
      {ev?.orcamento_diario && ev.novo_orcamento && (
        <p className="ap-budget num">{money(ev.orcamento_diario)} → <b>{money(ev.novo_orcamento)}</b> por dia</p>
      )}
      {err && <p className="err-text">{err}</p>}
      <div className="ap-btns">
        <button className="btn primary small" disabled={!!busy} onClick={() => go("approve")}>{busy === "approve" ? "Executando…" : "Aprovar e executar"}</button>
        <button className="btn small" disabled={!!busy} onClick={() => go("reject")}>Recusar</button>
      </div>
    </article>
  );
}

function SettingsRow({ c, s, onSaved }: { c: ClientRow; s?: AutopilotSettings; onSaved: () => void }) {
  const [level, setLevel] = useState<0 | 1 | 2>(s?.level ?? 0);
  const [target, setTarget] = useState(s?.target_cost?.toString().replace(".", ",") ?? "");
  const [cap, setCap] = useState(s?.monthly_cap?.toString().replace(".", ",") ?? "");
  const [pctUp, setPctUp] = useState(String(s?.max_increase_pct ?? 20));
  const [state, setState] = useState<"idle" | "saving" | "saved" | string>("idle");
  const parse = (v: string) => (v.trim() ? Number(v.replace(/\./g, "").replace(",", ".")) : null);
  const dirty = level !== (s?.level ?? 0) || parse(target) !== (s?.target_cost ?? null) || parse(cap) !== (s?.monthly_cap ?? null) || Number(pctUp) !== (s?.max_increase_pct ?? 20);

  async function save() {
    const t = parse(target), m = parse(cap), p = Number(pctUp);
    if ((t !== null && !(t > 0)) || (m !== null && !(m > 0))) { setState("Valores inválidos"); return; }
    setState("saving");
    try { await saveAutopilotSettings({ client_id: c.id, level, target_cost: t, monthly_cap: m, max_increase_pct: p }); setState("saved"); onSaved(); }
    catch (e) { setState(e instanceof Error ? e.message : String(e)); }
  }
  return (
    <tr className="cfg-row">
      <td><div className="client-name">{c.name}</div><div className="client-obj">{OBJECTIVE_LABEL[c.objective]}</div></td>
      <td>
        <div className="seg ap-seg" role="group" aria-label={`Autonomia de ${c.name}`}>
          {LEVELS.map((l) => <button key={l.v} className={level === l.v ? "on" : ""} aria-pressed={level === l.v} title={l.help} onClick={() => setLevel(l.v)}>{l.label}</button>)}
        </div>
      </td>
      <td><input className="input money" inputMode="decimal" placeholder="média" value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Meta de custo por resultado" /></td>
      <td><input className="input money" inputMode="decimal" placeholder={c.monthly_budget ? `verba: ${c.monthly_budget}` : "sem teto"} value={cap} onChange={(e) => setCap(e.target.value)} aria-label="Teto mensal" /></td>
      <td>
        <select className="select" value={pctUp} onChange={(e) => setPctUp(e.target.value)} aria-label="Aumento máximo">
          {[10, 15, 20, 25, 30].map((p) => <option key={p} value={p}>{p}%</option>)}
        </select>
      </td>
      <td>
        {dirty ? <button className="btn small primary" onClick={save} disabled={state === "saving"}>{state === "saving" ? "Salvando…" : "Salvar"}</button>
          : state === "saved" ? <span className="saved">Salvo</span> : null}
        {state !== "idle" && state !== "saving" && state !== "saved" && <div className="err-text">{state}</div>}
      </td>
    </tr>
  );
}

export function AutopilotPage() {
  const data = useAsync(getAutopilot, []);
  const clients = useAsync(getClients, []);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [tab, setTab] = useState<"todas" | "auto" | "humanas">("todas");

  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 3500); data.reload(); };
  const byId = new Map((clients.data ?? []).map((c) => [c.id, c]));
  const actions = data.data?.actions ?? [];
  const pending = actions.filter((a) => a.status === "proposed");
  const history = actions.filter((a) => a.status !== "proposed")
    .filter((a) => tab === "todas" || (tab === "auto" ? a.auto : !a.auto));
  const paused = data.data?.paused ?? false;
  const week = actions.filter((a) => a.status === "done" && Date.now() - new Date(a.executed_at ?? a.created_at).getTime() < 7 * 86400_000);

  async function analyze() {
    setBusy("analyze");
    try { const r = await runEvaluate(); flash(r.proposals ? `${r.proposals} nova(s) ação(ões); ${r.auto_executed} executada(s) automaticamente.` : "Nada novo: tudo dentro das regras."); }
    catch (e) { flash(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  }
  async function togglePause() {
    setBusy("pause");
    try { await setPausedAll(!paused); flash(!paused ? "Piloto parado: nenhuma ação automática será executada." : "Piloto religado."); }
    catch (e) { flash(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  }
  async function undo(a: AutopilotAction) {
    setBusy(a.id);
    try { await undoAction(a.id); flash("Ação desfeita no Meta."); }
    catch (e) { flash(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  }

  return (
    <>
      <header className="page-head">
        <div>
          <p className="eyebrow"><span className="eyebrow-dot" />Gestão automática</p>
          <h1>Piloto automático</h1>
          <p className="sub">O sistema analisa as contas duas vezes por dia, age dentro das regras e pede aprovação para o resto.</p>
        </div>
        <div className="head-actions">
          <span className={`ap-state ${paused ? "off" : "on"}`}>{paused ? "Parado" : "Ligado"}</span>
          <button className="btn" onClick={analyze} disabled={!!busy}>{busy === "analyze" ? "Analisando…" : "Analisar agora"}</button>
          <button className={`btn ${paused ? "primary" : "danger"}`} onClick={togglePause} disabled={!!busy}>{paused ? "Religar piloto" : "Parar tudo"}</button>
        </div>
      </header>

      {data.error && <div className="card empty err-text">{data.error}</div>}

      <section className="card">
        <div className="kpis ap-kpis">
          <div className="stat"><div className="stat-label">Aguardando aprovação</div><div className="stat-value">{pending.length}</div></div>
          <div className="stat"><div className="stat-label">Executadas em 7 dias</div><div className="stat-value">{week.length}</div>
            <div className="stat-note">{week.filter((a) => a.auto).length} automáticas</div></div>
          <div className="stat"><div className="stat-label">Anúncios pausados</div><div className="stat-value">{week.filter((a) => a.kind === "pause").length}</div><div className="stat-note">últimos 7 dias</div></div>
          <div className="stat"><div className="stat-label">Ajustes de orçamento</div><div className="stat-value">{week.filter((a) => a.kind === "set_budget").length}</div><div className="stat-note">últimos 7 dias</div></div>
        </div>
      </section>

      <section className="section">
        <div className="section-head"><h2>Aguardando aprovação</h2><span className="hint">propostas expiram em 36 h</span></div>
        {pending.length === 0
          ? <div className="card empty">{data.loading ? "Carregando…" : "Nenhuma ação esperando por você."}</div>
          : <div className="ap-grid">{pending.map((a) => <ActionCard key={a.id} a={a} client={byId.get(a.client_id)} onDone={flash} />)}</div>}
      </section>

      <section className="section">
        <div className="section-head"><h2>Autonomia por cliente</h2><span className="hint">sem meta de custo, o piloto usa a média do próprio cliente nos últimos 14 dias</span></div>
        <div className="card table-wrap">
          <table>
            <thead><tr><th>Cliente</th><th>Autonomia</th><th>Meta de custo por resultado</th><th>Teto do mês</th><th>Aumento máx.</th><th /></tr></thead>
            <tbody>
              {(clients.data ?? []).filter((c) => c.active).map((c) => (
                <SettingsRow key={`${c.id}-${data.data ? "x" : "y"}`} c={c} s={data.data?.settings.find((s) => s.client_id === c.id)} onSaved={() => data.reload()} />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Histórico</h2>
          <div className="chips">
            {(["todas", "auto", "humanas"] as const).map((t) => (
              <button key={t} className={`chip ${tab === t ? "on" : ""}`} onClick={() => setTab(t)} aria-pressed={tab === t}>
                {t === "todas" ? "Todas" : t === "auto" ? "Automáticas" : "Decididas pela equipe"}
              </button>
            ))}
          </div>
        </div>
        <div className="card table-wrap">
          <table className="tbl-left">
            <thead><tr><th>Quando</th><th>Cliente</th><th>Ação</th><th>Situação</th><th className="hide-sm">Quem</th><th /></tr></thead>
            <tbody>
              {history.map((a) => {
                const s = STATUS[a.status];
                const canUndo = a.status === "done" && Date.now() - new Date(a.executed_at ?? a.created_at).getTime() < 7 * 86400_000;
                return (
                  <tr key={a.id}>
                    <td className="num muted">{new Date(a.executed_at ?? a.decided_at ?? a.created_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</td>
                    <td>{byId.get(a.client_id)?.name ?? "—"}</td>
                    <td className="ap-hist">
                      <div>{a.title}</div>
                      <div className="help">{detail(a) || a.reason}</div>
                      {a.error && <div className="err-text">{a.error}</div>}
                    </td>
                    <td><span className={`ap-status ${s.cls}`}>{a.auto && a.status === "done" ? "Automática" : s.text}</span></td>
                    <td className="hide-sm muted">{a.status === "undone" ? `desfeita por ${a.undone_by}` : a.decided_by ?? "—"}</td>
                    <td>{canUndo && <button className="btn small" onClick={() => undo(a)} disabled={busy === a.id}>{busy === a.id ? "Desfazendo…" : "Desfazer"}</button>}</td>
                  </tr>
                );
              })}
              {!data.loading && history.length === 0 && <tr><td colSpan={6} className="empty">Nenhuma ação ainda.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <details className="card how">
        <summary>Como o piloto decide</summary>
        <div className="how-body">
          <p>Cada campanha é comparada com a <b>meta de custo por resultado</b> do cliente (conversa, lead, venda ou clique). Sem meta definida, vale a média do próprio cliente nos últimos 14 dias. Só dias completos entram na conta.</p>
          <ul>
            <li><b>Sem resultado</b> — pausa o anúncio que gastou 2x a meta em 7 dias sem nenhum resultado, rodando há 3 dias ou mais.</li>
            <li><b>Custo alto</b> — pausa o anúncio com custo 2,5x a meta quando outro anúncio do mesmo conjunto entrega dentro da meta.</li>
            <li><b>Reduzir verba</b> — reduz 20% o orçamento da campanha com custo 1,6x a meta na semana e sem melhora nos últimos 3 dias.</li>
            <li><b>Teto do mês</b> — reduz os orçamentos quando o ritmo de gasto vai passar do teto mensal.</li>
            <li><b>Escalar</b> — aumenta o orçamento (padrão 20%) da campanha 20% mais barata que a meta, estável nos últimos 3 dias e usando 85%+ do orçamento.</li>
            <li><b>Criativo novo</b> — criativo deixado com o piloto entra no conjunto com o menor custo por resultado dos últimos 14 dias, com o texto e o botão do anúncio que mais converte ali. Em Autônomo sobe sozinho; nos demais níveis vira proposta.</li>
          </ul>
          <p><b>Travas:</b> nunca pausa o último anúncio ativo de um conjunto; no máximo uma mudança de orçamento por campanha a cada 3 dias (para não reiniciar o aprendizado do Meta); orçamento nunca abaixo de R$ 10/dia; aumento nunca passa do teto do mês; aumentos só na análise da manhã. Toda ação fica no histórico e pode ser desfeita em até 7 dias. <b>Parar tudo</b> bloqueia qualquer execução automática na hora.</p>
        </div>
      </details>

      {toast && <div className="toast" role="status">{toast}</div>}
    </>
  );
}
