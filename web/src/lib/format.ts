const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const int = new Intl.NumberFormat("pt-BR");
const dec = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export const money = (v: number | null | undefined) => (v === null || v === undefined ? "—" : brl.format(v));
export const moneyShort = (v: number) =>
  v >= 1000 ? `R$ ${dec.format(v / 1000)} mil` : brl.format(v);
export const count = (v: number | null | undefined) => (v === null || v === undefined ? "—" : int.format(v));
export const pct = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${dec.format(v)}%`);
export const one = (v: number | null | undefined) => (v === null || v === undefined ? "—" : dec.format(v));

export function dayLabel(iso: string) {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

export function timeAgo(iso: string | null) {
  if (!iso) return "nunca";
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  return `há ${Math.round(h / 24)} d`;
}

// Variação do custo por conversa: positivo = ficou mais caro (ruim)
export function costDelta(now: number | null, prev: number | null) {
  if (!now || !prev) return null;
  return ((now - prev) / prev) * 100;
}

export function todayLong() {
  return new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "long" }).format(new Date());
}
