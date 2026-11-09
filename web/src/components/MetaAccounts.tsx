// Contas de anúncios que o sistema já enxerga no Meta: as que faltam entram com um clique (e as novas entram sozinhas todo dia)
import { useState } from "react";
import { DEMO, FUNCTIONS_URL, supabase } from "../lib/supabase";
import { money } from "../lib/format";
import type { ClientRow } from "../lib/types";

interface Found { id: string; name: string; status_text: string; account_status: number | null; amount_spent: number; in_system: boolean; client_name: string | null; ignored: boolean }
interface Discovery { accounts: Found[]; lost: { id: string; client_name: string | null }[]; errors: string[] }

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data: s } = await supabase.auth.getSession();
  const res = await fetch(`${FUNCTIONS_URL}/accounts`, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${s.session?.access_token ?? ""}` }, body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error ?? `Falha (${res.status})`);
  return j as T;
}
const DEMO_DATA: Discovery = { errors: [], lost: [], accounts: [
  { id: "act_1", name: "C.A Palácio das Delícias", status_text: "Ativa", account_status: 1, amount_spent: 0, in_system: false, client_name: null, ignored: true },
  { id: "act_2", name: "CA - Dra. Maria", status_text: "Ativa", account_status: 1, amount_spent: 6041.57, in_system: true, client_name: "Dra. Maria Salmón", ignored: false },
] };

export function MetaAccounts({ clients, onChange }: { clients: ClientRow[]; onChange: () => void }) {
  const [data, setData] = useState<Discovery | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [target, setTarget] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setBusy("load"); setErr(null);
    try { setData(DEMO ? DEMO_DATA : await call<Discovery>({ action: "discover" })); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  }
  async function add(a: Found) {
    setBusy(a.id); setErr(null);
    try {
      const t = target[a.id] ?? "";
      if (!DEMO) await call({ action: "import", accounts: [{ id: a.id, name: a.name, ...(t ? { client_id: t } : {}) }] });
      await load(); onChange();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setBusy(null); }
  }
  async function ignore(a: Found, ignored: boolean) {
    setBusy(a.id);
    try { if (!DEMO) await call({ action: "ignore", id: a.id, name: a.name, ignored }); await load(); }
    finally { setBusy(null); }
  }

  const missing = (data?.accounts ?? []).filter((a) => !a.in_system);
  const inSys = (data?.accounts ?? []).filter((a) => a.in_system).length;
  return (
    <section className="card" style={{ marginBottom: 18, padding: "16px 18px" }}>
      <div className="rep-head">
        <div>
          <h3 style={{ margin: 0 }}>Contas do Meta</h3>
          <span className="muted">Toda conta liberada para o sistema no Meta entra sozinha todo dia às 5h50, com o cliente criado pelo nome da conta. Aqui você vê e adiciona na hora.</span>
        </div>
        <button className="btn small" onClick={load} disabled={!!busy}>{busy === "load" ? "Buscando no Meta…" : data ? "Buscar de novo" : "Buscar contas no Meta"}</button>
      </div>
      {err && <p className="err-text">{err}</p>}
      {data && (
        <>
          <p className="muted" style={{ margin: "4px 0 10px" }}>{inSys} conta(s) já no sistema · {missing.length} fora dele</p>
          {missing.length === 0 && <p>Todas as contas que o sistema enxerga já estão cadastradas.</p>}
          {missing.map((a) => (
            <div key={a.id} className="acc-row">
              <div>
                <b>{a.name}</b>
                <div className="muted">{a.id.replace("act_", "")} · {a.status_text} · {money(a.amount_spent)} gastos no total{a.ignored ? " · fora da entrada automática" : ""}</div>
              </div>
              <select className="select" value={target[a.id] ?? ""} onChange={(e) => setTarget((t) => ({ ...t, [a.id]: e.target.value }))} aria-label={`Cliente da conta ${a.name}`}>
                <option value="">Criar cliente novo</option>
                {clients.map((c) => <option key={c.id} value={c.id}>Juntar a {c.name}</option>)}
              </select>
              <button className="btn small primary" onClick={() => add(a)} disabled={!!busy}>{busy === a.id ? "Adicionando…" : "Adicionar"}</button>
              <button className="link-btn" onClick={() => ignore(a, !a.ignored)} disabled={!!busy}>{a.ignored ? "deixar entrar sozinha" : "não adicionar"}</button>
            </div>
          ))}
          {data.lost.length > 0 && (
            <p className="warn-text">Sem acesso no Meta: {data.lost.map((l) => l.client_name ?? l.id).join(", ")}. Peça ao cliente para liberar a conta para a BM da Impacto e atribuir ao usuário do sistema.</p>
          )}
        </>
      )}
    </section>
  );
}
