import { useState } from "react";
import { Link } from "react-router-dom";
import { acknowledgeAlert, getAlerts, getOverview } from "../lib/api";
import { useAsync } from "../lib/hooks";
import { timeAgo } from "../lib/format";
import { DEMO } from "../lib/supabase";
import type { Alert } from "../lib/types";

export function AlertsPage() {
  const q = DEMO ? "?demo" : "";
  const [tab, setTab] = useState<"open" | "resolved">("open");
  const alerts = useAsync(() => getAlerts(tab), [tab]);
  const overview = useAsync(getOverview, []);
  const names = Object.fromEntries((overview.data ?? []).map((o) => [o.client_id, o.name]));

  const groups = new Map<string, Alert[]>();
  for (const a of alerts.data ?? []) groups.set(a.client_id, [...(groups.get(a.client_id) ?? []), a]);

  async function ack(id: string) {
    await acknowledgeAlert(id);
    alerts.reload();
  }

  return (
    <>
      <header className="page-head">
        <div>
          <p className="eyebrow">Avaliados a cada coleta</p>
          <h1>Alertas</h1>
          <p className="sub">Um alerta fecha sozinho quando o problema deixa de acontecer.</p>
        </div>
      </header>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === "open"} className={tab === "open" ? "on" : ""} onClick={() => setTab("open")}>Abertos</button>
        <button role="tab" aria-selected={tab === "resolved"} className={tab === "resolved" ? "on" : ""} onClick={() => setTab("resolved")}>Resolvidos</button>
      </div>
      {alerts.error && <div className="card empty err-text">{alerts.error}</div>}
      {!alerts.loading && groups.size === 0 && (
        <div className="card empty">{tab === "open" ? "Nenhum alerta aberto." : "Nenhum alerta resolvido ainda."}</div>
      )}
      {[...groups.entries()].map(([clientId, list]) => (
        <div key={clientId}>
          <div className="group-name"><Link to={`/cliente/${clientId}${q}`}>{names[clientId] ?? "Cliente"}</Link></div>
          <div className="queue">
            {list.map((a) => (
              <div key={a.id} className={`q-item ${tab === "resolved" ? "info" : a.severity}`}>
                <span className="q-bar" />
                <div>
                  <div className="q-title">{a.title.replace(`${names[clientId]}: `, "")}</div>
                  <div className="q-meta">
                    {tab === "resolved" ? `resolvido ${timeAgo(a.resolved_at)}` : `aberto ${timeAgo(a.created_at)} · visto pela última vez ${timeAgo(a.last_seen_at)}`}
                    {a.status === "acknowledged" && " · marcado como visto"}
                  </div>
                </div>
                {tab === "open" && a.status === "open"
                  ? <button className="btn small" onClick={() => ack(a.id)}>Marcar como visto</button>
                  : <span />}
              </div>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}
