import type { AdAccount } from "./types";

// Saldo disponível do cliente: saldo pré-pago informado pelo Meta ou, se não houver, o que resta do limite de gastos
export function clientBalance(accounts: AdAccount[], clientId: string): number | null {
  let total: number | null = null;
  for (const a of accounts) {
    if (a.client_id !== clientId) continue;
    const v = a.prepaid_balance ?? (a.spend_cap && a.spend_cap > 0 ? a.spend_cap - (a.amount_spent ?? 0) : null);
    if (v !== null) total = (total ?? 0) + Math.max(v, 0);
  }
  return total;
}

export type FuelLevel = "ok" | "warn" | "crit" | "none";

// Quantos dias o saldo dura no ritmo de gasto dos últimos 7 dias
export function fuel(balance: number | null, spend7d: number) {
  if (balance === null) return { days: null as number | null, level: "none" as FuelLevel };
  if (balance <= 0) return { days: 0, level: "crit" as FuelLevel };
  const perDay = spend7d / 7;
  if (perDay <= 0) return { days: null, level: "none" as FuelLevel };
  const days = balance / perDay;
  return { days, level: (days <= 1.5 ? "crit" : days <= 4 ? "warn" : "ok") as FuelLevel };
}

export function syncError(accounts: AdAccount[], clientId: string): string | null {
  const err = accounts.find((a) => a.client_id === clientId && a.last_sync_error)?.last_sync_error ?? null;
  if (!err) return null;
  if (err.includes("#200") || err.toLowerCase().includes("permission")) return "Sem permissão no Meta";
  if (err.includes("(190)")) return "Token do Meta inválido";
  return "Erro na coleta";
}
