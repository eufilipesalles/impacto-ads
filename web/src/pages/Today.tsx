import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { getAccounts, getAlerts, getLastSync, getOverview, getPortfolioDaily, syncNow } from "../lib/api";
import { useAsync } from "../lib/hooks";
import { clientBalance, syncError } from "../lib/balance";
import { costDelta, count, money, one, pct, timeAgo, todayLong } from "../lib/format";
import { OBJECTIVE_LABEL, type ClientOverview } from "../lib/types";
import { DailyChart } from "../components/DailyChart";
import { Fuel } from "../components/Fuel";
import { DEMO } from "../lib/supabase";

const ORDER = { red: 0, yellow: 1, green: 2 } as const;

export function Today() {
  const nav = useNavigate();
  const q = DEMO ? "?demo" : "";
  const overview = useAsync(getOverview, []);
  const accounts = useAsync(getAccounts, []);
  const alerts = useAsync(() => getAlerts("open"), []);
  const daily = useAsync(() => getPortfolioDaily(30), []);
  const last = useAsync(getLastSync, []);
  const [syncing, setSyncing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  async function refresh() {
    setSyncing(true);
    try {
      const r = await syncNow();
      setToast(r.err ? `Atualizado: ${r.ok} contas. ${r.err} com erro.` : `Atualizado: ${r.ok} contas.`);
      overview.reload(); accounts.reload(); alerts.reload(); daily.reload(); last.reload();
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Falha ao atualizar");
    } finally {
      setSyncing(false);
      setTimeout(() => setToast(null), 5000);
    }
  }

  const accs = accounts.data ?? [];
  const rows = [...(overview.data ?? [])].sort((a, b) => {
    const ea = syncError(accs, a.client_id) ? 3 : ORDER[a.health];
    const eb = syncError(accs, b.client_id) ? 3 : ORDER[b.health];
    return ea - eb || b.spend_7d - a.spend_7d;
  });
  const names = Object.fromEntries((overview.data ?? []).map((o) => [o.client_id, o.name]));

  // Totais da carteira: últimos 7 dias vs 7 anteriores (da série de 30 dias)
  const d = daily.data ?? [];
  const sum = (arr: typeof d, k: "spend" | "conversations") => arr.reduce((s, p) => s + Number(p[k]), 0);
  const last7 = d.slice(-7), prev7 = d.slice(-14, -7);
  const spend7 = sum(last7, "spend"), conv7 = sum(last7, "conversations");
  const cpc = conv7 ? spend7 / conv7 : null;
  const cpcPrev = sum(prev7, "conversations") ? sum(prev7, "spend") / sum(prev7, "conversations") : null;
  const cpcDelta = costDelta(cpc, cpcPrev);

  const syncIssues = (overview.data ?? []).filter((o) => syncError(accs, o.client_id));
  const openAlerts = [...(alerts.data ?? [])].sort((a, b) => (a.severity === "critical" ? 0 : 1) - (b.severity === "critical" ? 0 : 1));
  const grouped = new Map<string, typeof openAlerts>();
  for (const a of openAlerts) grouped.set(a.client_id, [...(grouped.get(a.client_id) ?? []), a]);
  const byClient = [...grouped.entries()];
  const synced = accs.filter((a) => !a.last_sync_error && a.last_synced_at).length;

  return (
    <>
      <header className="page-head">
        <div>
          <p className="eyebrow">{todayLong()}</p>
          <h1>Hoje</h1>
          <p className="sub">
            Atualizado {timeAgo(last.data?.finished_at ?? null)} · {synced} de {accs.length} contas lendo dados
          </p>
        </div>
        <button className="btn primary" onClick={refresh} disabled={syncing}>
          {syncing ? "Atualizando…" : "Atualizar agora"}
        </button>
      </header>

      <section className="card stats" aria-label="Carteira nos últimos 7 dias">
        <div className="stat">
          <div className="stat-label">Gasto · 7 dias</div>
          <div className="stat-value">{money(spend7)}</div>
          <div className="stat-note">todas as contas</div>
        </div>
        <div className="stat">
          <div className="stat-label">Conversas · 7 dias</div>
          <div className="stat-value">{count(conv7)}</div>
          <div className="stat-note">iniciadas no WhatsApp/Direct</div>
        </div>
        <div className="stat">
          <div className="stat-label">Custo por conversa</div>
          <div className="stat-value">{money(cpc)}</div>
          <div className="stat-note">
            {cpcDelta === null ? "sem base de comparação" : (
              <span className={cpcDelta > 0 ? "delta bad" : "delta good"} style={{ marginLeft: 0 }}>
                {cpcDelta > 0 ? "▲" : "▼"} {one(Math.abs(cpcDelta))}% vs semana anterior
              </span>
            )}
          </div>
        </div>
        <div className="stat-chart">
          <div className="stat-label" style={{ padding: "0 8px 4px" }}>Últimos 30 dias · gasto e conversas</div>
          {d.length > 0 && <DailyChart data={d} height={92} compact />}
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Precisa de atenção</h2>
          <Link className="hint" to={`/alertas${q}`}>Ver todos os alertas</Link>
        </div>
        <div className="queue">
          {byClient.map(([cid, list]) => {
            const sev = list.some((a) => a.severity === "critical") ? "critical" : "warning";
            const go = () => nav(`/cliente/${cid}${q}`);
            return (
              <div key={cid} className={`q-item ${sev}`} role="button" tabIndex={0} style={{ cursor: "pointer" }}
                onClick={go} onKeyDown={(e) => e.key === "Enter" && go()}>
                <span className="q-bar" />
                <div>
                  <div className="q-title">{names[cid]}</div>
                  <div className="q-meta">
                    {list.map((a, i) => (
                      <span key={a.id}>{i > 0 && " · "}{a.title.replace(`${names[cid]}: `, "")}</span>
                    ))}
                  </div>
                </div>
                <span className="q-meta hide-sm">{sev === "critical" ? "Crítico" : "Atenção"}</span>
              </div>
            );
          })}
          {syncIssues.map((o) => (
            <div key={`sync-${o.client_id}`} className="q-item warning">
              <span className="q-bar" />
              <div>
                <div className="q-title">{o.name}</div>
                <div className="q-meta">{syncError(accs, o.client_id)}: os dados desta conta não estão chegando. Atribua a conta ao usuário do sistema no Business Manager.</div>
              </div>
              <span className="q-meta hide-sm">Coleta</span>
            </div>
          ))}
          {!alerts.loading && openAlerts.length + syncIssues.length === 0 && (
            <div className="card empty">Nenhum problema aberto. Todas as contas estão entregando normalmente.</div>
          )}
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Clientes</h2>
          <span className="hint">últimos 7 dias · ordenados por urgência</span>
        </div>
        <div className="card table-wrap">
          {overview.error && <div className="empty err-text">{overview.error}</div>}
          <table>
            <thead>
              <tr>
                <th>Cliente</th>
                <th className="hide-sm">Gasto ontem</th>
                <th>Gasto</th>
                <th>Conversas</th>
                <th>Custo/conversa</th>
                <th className="hide-sm">CTR link</th>
                <th className="hide-sm">Frequência</th>
                <th>Saldo dura</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(renderRow)}
            </tbody>
          </table>
        </div>
      </section>
      {toast && <div className="toast" role="status">{toast}</div>}
    </>
  );

  function renderRow(o: ClientOverview) {
    const err = syncError(accs, o.client_id);
    const delta = costDelta(o.cost_per_conv_7d, o.cost_per_conv_prev_7d);
    const go = () => nav(`/cliente/${o.client_id}${q}`);
    return (
      <tr key={o.client_id} className="link" onClick={go} onKeyDown={(e) => e.key === "Enter" && go()} tabIndex={0}>
        <td>
          <div className="client-cell">
            <span className={`lamp ${err ? "gray" : o.health}`} aria-label={err ? "sem dados" : o.health} />
            <div>
              <div className="client-name">{o.name}</div>
              <div className="client-obj">{OBJECTIVE_LABEL[o.objective]}</div>
            </div>
          </div>
        </td>
        {err ? (
          <td colSpan={7} className="err-text" style={{ textAlign: "left" }}>{err} — sem dados desta conta</td>
        ) : (
          <>
            <td className="num hide-sm">{money(o.spend_yesterday)}</td>
            <td className="num">{money(o.spend_7d)}</td>
            <td className="num">{count(o.conversations_7d)}</td>
            <td className="num">
              {money(o.cost_per_conv_7d)}
              {delta !== null && Math.abs(delta) >= 1 && (
                <span className={`delta ${delta > 0 ? "bad" : "good"}`}>{delta > 0 ? "▲" : "▼"}{Math.round(Math.abs(delta))}%</span>
              )}
            </td>
            <td className="num hide-sm">{pct(o.ctr_link_7d)}</td>
            <td className="num hide-sm">{one(o.freq_7d)}</td>
            <td><Fuel balance={clientBalance(accs, o.client_id)} spend7d={o.spend_7d} /></td>
          </>
        )}
      </tr>
    );
  }
}
