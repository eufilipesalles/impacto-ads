import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getAccounts, getAdStats, getAlerts, getCampaignStats, getClientDaily, getOverview } from "../lib/api";
import { useAsync } from "../lib/hooks";
import { clientBalance, syncError } from "../lib/balance";
import { count, money, pct, timeAgo } from "../lib/format";
import { OBJECTIVE_LABEL, type AdStat } from "../lib/types";
import { DailyChart } from "../components/DailyChart";
import { Fuel } from "../components/Fuel";
import { DEMO } from "../lib/supabase";

const PERIODS = [7, 14, 30, 90];

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Ativa", PAUSED: "Pausada", CAMPAIGN_PAUSED: "Campanha pausada", ADSET_PAUSED: "Conjunto pausado",
  DISAPPROVED: "Reprovado", WITH_ISSUES: "Com problema", PENDING_REVIEW: "Em análise", IN_PROCESS: "Processando",
};

// Melhores primeiro: quem gerou conversa, pelo menor custo; depois o restante pelo gasto
function rankAds(ads: AdStat[]) {
  const withConv = ads.filter((a) => a.conversations > 0).sort((a, b) => (a.cost_per_conversation ?? 0) - (b.cost_per_conversation ?? 0));
  const without = ads.filter((a) => !a.conversations).sort((a, b) => b.spend - a.spend);
  return [...withConv, ...without];
}

export function ClientPage() {
  const { id = "" } = useParams();
  const q = DEMO ? "?demo" : "";
  const [days, setDays] = useState(7);
  const overview = useAsync(getOverview, []);
  const accounts = useAsync(getAccounts, []);
  const alerts = useAsync(() => getAlerts("open"), []);
  const daily = useAsync(() => getClientDaily(id, days), [id, days]);
  const campaigns = useAsync(() => getCampaignStats(id, days), [id, days]);
  const ads = useAsync(() => getAdStats(id, days), [id, days]);

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
  const myAlerts = (alerts.data ?? []).filter((a) => a.client_id === id);
  const ranked = rankAds(ads.data ?? []);
  const bestId = ranked.find((a) => a.conversations > 0)?.ad_id;

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
        <div className="seg" role="group" aria-label="Período">
          {PERIODS.map((p) => (
            <button key={p} className={p === days ? "on" : ""} onClick={() => setDays(p)} aria-pressed={p === days}>{p}d</button>
          ))}
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
        <div className="kpis">
          <div className="stat"><div className="stat-label">Gasto</div><div className="stat-value">{money(spend)}</div></div>
          <div className="stat"><div className="stat-label">Conversas</div><div className="stat-value">{count(conv)}</div></div>
          <div className="stat"><div className="stat-label">Custo por conversa</div><div className="stat-value">{money(conv ? spend / conv : null)}</div></div>
          <div className="stat"><div className="stat-label">CTR do link</div><div className="stat-value">{pct(imp ? (clicks / imp) * 100 : null)}</div>
            <div className="stat-note">CPM {money(imp ? (spend / imp) * 1000 : null)}</div></div>
          <div className="stat"><div className="stat-label">Saldo da conta</div>
            <div style={{ marginTop: 6, textAlign: "left" }}><Fuel balance={clientBalance(accounts.data ?? [], id)} spend7d={o.spend_7d} /></div></div>
        </div>
        <div className="chart-box">{d.length > 0 && <DailyChart data={d} height={270} />}</div>
        <div className="legend">
          <span><i style={{ background: "var(--chart-spend)" }} />Gasto por dia</span>
          <span><i style={{ background: "var(--chart-conv)" }} />Conversas por dia</span>
        </div>
      </section>

      <section className="section">
        <div className="section-head"><h2>Campanhas</h2><span className="hint">últimos {days} dias</span></div>
        <div className="card table-wrap">
          <table>
            <thead>
              <tr><th>Campanha</th><th>Status</th><th className="hide-sm">Orçamento/dia</th><th>Gasto</th><th>Conversas</th><th>Custo/conversa</th><th className="hide-sm">CTR</th><th className="hide-sm">CPM</th></tr>
            </thead>
            <tbody>
              {(campaigns.data ?? []).map((c) => (
                <tr key={c.campaign_id}>
                  <td className="camp-name">{c.name}</td>
                  <td><span className={`status-tag ${c.effective_status}`}>{STATUS_LABEL[c.effective_status ?? ""] ?? c.effective_status}</span></td>
                  <td className="num hide-sm">{money(c.daily_budget)}</td>
                  <td className="num">{money(c.spend)}</td>
                  <td className="num">{count(c.conversations)}</td>
                  <td className="num">{money(c.cost_per_conversation)}</td>
                  <td className="num hide-sm">{pct(c.ctr)}</td>
                  <td className="num hide-sm">{money(c.cpm)}</td>
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
        <div className="section-head"><h2>Criativos</h2><span className="hint">menor custo por conversa primeiro</span></div>
        {ranked.length === 0 && !ads.loading && <div className="card empty">Nenhum anúncio com gasto neste período.</div>}
        <div className="ads">
          {ranked.map((a, i) => (
            <article key={a.ad_id ?? i} className="card ad">
              <div className="ad-thumb">
                {a.thumbnail_url ? <img src={a.thumbnail_url} alt="" loading="lazy" /> : <span>sem prévia</span>}
                <span className="ad-rank">#{i + 1}</span>
              </div>
              <div className="ad-body">
                <div>
                  <div className="ad-name">{a.name ?? "Anúncio sem nome"}</div>
                  <div className="ad-camp">{a.campaign_name}</div>
                </div>
                <div className="ad-nums">
                  <div>Gasto<b>{money(a.spend)}</b></div>
                  <div>Conversas<b>{count(a.conversations)}</b></div>
                  <div>Custo/conv.<b className={a.ad_id === bestId ? "best" : ""}>{money(a.cost_per_conversation)}</b></div>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
