import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { createNewClient, getClientsWithAccounts, parseAccountId, syncNow, type ClientWithAccounts } from "../lib/api";
import { useAsync } from "../lib/hooks";
import { money, timeAgo } from "../lib/format";
import { OBJECTIVE_LABEL, type AdAccount, type Objective } from "../lib/types";
import { DEMO } from "../lib/supabase";

const fromInput = (s: string) => {
  const t = s.trim().replace(/\./g, "").replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : NaN;
};

function accountStatus(a: AdAccount): { label: string; tone: "ok" | "crit" | "muted" } {
  if (a.last_sync_error) {
    const perm = a.last_sync_error.includes("#200") || a.last_sync_error.toLowerCase().includes("permission");
    return { label: perm ? "Sem permissão no Meta" : "Erro na coleta", tone: "crit" };
  }
  if (!a.last_synced_at) return { label: "Aguardando primeira coleta", tone: "muted" };
  return { label: `Lendo dados · ${timeAgo(a.last_synced_at)}`, tone: "ok" };
}

type Result = { name: string; id: string; ok: boolean; message: string };

export function ClientsPage() {
  const nav = useNavigate();
  const q = DEMO ? "?demo" : "";
  const list = useAsync(getClientsWithAccounts, []);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", objective: "conversas_whatsapp" as Objective, accounts: "", budget: "", ceiling: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "saving" | "syncing">(null);
  const [result, setResult] = useState<Result | null>(null);

  const rows = list.data ?? [];
  const parsed = form.accounts.split(/[\n,;\s]+/).filter(Boolean);
  const ids = parsed.map(parseAccountId);
  const invalid = parsed.filter((_, i) => !ids[i]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const budget = fromInput(form.budget), ceiling = fromInput(form.ceiling);
    if (!form.name.trim()) return setError("Informe o nome do cliente.");
    if (!parsed.length) return setError("Informe o ID de pelo menos uma conta de anúncios.");
    if (invalid.length) return setError(`ID de conta inválido: ${invalid.join(", ")}. Use só os números da conta.`);
    if (Number.isNaN(budget) || Number.isNaN(ceiling)) return setError("Verba e teto: use só números, ex.: 1500 ou 12,50.");

    const accounts = [...new Set(ids as string[])];
    setBusy("saving");
    try {
      const id = await createNewClient({ name: form.name, objective: form.objective, monthly_budget: budget, ceiling, accounts });
      setBusy("syncing");
      let ok = true, message = "Dados dos últimos 90 dias carregados.";
      for (const acc of accounts) {
        try {
          const r = await syncNow({ accountId: acc, days: 90 });
          if (r.err) {
            ok = false;
            const perm = r.errors.some((m) => m.includes("#200") || m.toLowerCase().includes("permission"));
            message = perm
              ? "Cliente cadastrado, mas o Meta recusou o acesso à conta. Atribua a conta ao usuário do sistema no Business Manager e clique em “Atualizar agora”."
              : `Cliente cadastrado, mas a coleta falhou: ${r.errors[0]}`;
          }
        } catch (err) {
          ok = false;
          message = `Cliente cadastrado, mas a coleta falhou: ${err instanceof Error ? err.message : err}`;
        }
      }
      setResult({ name: form.name.trim(), id, ok, message });
      setForm({ name: "", objective: "conversas_whatsapp", accounts: "", budget: "", ceiling: "" });
      setOpen(false);
      list.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <header className="page-head">
        <div>
          <p className="eyebrow"><span className="eyebrow-dot" />Carteira da Impacto</p>
          <h1>Clientes</h1>
          <p className="sub">{rows.length} cadastrados · {rows.filter((r) => r.active).length} ativos</p>
        </div>
        {!open && <button className="btn primary" onClick={() => { setOpen(true); setResult(null); }}>Novo cliente</button>}
      </header>

      {result && (
        <div className={`card notice ${result.ok ? "ok" : "warn"}`} role="status">
          <div>
            <strong>{result.name}</strong> foi cadastrado. {result.message}
          </div>
          {result.ok && <button className="btn small" onClick={() => nav(`/cliente/${result.id}${q}`)}>Abrir cliente</button>}
        </div>
      )}

      {open && (
        <form className="card new-client" onSubmit={submit}>
          <div className="nc-head">
            <h2>Novo cliente</h2>
            <button type="button" className="btn small" onClick={() => { setOpen(false); setError(null); }}>Cancelar</button>
          </div>
          <div className="nc-grid">
            <div className="field span-2">
              <label htmlFor="nc-name">Nome do cliente</label>
              <input id="nc-name" className="input" required value={form.name} autoFocus
                onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ex.: Clínica Sorriso" />
            </div>
            <div className="field">
              <label htmlFor="nc-obj">Objetivo principal</label>
              <select id="nc-obj" className="select" value={form.objective}
                onChange={(e) => setForm({ ...form, objective: e.target.value as Objective })}>
                {Object.entries(OBJECTIVE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div className="field span-3">
              <label htmlFor="nc-acc">ID da conta de anúncios</label>
              <textarea id="nc-acc" className="input money" rows={2} value={form.accounts}
                onChange={(e) => setForm({ ...form, accounts: e.target.value })} placeholder="1505648210970850" />
              <span className="help">
                Está no Gerenciador de Anúncios, ao lado do nome da conta. Mais de uma conta? Uma por linha.
                {parsed.length > 0 && !invalid.length && <> · <b>{parsed.length === 1 ? "1 conta" : `${parsed.length} contas`}</b></>}
                {invalid.length > 0 && <> · <b className="err-text">ID inválido: {invalid.join(", ")}</b></>}
              </span>
            </div>
            <div className="field">
              <label htmlFor="nc-budget">Verba mensal (R$) <span className="opt">opcional</span></label>
              <input id="nc-budget" className="input money" inputMode="decimal" value={form.budget}
                onChange={(e) => setForm({ ...form, budget: e.target.value })} placeholder="1500" />
            </div>
            <div className="field">
              <label htmlFor="nc-ceiling">Teto de custo por conversa (R$) <span className="opt">opcional</span></label>
              <input id="nc-ceiling" className="input money" inputMode="decimal" value={form.ceiling}
                onChange={(e) => setForm({ ...form, ceiling: e.target.value })} placeholder="15,00" />
            </div>
          </div>
          <div className="nc-foot">
            <p className="help">
              Antes de salvar, atribua a conta ao usuário do sistema <b>Impacto Ads Sync</b> no Business Manager.
              Ao salvar, o painel já busca os últimos 90 dias.
            </p>
            {error && <div className="form-error" role="alert">{error}</div>}
            <button className="btn primary" type="submit" disabled={busy !== null}>
              {busy === "saving" ? "Salvando…" : busy === "syncing" ? "Buscando dados do Meta…" : "Cadastrar cliente"}
            </button>
          </div>
        </form>
      )}

      <section className="section">
        <div className="card table-wrap">
          {list.error && <div className="empty err-text">{list.error}</div>}
          <table>
            <thead>
              <tr>
                <th>Cliente</th>
                <th style={{ textAlign: "left" }}>Conta de anúncios</th>
                <th style={{ textAlign: "left" }}>Coleta</th>
                <th className="hide-sm">Verba mensal</th>
                <th className="hide-sm">Cadastrado</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c: ClientWithAccounts) => {
                const go = () => c.active && nav(`/cliente/${c.id}${q}`);
                return (
                  <tr key={c.id} className={c.active ? "link" : "inactive"} onClick={go} tabIndex={c.active ? 0 : -1}
                    onKeyDown={(e) => e.key === "Enter" && go()}>
                    <td>
                      <div className="client-cell">
                        <span className={`lamp ${c.active ? "green" : "gray"}`} aria-label={c.active ? "ativo" : "inativo"} />
                        <div>
                          <div className="client-name">{c.name}</div>
                          <div className="client-obj">{OBJECTIVE_LABEL[c.objective]}{!c.active && " · inativo"}</div>
                        </div>
                      </div>
                    </td>
                    <td style={{ textAlign: "left" }}>
                      {c.accounts.map((a) => (
                        <div key={a.id} className="acc-line">
                          <span className="num">{a.id.replace("act_", "")}</span>
                          {a.name && <span className="muted"> · {a.name.trim()}</span>}
                        </div>
                      ))}
                    </td>
                    <td style={{ textAlign: "left" }}>
                      {c.accounts.map((a) => {
                        const s = accountStatus(a);
                        return <div key={a.id} className={`acc-status ${s.tone}`}>{s.label}</div>;
                      })}
                    </td>
                    <td className="num hide-sm">{money(c.monthly_budget)}</td>
                    <td className="hide-sm muted">{new Date(c.created_at).toLocaleDateString("pt-BR")}</td>
                  </tr>
                );
              })}
              {!list.loading && rows.length === 0 && (
                <tr><td colSpan={5} className="empty">Nenhum cliente cadastrado. Clique em “Novo cliente” para começar.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
