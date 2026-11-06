import { createContext, useContext } from "react";
import type { Role } from "./api";

export const RoleContext = createContext<Role>("admin");
export const useRole = () => useContext(RoleContext);
// páginas liberadas para o time de copy
export const COPY_PAGES = ["criativos", "estrategia", "conta"];
