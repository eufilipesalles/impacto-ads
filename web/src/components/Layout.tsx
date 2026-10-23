import { NavLink, Outlet } from "react-router-dom";
import { supabase, DEMO } from "../lib/supabase";
import { useAsync } from "../lib/hooks";
import { getAlerts } from "../lib/api";

export function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="#ffffff" fillOpacity="0.08" />
      <rect x="7" y="17" width="4" height="8" rx="1" fill="#fff" fillOpacity="0.55" />
      <rect x="14" y="11" width="4" height="14" rx="1" fill="#fff" />
      <rect x="21" y="6" width="4" height="19" rx="1" fill="#FF6B00" />
    </svg>
  );
}

export function Layout({ email }: { email: string }) {
  const { data: alerts } = useAsync(() => getAlerts("open"), []);
  const critical = (alerts ?? []).filter((a) => a.severity === "critical").length;
  const q = DEMO ? "?demo" : "";
  const links = [
    { to: `/${q}`, label: "Hoje", end: true },
    { to: `/clientes${q}`, label: "Clientes" },
    { to: `/criativos${q}`, label: "Criativos" },
    { to: `/relatorios${q}`, label: "Relatórios" },
    { to: `/alertas${q}`, label: "Alertas", badge: critical },
    { to: `/configuracoes${q}`, label: "Configurações" },
  ];

  return (
    <div className="shell">
      <aside className="side">
        <div className="brand"><BrandMark /><span className="brand-name">Impacto <span>Ads</span></span></div>
        <nav className="nav">
          {links.map((l) => (
            <NavLink key={l.label} to={l.to} end={l.end} className={({ isActive }) => (isActive ? "active" : "")}>
              {l.label}
              {l.badge ? <span className="pill">{l.badge}</span> : null}
            </NavLink>
          ))}
        </nav>
        <div className="side-foot">
          <span>{email}</span>
          <NavLink to={`/conta${q}`} style={{ color: "#b5b1ac" }}>Alterar senha</NavLink>
          {!DEMO && <button onClick={() => supabase.auth.signOut()}>Sair</button>}
        </div>
      </aside>
      <div>
        <div className="mobile-bar">
          <div className="brand"><BrandMark /><span className="brand-name">Impacto <span>Ads</span></span></div>
          <nav>
            {links.map((l) => (
              <NavLink key={l.label} to={l.to} end={l.end} className={({ isActive }) => (isActive ? "active" : "")}>
                {l.label}{l.badge ? ` (${l.badge})` : ""}
              </NavLink>
            ))}
          </nav>
        </div>
        <main className="main"><Outlet /></main>
      </div>
    </div>
  );
}
