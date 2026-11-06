import { createContext, useContext } from "react";
import type { Access, Role } from "./api";

export const AccessContext = createContext<Access>({ role: "admin", areas: [] });
export const useAccess = () => useContext(AccessContext);
export const useRole = (): Role => useContext(AccessContext).role;
// páginas que um acesso restrito pode abrir (as áreas liberadas + trocar a senha)
export const pagesOf = (a: Access) => [...a.areas, "conta"];
