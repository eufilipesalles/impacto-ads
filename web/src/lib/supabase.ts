import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

// Modo demonstração (?demo na URL): usa dados fictícios, sem login. Só para conferência visual.
export const DEMO = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("demo");

export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true },
});

export const FUNCTIONS_URL = `${url}/functions/v1`;
