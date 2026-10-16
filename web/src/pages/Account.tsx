import { useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";

export function AccountPage({ email }: { email: string }) {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (pw.length < 8) return setMsg({ ok: false, text: "A senha precisa ter pelo menos 8 caracteres." });
    if (pw !== pw2) return setMsg({ ok: false, text: "As duas senhas não são iguais." });
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) return setMsg({ ok: false, text: error.message });
    setPw(""); setPw2("");
    setMsg({ ok: true, text: "Senha alterada. Use a nova senha no próximo acesso." });
  }

  return (
    <>
      <header className="page-head">
        <div>
          <p className="eyebrow"><span className="eyebrow-dot" />{email}</p>
          <h1>Minha conta</h1>
        </div>
      </header>
      <form className="card new-client" style={{ maxWidth: 440 }} onSubmit={submit}>
        <h2 style={{ marginBottom: 16 }}>Alterar senha</h2>
        <div style={{ display: "grid", gap: 14 }}>
          <div className="field">
            <label htmlFor="pw">Nova senha</label>
            <input id="pw" className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="pw2">Repita a nova senha</label>
            <input id="pw2" className="input" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
          </div>
          {msg && <div className={msg.ok ? "saved" : "form-error"} role="status">{msg.text}</div>}
          <button className="btn primary" type="submit" disabled={busy} style={{ justifySelf: "start" }}>
            {busy ? "Salvando…" : "Alterar senha"}
          </button>
        </div>
      </form>
    </>
  );
}
