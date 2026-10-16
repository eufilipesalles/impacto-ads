import type { AdAccount } from "./types";

// Saldo do cliente em duas formas (conferido contra o Meta em 16/10/2026):
//  - meta: o "Saldo disponível" exibido pelo Meta, com impostos — é o número do Gerenciador
//  - net:  depositado − gasto, sem impostos — mesma base do gasto diário, usado para estimar a duração
export function clientBalance(accounts: AdAccount[], clientId: string): { meta: number | null; net: number | null; updatedAt: string | null } {
  let meta: number | null = null, net: number | null = null, updatedAt: string | null = null;
  for (const a of accounts) {
    if (a.client_id !== clientId) continue;
    if (a.prepaid_balance !== null) meta = (meta ?? 0) + Math.max(a.prepaid_balance, 0);
    if (a.spend_cap && a.spend_cap > 0) net = (net ?? 0) + Math.max(a.spend_cap - (a.amount_spent ?? 0), 0);
    const u = a.balance_updated_at ?? a.last_synced_at;
    if (u && (!updatedAt || u < updatedAt)) updatedAt = u;
  }
  if (meta === null && net !== null) meta = net;
  return { meta, net: net ?? meta, updatedAt };
}

export type FuelLevel = "ok" | "warn" | "crit" | "none";

// Quantos dias o saldo dura no ritmo de gasto dos últimos 7 dias (os dois sem impostos)
export function fuel(net: number | null, spend7d: number) {
  if (net === null) return { days: null as number | null, level: "none" as FuelLevel };
  if (net <= 0) return { days: 0, level: "crit" as FuelLevel };
  const perDay = spend7d / 7;
  if (perDay <= 0) return { days: null, level: "none" as FuelLevel };
  const days = net / perDay;
  return { days, level: (days <= 1.5 ? "crit" : days <= 4 ? "warn" : "ok") as FuelLevel };
}

export function syncError(accounts: AdAccount[], clientId: string): string | null {
  const err = accounts.find((a) => a.client_id === clientId && a.last_sync_error)?.last_sync_error ?? null;
  if (!err) return null;
  if (err.includes("#200") || err.toLowerCase().includes("permission")) return "Sem permissão no Meta";
  if (err.includes("(190)")) return "Token do Meta inválido";
  return "Erro na coleta";
}
