import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getClients, getRules, saveClient, saveCostCeiling } from "../lib/api";
import { useAsync } from "../lib/hooks";
import { OBJECTIVE_LABEL, type ClientRow, type Objective } from "../lib/types";

type Draft = { objective: Objective; budget: string; ceiling: string; active: boolean };

const toInput = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v).replace(".", ","));
const fromInput = (s: string) => {
  const t = s.trim().replace(/\./g, "").replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : NaN;
};

export function SettingsPage() {
  const clients = useAsync(getClients, []);
  const rules = useAsync(getRules, []);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [state, setState] = useState<Record<string, "saving" | "saved" | string>>({});

  useEffect(() => {
    if (!clients.data || !rules.data) return;
    const ceilings = Object.fromEntries(rules.data.filter((r) => r.type === "cost_per_conversation" && r.client_id)
      .map((r) => [r.client_id as string, r.threshold]));
    setDrafts(Object.fromEntries(clients.data.map((c) => [c.id, {
      objective: c.objective, budget: toInput(c.monthly_budget), ceiling: toInput(ceilings[c.id]), active: c.active,
    }])));
  }, [clients.data, rules.data]);

  function set(id: string, patch: Partial<Draft>) {
    setDrafts((d) => ({ ...d, [id]: { ...d[id], ...patch } }));
    setState((s) => ({ ...s, [id]: "" }));
  }

  async function save(c: ClientRow) {
    const d = drafts[c.id];
    const budget = fromInput(d.budget), ceiling = fromInput(d.ceiling);
    if (Number.isNaN(budget) || Number.isNaN(ceiling)) {
      setState((s) => ({ ...s, [c.id]: "Use só números, ex.: 1500 ou 12,50" }));
      return;
    }
    setState((s) => ({ ...s, [c.id]: "saving" }));
    try {
      await saveClient({ id: c.id, objective: d.objective, monthly_budget: budget, active: d.active });
      await saveCostCeiling(c.id, ceiling);
      setState((s) => ({ ...s, [c.id]: "saved" }));
    } catch (e) {
      setState((s) => ({ ...s, [c.id]: e instanceof Error ? e.message : "Não foi possível salvar" }));
    }
  }

  return (
    <>
      <header className="page-head">
        <div>
          <p className="eyebrow">Clientes e limites dos alertas</p>
          <h1>Configurações</h1>
          <p className="sub">A verba mensal ativa o alerta de ritmo de gasto. O teto de custo por conversa ativa o alerta de custo (média dos últimos 3 dias).</p>
        </div>
      </header>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr><th>Cliente</th><th style={{ textAlign: "left" }}>Objetivo</th><th style={{ textAlign: "left" }}>Verba mensal (R$)</th>
              <th style={{ textAlign: "left" }}>Teto custo/conversa (R$)</th><th style={{ textAlign: "left" }}>Ativo</th><th /></tr>
          </thead>
          <tbody>
            {(clients.data ?? []).map((c) => {
              const d = drafts[c.id];
              if (!d) return null;
              const st = state[c.id];
              return (
                <tr key={c.id} className="cfg-row">
                  <td className="client-name">{c.name}</td>
                  <td style={{ textAlign: "left", minWidth: 190 }}>
                    <select className="select" aria-label={`Objetivo de ${c.name}`} value={d.objective}
                      onChange={(e) => set(c.id, { objective: e.target.value as Objective })}>
                      {Object.entries(OBJECTIVE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </td>
                  <td style={{ textAlign: "left", minWidth: 130 }}>
                    <input className="input money" inputMode="decimal" aria-label={`Verba mensal de ${c.name}`} placeholder="sem verba"
                      value={d.budget} onChange={(e) => set(c.id, { budget: e.target.value })} />
                  </td>
                  <td style={{ textAlign: "left", minWidth: 130 }}>
                    <input className="input money" inputMode="decimal" aria-label={`Teto de custo por conversa de ${c.name}`} placeholder="sem teto"
                      value={d.ceiling} onChange={(e) => set(c.id, { ceiling: e.target.value })} />
                  </td>
                  <td style={{ textAlign: "left" }}>
                    <label className="switch"><input type="checkbox" checked={d.active} onChange={(e) => set(c.id, { active: e.target.checked })} />{d.active ? "Sim" : "Não"}</label>
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button className="btn small" onClick={() => save(c)} disabled={st === "saving"}>{st === "saving" ? "Salvando…" : "Salvar"}</button>
                    <div style={{ minHeight: 18, marginTop: 4 }}>
                      {st === "saved" ? <span className="saved">Salvo</span> : st && st !== "saving" ? <span className="err-text">{st}</span> : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="sub" style={{ marginTop: 14 }}>Os alertas são recalculados na próxima coleta (6h e 12h) ou quando você clica em “Atualizar agora”. · <Link to="/conta">Alterar minha senha</Link></p>
    </>
  );
}
