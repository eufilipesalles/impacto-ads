import { useEffect, useState } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import type { Session } from "@supabase/supabase-js";
import { DEMO, supabase } from "./lib/supabase";
import { isTeamMember } from "./lib/api";
import { Layout } from "./components/Layout";
import { Login } from "./components/Login";
import { Today } from "./pages/Today";
import { ClientPage } from "./pages/Client";
import { AlertsPage } from "./pages/Alerts";
import { SettingsPage } from "./pages/Settings";
import { ClientsPage } from "./pages/Clients";
import { AccountPage } from "./pages/Account";
import { ReportsPage } from "./pages/Reports";
import { CreativesPage } from "./pages/Creatives";

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(DEMO ? null : undefined);
  const [member, setMember] = useState<boolean | null>(DEMO ? true : null);

  useEffect(() => {
    if (DEMO) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  const [denied, setDenied] = useState(false);

  useEffect(() => {
    if (DEMO || !session) return;
    setMember(null);
    isTeamMember().then((ok) => {
      setMember(ok);
      if (!ok) { setDenied(true); supabase.auth.signOut(); }
    });
  }, [session]);

  if (!DEMO) {
    if (session === undefined) return <div className="main loading">Carregando…</div>;
    if (!session) return <Login notice={denied ? "Este e-mail não faz parte da equipe Impacto. Peça para ser adicionado." : undefined} />;
    if (!member) return <div className="main loading">Verificando acesso…</div>;
  }

  const email = DEMO ? "demonstração" : session?.user.email ?? "";
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout email={email} />}>
          <Route index element={<Today />} />
          <Route path="cliente/:id" element={<ClientPage />} />
          <Route path="clientes" element={<ClientsPage />} />
          <Route path="criativos" element={<CreativesPage />} />
          <Route path="relatorios" element={<ReportsPage />} />
          <Route path="alertas" element={<AlertsPage />} />
          <Route path="configuracoes" element={<SettingsPage />} />
          <Route path="conta" element={<AccountPage email={email} />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
