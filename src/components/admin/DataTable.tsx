import { ReactNode } from "react";

export function DataTable({ columns, rows, empty }: { columns: string[]; rows: ReactNode[][]; empty?: string }) {
  return (
    <div className="glass liquid-border overflow-x-auto rounded-2xl">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-border/60 text-muted-foreground">
            {columns.map((c) => <th key={c} className="whitespace-nowrap px-4 py-3 font-semibold">{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={columns.length} className="px-4 py-10 text-center text-muted-foreground">{empty ?? "Aucune donnée"}</td></tr>
          ) : rows.map((r, i) => (
            <tr key={i} className="border-b border-border/30 transition-colors hover:bg-muted/30">
              {r.map((cell, j) => <td key={j} className="whitespace-nowrap px-4 py-3">{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function StateChip({ state }: { state: string }) {
  const tone =
    ["succeeded", "ejected", "active_rental", "closed", "battery_taken", "battery_returned"].includes(state) ? "bg-success/15 text-success" :
    ["eject_failed", "needs_support", "payment_cancelled", "payment_expired", "error"].includes(state) ? "bg-destructive/15 text-destructive" :
    "bg-muted text-muted-foreground";
  return <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${tone}`}>{state}</span>;
}
