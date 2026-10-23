import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getAccounts, getAlerts, getCampaignStats, getClientDaily, getCreatives, getOverview } from "../lib/api";
import { useAsync } from "../lib/hooks";
import { clientBalance, syncError } from "../lib/balance";
import { count, isSalesClient, money, pct, roas, timeAgo } from "../lib/format";
import { OBJECTIVE_LABEL } from "../lib/types";
import { scoreCreatives } from "../lib/creative";
import { CreativeCard, CreativeDrawer } from "../components/Creatives";
import { DailyChart } from "../components/DailyChart";
import { Fuel } from "../components/Fuel";
import { DEMO } from "../lib/supabase";
import { Reconcile } from "../components/Reconcile";
import { addDays, brToday } from "../lib/period";

const PERIODS = [7, 14, 30, 90];

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Ativa", PAUSED: "Pausada", CAMPAIGN_PAUSED: "Campanha pausada", ADSET_PAUSED: "Conjunto pausado",
  DISAPPROVED: "Reprovado", WITH_ISSUES: "Com problema", PENDING_REVIEW: "Em análise", IN_PROCESS: "Processando",
};

export function ClientPage() {
  const { id = "" } = useParams();
  const q = DEMO ? "?demo" : "";
  const [days, setDays] = useState(7);
  const overview = useAsync(getOverview, []);
  const accounts = useAsync(getAccounts, []);
  const alerts = useAsync(() => getAlerts("open"), []);
  const daily = useAsync(() => getClientDaily(id, days), [id, days]);
  const campaigns = useAsync(() => getCampaignStats(id, days), [id, days]);
  const creatives = useAsync(() => getCreatives(id, days), [id, days]);
  const scored = useMemo(() => scoreCreatives(creatives.data ?? []), [creatives.data]);
  const [openAd, setOpenAd] = useState<string | null>(null);

  const o = overview.data?.find((c) => c.client_id === id);
  if (overview.loading) return <div className="loading">Carregando…</div>;
  if (!o) return <div className="empty">Cliente não encontrado. <Link to={`/${q}`}>Voltar para Hoje</Link></div>;

  const accs = (accounts.data ?? []).filter((a) => a.client_id === id);
  const err = syncError(accounts.data ?? [], id);
  const d = daily.data ?? [];
  const spend = d.reduce((s, p) => s + Number(p.spend), 0);
  const conv = d.reduce((s, p) => s + Number(p.conversations), 0);
  const imp = d.reduce((s, p) => s + Number(p.impressions ?? 0), 0);
  const clicks = d.reduce((s, p) => s + Number(p.link_clicks ?? 0), 0);
  const purchases = d.reduce((s, p) => s + Number(p.purchases ?? 0), 0);
  const revenue = d.reduce((s, p) => s + Number(p.purchase_value ?? 0), 0);
  const sales = isSalesClient(o.objective, purchases);
  const myAlerts = (alerts.data ?? []).filter((a) => a.client_id === id);
  const ranked = [...scored].sort((a, b) => Number(a.verdict === "teste") - Number(b.verdict === "teste") || b.score - a.score);
  const openCreative = scored.find((c) => c.ad_id === openAd) ?? null;

  return (
    <>
      <Link className="back" to={`/${q}`}>← Hoje</Link>
      <header className="page-head">
        <div>
          <p className="eyebrow">{OBJECTIVE_LABEL[o.objective]}{accs[0]?.name ? ` · ${accs[0].name.trim()}` : ""}</p>
          <h1>{o.name}</h1>
          <p className="sub">
            {err ? <span className="err-text">{err} — atribua esta conta ao usuário do sistema no Business Manager.</span>
              : <>Atualizado {timeAgo(o.last_synced_at)}{o.monthly_budget ? ` · verba do mês ${money(o.spend_month)} de ${money(o.monthly_budget)}` : ""}</>}
          </p>
        </div>
        <div className="head-actions">
          <div className="seg" role="group" aria-label="Período">
            {PERIODS.map((p) => (
              <button key={p} className={p === days ? "on" : ""} onClick={() => setDays(p)} aria-pressed={p === days}>{p}d</button>
            ))}
          </div>
          <Link className="btn primary" to={`/relatorios?cliente=${id}${DEMO ? "&demo" : ""}`}>Gerar relatório</Link>
        </div>
      </header>

      {myAlerts.length > 0 && (
        <div className="queue" style={{ marginBottom: 20 }}>
          {myAlerts.map((a) => (
            <div key={a.id} className={`q-item ${a.severity}`}>
              <span className="q-bar" />
              <div><div className="q-title">{a.title.replace(`${o.name}: `, "")}</div><div className="q-meta">aberto {timeAgo(a.created_at)}</div></div>
              <span />
            </div>
          ))}
        </div>
      )}

      <section className="card">
        <div className={`kpis ${sales ? "six" : ""}`}>
          <div className="stat"><div className="stat-label">Gasto</div><div className="stat-value">{money(spend)}</div></div>
          {sales ? (
            <>
              <div className="stat"><div className="stat-label">Vendas (compras)</div><div className="stat-value">{count(purchases)}</div></div>
              <div className="stat"><div className="stat-label">Faturamento</div><div className="stat-value">{money(revenue)}</div>
                <div className="stat-note">ticket médio {money(purchases ? revenue / purchases : null)}</div></div>
              <div className="stat"><div className="stat-label">ROAS</div><div className="stat-value">{roas(spend ? revenue / spend : null)}</div>
                <div className="stat-note">faturamento ÷ gasto</div></div>
              <div className="stat"><div className="stat-label">Custo por venda</div><div className="stat-value">{money(purchases ? spend / purchases : null)}</div></div>
            </>
          ) : (
            <>
              <div className="stat"><div className="stat-label">Conversas</div><div className="stat-value">{count(conv)}</div></div>
              <div className="stat"><div className="stat-label">Custo por conversa</div><div className="stat-value">{money(conv ? spend / conv : null)}</div></div>
              <div className="stat"><div className="stat-label">CTR do link</div><div className="stat-value">{pct(imp ? (clicks / imp) * 100 : null)}</div>
                <div className="stat-note">CPM {money(imp ? (spend / imp) * 1000 : null)}</div></div>
            </>
          )}
          <div className="stat"><div className="stat-label">Saldo da conta</div>
            <div style={{ marginTop: 6, textAlign: "left" }}><Fuel balance={clientBalance(accounts.data ?? [], id)} spend7d={o.spend_7d} /></div></div>
        </div>
        <div className="chart-box">{d.length > 0 && <DailyChart data={d} height={270} line={sales ? "purchases" : "conversations"} />}</div>
        <div className="legend">
          <span><i style={{ background: "var(--chart-spend)" }} />Gasto por dia</span>
          <span><i style={{ background: "var(--chart-conv)" }} />{sales ? "Compras por dia" : "Conversas por dia"}</span>
        </div>
      </section>

      {!err && accs.length > 0 && (
        <div className="section">
          <Reconcile key={`${id}-${days}`} clientId={id} accountIds={accs.map((a) => a.id)}
            since={addDays(brToday(), -days)} until={addDays(brToday(), -1)} />
        </div>
      )}

      <section className="section">
        <div className="section-head"><h2>Campanhas</h2><span className="hint">últimos {days} dias</span></div>
        <div className="card table-wrap">
          <table>
            <thead>
              {sales
                ? <tr><th>Campanha</th><th>Status</th><th className="hide-sm">Orçamento/dia</th><th>Gasto</th><th>Compras</th><th>Faturamento</th><th>ROAS</th><th className="hide-sm">Custo/venda</th></tr>
                : <tr><th>Campanha</th><th>Status</th><th className="hide-sm">Orçamento/dia</th><th>Gasto</th><th>Conversas</th><th>Custo/conversa</th><th className="hide-sm">CTR</th><th className="hide-sm">CPM</th></tr>}
            </thead>
            <tbody>
              {(campaigns.data ?? []).map((c) => (
                <tr key={c.campaign_id}>
                  <td className="camp-name">{c.name}</td>
                  <td><span className={`status-tag ${c.effective_status}`}>{STATUS_LABEL[c.effective_status ?? ""] ?? c.effective_status}</span></td>
                  <td className="num hide-sm">{money(c.daily_budget)}</td>
                  <td className="num">{money(c.spend)}</td>
                  {sales ? (
                    <>
                      <td className="num">{count(c.purchases)}</td>
                      <td className="num">{money(c.purchase_value)}</td>
                      <td className="num">{c.purchases ? roas(c.roas) : "—"}</td>
                      <td className="num hide-sm">{money(c.cost_per_purchase)}</td>
                    </>
                  ) : (
                    <>
                      <td className="num">{count(c.conversations)}</td>
                      <td className="num">{money(c.cost_per_conversation)}</td>
                      <td className="num hide-sm">{pct(c.ctr)}</td>
                      <td className="num hide-sm">{money(c.cpm)}</td>
                    </>
                  )}
                </tr>
              ))}
              {!campaigns.loading && (campaigns.data ?? []).length === 0 && (
                <tr><td colSpan={8} className="empty">Nenhuma campanha com gasto ou ativa neste período.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Criativos</h2>
          <Link className="hint" to={`/criativos?cliente=${id}${days !== 30 ? `&dias=${days}` : ""}${DEMO ? "&demo" : ""}`}>análise completa →</Link>
        </div>
        {ranked.length === 0 && !creatives.loading && <div className="card empty">Nenhum anúncio com gasto neste período.</div>}
        <div className="cr-grid">
          {ranked.slice(0, 6).map((c) => <CreativeCard key={c.ad_id} c={c} showClient={false} onOpen={() => setOpenAd(c.ad_id)} />)}
        </div>
        {ranked.length > 6 && (
          <p className="help" style={{ marginTop: 10 }}>
            Mostrando os 6 melhores de {ranked.length}. <Link to={`/criativos?cliente=${id}${DEMO ? "&demo" : ""}`}>Ver todos</Link>
          </p>
        )}
      </section>
      {openCreative && <CreativeDrawer c={openCreative} days={days} onClose={() => setOpenAd(null)} />}
    </>
  );
}
