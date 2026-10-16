import { fuel } from "../lib/balance";
import { money } from "../lib/format";

// Assinatura do painel: quantos dias o saldo pré-pago ainda dura no ritmo atual
export function Fuel({ balance, spend7d }: { balance: number | null; spend7d: number }) {
  if (balance === null) return <span className="muted">—</span>;
  const f = fuel(balance, spend7d);

  let big: string, unit = "";
  if (f.days === 0) big = "zerado";
  else if (f.days === null) big = "sem gasto";
  else if (f.days < 1) { big = "<1"; unit = "dia"; }
  else if (f.days >= 30) { big = "30+"; unit = "dias"; }
  else { const n = Math.floor(f.days); big = String(n); unit = n === 1 ? "dia" : "dias"; }

  const width = f.days === null ? 100 : Math.min(f.days / 14, 1) * 100;
  return (
    <div title="Quanto tempo o saldo dura no ritmo de gasto dos últimos 7 dias">
      <div className={`fuel ${f.level}`}>
        <span className="fuel-days">{big}</span>
        {unit && <span className="fuel-unit">{unit}</span>}
      </div>
      <div className="gauge"><i style={{ width: `${width}%` }} /></div>
      <div className="fuel-sub">{money(balance)}</div>
    </div>
  );
}
