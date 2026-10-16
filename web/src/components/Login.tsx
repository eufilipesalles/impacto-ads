import { useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";
import { BrandMark } from "./Layout";

const BARS = [22, 30, 26, 41, 35, 48, 44, 39, 57, 52, 61, 49, 66, 72, 58, 80, 74, 88];

export function Login({ notice }: { notice?: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(notice ?? null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) setError(error.message === "Invalid login credentials" ? "E-mail ou senha incorretos." : error.message);
    setBusy(false);
  }

  return (
    <div className="login">
      <section className="login-art">
        <div className="brand"><BrandMark /><span className="brand-name">Impacto <span>Ads</span></span></div>
        <div>
          <h1>Todas as contas, uma olhada por dia.</h1>
          <p>Gasto, conversas, saldo e problemas de cada cliente da Impacto, atualizados às 6h e às 12h direto do Meta.</p>
        </div>
        <div className="bars" aria-hidden="true">
          {BARS.map((h, i) => <i key={i} className={i === BARS.length - 1 ? "hot" : ""} style={{ height: `${h}%` }} />)}
        </div>
      </section>
      <section className="login-form">
        <form onSubmit={submit}>
          <h2>Entrar</h2>
          <div className="field">
            <label htmlFor="email">E-mail</label>
            <input id="email" className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="password">Senha</label>
            <input id="password" className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          {error && <div className="form-error" role="alert">{error}</div>}
          <button className="btn primary" type="submit" disabled={busy} style={{ justifyContent: "center", padding: "11px" }}>
            {busy ? "Entrando…" : "Entrar"}
          </button>
        </form>
      </section>
    </div>
  );
}
