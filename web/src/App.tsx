import { useEffect, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import type { Session } from "@supabase/supabase-js";
import { DEMO, supabase } from "./lib/supabase";
import { getRole, type Access } from "./lib/api";
import { AccessContext } from "./lib/role";
import { Layout } from "./components/Layout";
import { Login } from "./components/Login";
import { Today } from "./pages/Today";
import { ClientPage } from "./pages/Client";
import { AlertsPage } from "./pages/Alerts";
import { SettingsPage } from "./pages/Settings";
import { ClientsPage } from "./pages/Clients";
import { AccountPage } from "./pages/Account";
import { ReportsHub } from "./pages/ReportsHub";
import { ManagerPage } from "./pages/Manager";
import { CreativesPage } from "./pages/Creatives";
import { AutopilotPage } from "./pages/Autopilot";
import { MaterialsPage } from "./pages/Materials";
import { StrategyPage } from "./pages/Strategy";

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(DEMO ? null : undefined);
  const [access, setRole] = useState<Access | null | undefined>(undefined);
  const role = access === undefined ? undefined : access?.role ?? null;
  const member = role === undefined ? null : !!role;

  useEffect(() => {
    if (DEMO) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  const [denied, setDenied] = useState(false);

  useEffect(() => {
    if (DEMO) { getRole().then(setRole); return; }
    if (!session) return;
    setRole(undefined);
    getRole().then((r) => {
      setRole(r);
      if (!r) { setDenied(true); supabase.auth.signOut(); }
    });
  }, [session]);

  if (DEMO && role === undefined) return <div className="main loading">Carregando…</div>;
  if (!DEMO) {
    if (session === undefined) return <div className="main loading">Carregando…</div>;
    if (!session) return <Login notice={denied ? "Este e-mail não faz parte da equipe Impacto. Peça para ser adicionado." : undefined} />;
    if (!member) return <div className="main loading">Verificando acesso…</div>;
  }

  const email = DEMO ? "demonstração" : session?.user.email ?? "";
  const q = DEMO ? window.location.search : "";
  if (access && access.role === "copy") {
    // acesso restrito: só as áreas liberadas existem nas rotas
    const has = (a: string) => access.areas.includes(a);
    const home = has("criativos") ? "criativos" : access.areas[0] ?? "conta";
    return (
      <AccessContext.Provider value={access}>
        <BrowserRouter>
          <Routes>
            <Route element={<Layout email={email} />}>
              {has("criativos") && <Route path="criativos" element={<CreativesPage />} />}
              {has("estrategia") && <Route path="estrategia" element={<StrategyPage />} />}
              {has("relatorios") && <Route path="relatorios" element={<ReportsHub />} />}
              <Route path="conta" element={<AccountPage email={email} />} />
              <Route path="*" element={<Navigate to={`/${home}${q}`} replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </AccessContext.Provider>
    );
  }
  return (
    <AccessContext.Provider value={{ role: "admin", areas: [] }}>
    <BrowserRouter>
      <Routes>
        <Route element={<Layout email={email} />}>
          <Route index element={<Today />} />
          <Route path="cliente/:id" element={<ClientPage />} />
          <Route path="clientes" element={<ClientsPage />} />
          <Route path="criativos" element={<CreativesPage />} />
          <Route path="materiais" element={<MaterialsPage />} />
          <Route path="piloto" element={<AutopilotPage />} />
          <Route path="estrategia" element={<StrategyPage />} />
          <Route path="relatorios" element={<ReportsHub />} />
          <Route path="gerenciador" element={<ManagerPage />} />
          <Route path="alertas" element={<AlertsPage />} />
          <Route path="configuracoes" element={<SettingsPage />} />
          <Route path="conta" element={<AccountPage email={email} />} />
        </Route>
      </Routes>
    </BrowserRouter>
    </AccessContext.Provider>
  );
}
