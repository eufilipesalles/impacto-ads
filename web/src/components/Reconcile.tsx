import { useState } from "react";
import { getPeriod, syncNow } from "../lib/api";
import { daysBetween, brDate, brToday, type PeriodResult } from "../lib/period";
import { count, money } from "../lib/format";

type Row = { label: string; meta: number; panel: number; fmt: (v: number) => string };

// Conferência: compara o que o painel tem gravado com o Meta consultado agora, no mesmo período
export function Reconcile({ clientId, accountIds, since, until }: { clientId: string; accountIds: string[]; since: string; until: string }) {
  const [state, setState] = useState<"idle" | "checking" | "fixing">("idle");
  const [res, setRes] = useState<PeriodResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fixed, setFixed] = useState(false);

  async function check() {
    setState("checking"); setError(null);
    try { setRes(await getPeriod(clientId, since, until)); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setState("idle"); }
  }

  async function fix() {
    setState("fixing"); setError(null);
    try {
      const days = Math.min(daysBetween(since, brToday()), 90);
      for (const acc of accountIds) await syncNow({ accountId: acc, days });
      setFixed(true);
      setRes(await getPeriod(clientId, since, until));
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setState("idle"); }
  }

  const t = res?.totals, p = res?.panel;
  const rows: Row[] = t && p ? [
    { label: "Valor gasto", meta: t.spend, panel: p.spend, fmt: money },
    { label: "Impressões", meta: t.impressions, panel: p.impressions, fmt: count },
    { label: "Cliques no link", meta: t.link_clicks, panel: p.link_clicks, fmt: count },
    { label: "Conversas iniciadas", meta: t.conversations, panel: p.conversations, fmt: count },
    { label: "Leads", meta: t.leads, panel: p.leads, fmt: count },
  ] : [];
  const same = (r: Row) => Math.abs(r.meta - r.panel) < 0.005;
  const allOk = rows.length > 0 && rows.every(same);
  const balances = res?.accounts.filter((a) => a.balance) ?? [];

  return (
    <section className="card recon">
      <div className="recon-head">
        <div>
          <h2>Conferência com o Meta</h2>
          <p className="help">{brDate(since)} a {brDate(until)} · compara o painel com o Meta consultado agora, na mesma atribuição do Gerenciador.</p>
        </div>
        <button className="btn" onClick={check} disabled={state !== "idle"}>
          {state === "checking" ? "Consultando o Meta…" : res ? "Conferir de novo" : "Conferir agora"}
        </button>
      </div>

      {error && <div className="form-error" role="alert">{error}</div>}

      {res && (
        <>
          <div className={`recon-verdict ${allOk ? "ok" : "bad"}`}>
            {allOk
              ? `Tudo confere com o Meta${fixed ? " depois da correção" : ""}.`
              : "Há diferença entre o painel e o Meta neste período."}
            {!allOk && (
              <button className="btn small primary" onClick={fix} disabled={state !== "idle"}>
                {state === "fixing" ? "Recarregando do Meta…" : "Corrigir agora"}
              </button>
            )}
          </div>
          <div className="table-wrap"><table className="recon-table">
            <thead><tr><th>Métrica</th><th>Meta (agora)</th><th>Painel</th><th /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label}>
                  <td>{r.label}</td>
                  <td className="num">{r.fmt(r.meta)}</td>
                  <td className="num">{r.fmt(r.panel)}</td>
                  <td className={same(r) ? "recon-ok" : "recon-bad"}>{same(r) ? "confere" : `diferença de ${r.fmt(Math.abs(r.meta - r.panel))}`}</td>
                </tr>
              ))}
              {balances.map((a) => (
                <tr key={a.id}>
                  <td>Saldo disponível{balances.length > 1 ? ` · ${a.name ?? a.id}` : ""}</td>
                  <td className="num">{money(a.balance?.display_value ?? a.balance?.available ?? null)}</td>
                  <td className="muted" colSpan={2}>valor exibido pelo Meta agora (com impostos)</td>
                </tr>
              ))}
            </tbody>
          </table></div>
          {res.accounts.some((a) => a.error) && (
            <p className="err-text">{res.accounts.filter((a) => a.error).map((a) => `${a.id}: ${a.error}`).join(" · ")}</p>
          )}
        </>
      )}
    </section>
  );
}
