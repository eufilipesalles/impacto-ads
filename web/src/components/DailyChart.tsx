import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { DailyPoint } from "../lib/types";
import { count, dayLabel, money } from "../lib/format";

export function DailyChart({ data, height = 280, compact = false, line = "conversations" }: { data: DailyPoint[]; height?: number; compact?: boolean; line?: "conversations" | "purchases" | "leads" | "link_clicks" }) {
  const lineLabel = { purchases: "Compras", conversations: "Conversas", leads: "Leads", link_clicks: "Cliques no link" }[line];
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 6, right: compact ? 4 : 8, bottom: 0, left: compact ? 4 : 0 }}>
        {!compact && <CartesianGrid vertical={false} stroke="var(--line)" />}
        <XAxis dataKey="date" tickFormatter={dayLabel} tick={{ fontSize: 11, fill: "var(--muted)" }}
          axisLine={false} tickLine={false} minTickGap={24} hide={compact} />
        <YAxis yAxisId="s" hide={compact} tick={{ fontSize: 11, fill: "var(--muted)" }} axisLine={false} tickLine={false}
          width={56} tickFormatter={(v) => `R$${v}`} />
        <YAxis yAxisId="c" orientation="right" hide={compact} tick={{ fontSize: 11, fill: "var(--muted)" }}
          axisLine={false} tickLine={false} width={32} allowDecimals={false} />
        <Tooltip
          cursor={{ fill: "var(--surface-2)" }}
          contentStyle={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 8, fontSize: 13 }}
          labelFormatter={(l) => dayLabel(String(l))}
          formatter={(v: number, n) => (n === "spend" ? [money(v), "Gasto"] : [count(v), lineLabel])}
        />
        <Bar yAxisId="s" dataKey="spend" fill="var(--chart-spend)" radius={[3, 3, 0, 0]} maxBarSize={22} />
        <Line yAxisId="c" dataKey={line} stroke="var(--chart-conv)" strokeWidth={2.5} dot={false} type="linear" />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
