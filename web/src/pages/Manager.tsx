// Gerenciador: campanha → conjunto → anúncio de cada cliente, com as ações do dia a dia
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { getClients } from "../lib/api";
import { useAsync } from "../lib/hooks";
import { count, money } from "../lib/format";
import { DEMO } from "../lib/supabase";
import { KIND_TXT, getTree, health, manualAction, type MAd, type MAdset, type MCampaign, type Stats, type Tree } from "../lib/manager";
import { AddCreativeDialog } from "../components/AddCreative";

const STATUS: Record<string, { text: string; tone: "on" | "off" | "wait" | "bad" }> = {
  ACTIVE: { text: "Ativo", tone: "on" }, PAUSED: { text: "Pausado", tone: "off" }, CAMPAIGN_PAUSED: { text: "Pausado pela campanha", tone: "off" },
  ADSET_PAUSED: { text: "Pausado pelo conjunto", tone: "off" }, IN_PROCESS: { text: "Em análise", tone: "wait" }, PENDING_REVIEW: { text: "Em revisão do Meta", tone: "wait" },
  DISAPPROVED: { text: "Reprovado", tone: "bad" }, WITH_ISSUES: { text: "Com problema", tone: "bad" }, ARCHIVED: { text: "Arquivado", tone: "off" },
  DELETED: { text: "Excluído", tone: "off" }, PREAPPROVED: { text: "Pré-aprovado", tone: "wait" }, PENDING_BILLING_INFO: { text: "Falta pagamento", tone: "bad" },
};
const HEALTH_LABEL = { bom: "Bom", atencao: "Atenção", ruim: "Ruim", sem_dados: "—", aprendendo: "Aprendendo" } as const;
const LEVEL_LABEL = ["Só sugere", "Protege a verba", "Autônomo"];
type Obj = { type: "campaign" | "adset" | "ad"; id: string; name: string };
type Ask = { obj: Obj; kind: "pause" | "activate" } | { obj: Obj; kind: "set_budget"; current: number | null };

export function ManagerPage() {
  const [params, setParams] = useSearchParams();
  const clientId = params.get("cliente") ?? (DEMO ? "c2" : "");
  const days = Number(params.get("dias") ?? 7);
  const clients = useAsync(getClients, []);
  const [key, setKey] = useState(0);
  const tree = useAsync(() => (clientId ? getTree(clientId, days) : Promise.resolve(null)), [clientId, days, key]);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [showOff, setShowOff] = useState(false);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [adding, setAdding] = useState<{ campaign_id?: string; adset_id?: string; label?: string } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 5000); };
  const set = (k: string, v: string) => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); setParams(p, { replace: true }); };

  const t = tree.data;
  const K = t ? KIND_TXT[t.kind] : KIND_TXT.click;
  const visible = useMemo(() => (t?.campaigns ?? []).filter((c) => showOff || c.effective_status === "ACTIVE" || c.stats.spend > 0 || ["IN_PROCESS", "PENDING_REVIEW", "WITH_ISSUES"].includes(c.effective_status ?? "")), [t, showOff]);
  const hidden = (t?.campaigns.length ?? 0) - visible.length;
  const totals = (t?.campaigns ?? []).reduce((x, c) => ({ spend: x.spend + c.stats.spend, result: x.result + c.stats.result }), { spend: 0, result: 0 });
  const activeCount = (t?.campaigns ?? []).filter((c) => c.effective_status === "ACTIVE").length;

  return (
    <>
      <header className="page-head">
        <div>
          <p className="eyebrow"><span className="eyebrow-dot" />Gerenciador de anúncios</p>
          <h1>Gerenciador</h1>
          <p className="sub">Campanhas, conjuntos e anúncios de cada cliente. O que você muda aqui vai direto para o Meta e fica no histórico do Piloto, onde dá para desfazer.</p>
        </div>
        <div className="head-actions">
          <select className="select" value={clientId} onChange={(e) => set("cliente", e.target.value)} aria-label="Cliente">
            <option value="">Escolha o cliente</option>
            {(clients.data ?? []).filter((c) => c.active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <div className="seg" role="group" aria-label="Período">
            {[7, 14, 30].map((d) => <button key={d} className={days === d ? "on" : ""} aria-pressed={days === d} onClick={() => set("dias", String(d))}>{d} dias</button>)}
          </div>
        </div>
      </header>

      {!clientId && <div className="card empty">Escolha um cliente para ver as campanhas.</div>}
      {tree.error && <div className="card empty err-text">{tree.error}</div>}

      {clientId && t && (
        <>
          <section className="card mg-summary">
            <div><span className="field-label">Investido · {days} dias</span><b>{money(totals.spend)}</b></div>
            <div><span className="field-label">{K.many[0].toUpperCase() + K.many.slice(1)}</span><b>{count(totals.result)}</b></div>
            <div><span className="field-label">Custo médio {K.cost}</span><b>{money(t.avgCost)}</b></div>
            <div><span className="field-label">Campanhas ativas</span><b>{activeCount}</b></div>
            <div><span className="field-label">Piloto automático</span><b><Link to={`/piloto${DEMO ? "?demo" : ""}`}>{LEVEL_LABEL[t.level] ?? "—"}</Link></b></div>
            <div className="mg-actions">
              <button className="btn primary" onClick={() => setAdding({})}>+ Novo criativo</button>
              <Link className="btn" to={`/estrategia?cliente=${clientId}${DEMO ? "&demo" : ""}`}>+ Campanha nova</Link>
            </div>
          </section>

          <div className="mg-legend">
            <span><i className="hl hl-bom" /> Bom: custo abaixo da média do cliente</span>
            <span><i className="hl hl-atencao" /> Atenção: na média ou um pouco acima</span>
            <span><i className="hl hl-ruim" /> Ruim: muito acima, ou gastou sem resultado</span>
            <span><i className="hl hl-aprendendo" /> Aprendendo: pouco resultado para julgar</span>
          </div>

          <section className="card mg-tree">
            <div className="mg-row mg-headrow" aria-hidden="true">
              <span /><span>Nome</span><span>Orçamento/dia</span><span>Investido</span><span>{K.many[0].toUpperCase() + K.many.slice(1)}</span><span>Custo</span><span>Saúde</span><span />
            </div>
            {visible.length === 0 && <div className="empty">Nenhuma campanha ativa ou com gasto no período.</div>}
            {visible.map((c) => (
              <CampaignBlock key={c.id} c={c} t={t} open={!!open[c.id]} toggle={() => setOpen((o) => ({ ...o, [c.id]: !o[c.id] }))}
                openSet={(id) => setOpen((o) => ({ ...o, [id]: !o[id] }))} isOpen={(id) => !!open[id]}
                onAsk={setAsk} onAdd={(p) => setAdding(p)} />
            ))}
            {hidden > 0 && (
              <button className="link-btn mg-more" onClick={() => setShowOff((v) => !v)}>
                {showOff ? "Esconder campanhas paradas" : `Mostrar ${hidden} campanha(s) parada(s) sem gasto no período`}
              </button>
            )}
          </section>
        </>
      )}
      {clientId && tree.loading && !t && <div className="card empty">Carregando campanhas…</div>}

      {ask && <ConfirmAction ask={ask} onClose={() => setAsk(null)} onDone={(m) => { setAsk(null); flash(m); setKey((k) => k + 1); }} />}
      {adding && clientId && (
        <AddCreativeDialog clientId={clientId} preset={adding} onClose={() => setAdding(null)}
          onDone={(m) => { setAdding(null); flash(m); setKey((k) => k + 1); }} />
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </>
  );
}

function StatusPill({ s }: { s: string | null }) {
  const x = STATUS[s ?? ""] ?? { text: s ?? "—", tone: "off" as const };
  return <span className={`st-pill st-${x.tone}`}>{x.text}</span>;
}

function Toggle({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return <button className={`tgl ${on ? "on" : ""}`} role="switch" aria-checked={on} aria-label={label} onClick={(e) => { e.stopPropagation(); onClick(); }}><i /></button>;
}

function Metrics({ s, avg, budget, onBudget }: { s: Stats; avg: number | null; budget?: number | null; onBudget?: () => void }) {
  const h = health(s, avg);
  return (
    <>
      <span className="mg-num">
        {budget !== undefined && (budget ? <>{money(budget)}{onBudget && <button className="link-btn" onClick={(e) => { e.stopPropagation(); onBudget(); }}>alterar</button>}</> : <span className="muted">—</span>)}
      </span>
      <span className="mg-num" data-label="Investido">{money(s.spend)}</span>
      <span className="mg-num" data-label="Resultados">{count(s.result)}</span>
      <span className="mg-num" data-label="Custo">{s.result ? money(s.spend / s.result) : "—"}</span>
      <span title={h.text}><span className={`hl-tag hl-${h.h}`}>{HEALTH_LABEL[h.h]}</span></span>
    </>
  );
}

function CampaignBlock({ c, t, open, toggle, openSet, isOpen, onAsk, onAdd }: {
  c: MCampaign; t: Tree; open: boolean; toggle: () => void; openSet: (id: string) => void; isOpen: (id: string) => boolean;
  onAsk: (a: Ask) => void; onAdd: (p: { campaign_id?: string; adset_id?: string; label?: string }) => void;
}) {
  const on = c.status === "ACTIVE";
  const cbo = !!c.daily_budget;
  return (
    <div className="mg-block">
      <div className="mg-row mg-camp" onClick={toggle} role="button" tabIndex={0} aria-expanded={open} onKeyDown={(e) => e.key === "Enter" && toggle()}>
        <Toggle on={on} label={on ? "Pausar campanha" : "Ativar campanha"} onClick={() => onAsk({ obj: { type: "campaign", id: c.id, name: c.name }, kind: on ? "pause" : "activate" })} />
        <span className="mg-name"><span className={`caret ${open ? "open" : ""}`}>›</span><span><b>{c.name}</b><small><StatusPill s={c.effective_status} /> {c.adsets.length} conjunto(s)</small></span></span>
        <Metrics s={c.stats} avg={t.avgCost} budget={cbo ? c.daily_budget : null}
          onBudget={cbo ? () => onAsk({ obj: { type: "campaign", id: c.id, name: c.name }, kind: "set_budget", current: c.daily_budget }) : undefined} />
        <span className="mg-act"><button className="btn small" onClick={(e) => { e.stopPropagation(); onAdd({ campaign_id: c.id, label: c.name }); }}>+ Criativo</button></span>
      </div>
      {open && c.adsets.map((s) => <AdsetBlock key={s.id} s={s} c={c} t={t} open={isOpen(s.id)} toggle={() => openSet(s.id)} onAsk={onAsk} onAdd={onAdd} cbo={cbo} />)}
      {open && !c.adsets.length && <div className="mg-row mg-l1 muted"><span /><span>Sem conjuntos sincronizados.</span></div>}
    </div>
  );
}

function AdsetBlock({ s, c, t, open, toggle, onAsk, onAdd, cbo }: {
  s: MAdset; c: MCampaign; t: Tree; open: boolean; toggle: () => void; onAsk: (a: Ask) => void;
  onAdd: (p: { campaign_id?: string; adset_id?: string; label?: string }) => void; cbo: boolean;
}) {
  const on = s.status === "ACTIVE";
  return (
    <>
      <div className="mg-row mg-l1" onClick={toggle} role="button" tabIndex={0} aria-expanded={open} onKeyDown={(e) => e.key === "Enter" && toggle()}>
        <Toggle on={on} label={on ? "Pausar conjunto" : "Ativar conjunto"} onClick={() => onAsk({ obj: { type: "adset", id: s.id, name: s.name }, kind: on ? "pause" : "activate" })} />
        <span className="mg-name"><span className={`caret ${open ? "open" : ""}`}>›</span><span>{s.name}<small><StatusPill s={s.effective_status} /> {s.ads.length} anúncio(s)</small></span></span>
        <Metrics s={s.stats} avg={t.avgCost} budget={cbo ? undefined : s.daily_budget}
          onBudget={!cbo && s.daily_budget ? () => onAsk({ obj: { type: "adset", id: s.id, name: s.name }, kind: "set_budget", current: s.daily_budget }) : undefined} />
        <span className="mg-act"><button className="btn small" onClick={(e) => { e.stopPropagation(); onAdd({ campaign_id: c.id, adset_id: s.id, label: s.name }); }}>+ Criativo</button></span>
      </div>
      {open && s.ads.map((a) => <AdRow key={a.id} a={a} t={t} onAsk={onAsk} />)}
    </>
  );
}

function AdRow({ a, t, onAsk }: { a: MAd; t: Tree; onAsk: (a: Ask) => void }) {
  const on = a.status === "ACTIVE";
  return (
    <div className="mg-row mg-l2">
      <Toggle on={on} label={on ? "Pausar anúncio" : "Ativar anúncio"} onClick={() => onAsk({ obj: { type: "ad", id: a.id, name: a.name }, kind: on ? "pause" : "activate" })} />
      <span className="mg-name">
        <span className="mg-thumb">{a.image_url ? <img src={a.image_url} alt="" loading="lazy" /> : null}</span>
        <span>{a.name}<small><StatusPill s={a.effective_status} /></small></span>
      </span>
      <Metrics s={a.stats} avg={t.avgCost} budget={undefined} />
      <span className="mg-act" />
    </div>
  );
}

function ConfirmAction({ ask, onClose, onDone }: { ask: Ask; onClose: () => void; onDone: (m: string) => void }) {
  const [amount, setAmount] = useState(ask.kind === "set_budget" && ask.current ? String(ask.current).replace(".", ",") : "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const label = ask.obj.type === "ad" ? "o anúncio" : ask.obj.type === "adset" ? "o conjunto" : "a campanha";
  const value = Number(amount.replace(/\./g, "").replace(",", "."));
  const change = ask.kind === "set_budget" && ask.current ? (value - ask.current) / ask.current : 0;

  async function go() {
    setBusy(true); setErr(null);
    try {
      await manualAction({ object_type: ask.obj.type, object_id: ask.obj.id, kind: ask.kind, ...(ask.kind === "set_budget" ? { amount: value } : {}) });
      onDone(ask.kind === "pause" ? `Pausado: ${ask.obj.name}` : ask.kind === "activate" ? `Ativado: ${ask.obj.name}` : `Orçamento de ${ask.obj.name}: ${money(value)}/dia`);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setBusy(false); }
  }

  return (
    <div className="drawer-wrap center" onClick={onClose}>
      <div className="card modal" role="dialog" aria-modal="true" aria-label="Confirmar" onClick={(e) => e.stopPropagation()}>
        <div className="nc-head">
          <h2>{ask.kind === "pause" ? `Pausar ${label}?` : ask.kind === "activate" ? `Ativar ${label}?` : "Alterar orçamento diário"}</h2>
          <button className="dr-close dark" onClick={onClose} aria-label="Fechar">×</button>
        </div>
        <p className="help"><b>{ask.obj.name}</b></p>
        {ask.kind === "pause" && <p className="help">Para de gastar em poucos minutos. Os resultados e o aprendizado ficam salvos; dá para reativar quando quiser.</p>}
        {ask.kind === "activate" && <p className="help">Volta a veicular depois da revisão do Meta. Se a campanha ou o conjunto acima estiver pausado, ative-os também.</p>}
        {ask.kind === "set_budget" && (
          <>
            <label className="field-label" htmlFor="bud">Novo orçamento por dia (R$)</label>
            <input id="bud" className="input money" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
            {Math.abs(change) > 0.2 && Number.isFinite(change) && (
              <p className="warn-text">Mudança de {Math.round(change * 100)}%. Acima de 20% de uma vez o Meta costuma reiniciar o aprendizado e o custo oscila por alguns dias — prefira subir aos poucos.</p>
            )}
          </>
        )}
        {err && <div className="form-error" role="alert">{err}</div>}
        <div className="nc-foot right">
          <button className="btn" onClick={onClose} disabled={busy}>Cancelar</button>
          <button className={`btn ${ask.kind === "pause" ? "danger" : "primary"}`} onClick={go} disabled={busy || (ask.kind === "set_budget" && !(value >= 10))}>
            {busy ? "Aplicando…" : ask.kind === "pause" ? "Pausar" : ask.kind === "activate" ? "Ativar" : "Salvar orçamento"}
          </button>
        </div>
      </div>
    </div>
  );
}
