import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";

function Card({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="glass liquid-border rounded-2xl p-5">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className={`mt-1 text-3xl font-bold ${tone ?? ""}`}>{value}</div>
    </div>
  );
}

type SettlementRow = {
  id: string;
  public_session_code: string | null;
  station_id: string;
  state: string;
  settlement_status: string | null;
  settlement_attempts: number | null;
  settlement_error: string | null;
  failure_code: string | null;
  final_amount_cents: number | null;
  currency: string | null;
  returned_at: string | null;
  updated_at: string;
};

export default function AdminRentalFlowHealth() {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [lastWebhook, setLastWebhook] = useState<string | null>(null);
  const [lastCn, setLastCn] = useState<string | null>(null);
  const [webhookErrors, setWebhookErrors] = useState(0);
  const [settlementRows, setSettlementRows] = useState<SettlementRow[]>([]);
  const [settlementFailed, setSettlementFailed] = useState(0);
  const [settlementWorking, setSettlementWorking] = useState(0);

  const load = useCallback(async () => {
    const { data: sessions } = await supabase.from("rental_sessions").select("state");
    const c: Record<string, number> = {};
    (sessions ?? []).forEach((s: { state: string }) => { c[s.state] = (c[s.state] ?? 0) + 1; });
    setCounts(c);

    const { data: wh } = await supabase.from("webhook_events").select("created_at").eq("provider", "stripe").order("created_at", { ascending: false }).limit(1);
    setLastWebhook((wh?.[0] as { created_at?: string })?.created_at ?? null);

    const { data: cnLog } = await supabase.from("api_logs").select("created_at").eq("service", "chargenow").is("error", null).order("created_at", { ascending: false }).limit(1);
    setLastCn((cnLog?.[0] as { created_at?: string })?.created_at ?? null);

    const { count } = await supabase.from("api_logs").select("*", { count: "exact", head: true }).eq("service", "stripe").not("error", "is", null);
    setWebhookErrors(count ?? 0);

    const [{ count: failed }, { count: working }, { data: rows }] = await Promise.all([
      supabase.from("rental_sessions").select("id", { count: "exact", head: true }).in("settlement_status", ["failed", "manual_review", "supplemental_required"]),
      supabase.from("rental_sessions").select("id", { count: "exact", head: true }).eq("settlement_status", "settling"),
      supabase.from("rental_sessions")
        .select("id,public_session_code,station_id,state,settlement_status,settlement_attempts,settlement_error,failure_code,final_amount_cents,currency,returned_at,updated_at")
        .in("settlement_status", ["failed", "manual_review", "supplemental_required", "settling"])
        .order("updated_at", { ascending: false })
        .limit(12),
    ]);
    setSettlementFailed(failed ?? 0);
    setSettlementWorking(working ?? 0);
    setSettlementRows((rows ?? []) as SettlementRow[]);
  }, []);

  useEffect(() => { void load(); const i = setInterval(() => void load(), 10000); return () => clearInterval(i); }, [load]);

  const sum = (keys: string[]) => keys.reduce((a, k) => a + (counts[k] ?? 0), 0);
  const fmt = (d: string | null) => (d ? new Date(d).toLocaleString("fr-CH") : "—");
  const money = (cents: number | null, currency: string | null) => cents == null ? "—" : `${(cents / 100).toFixed(2)} ${currency || "CHF"}`;

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold">Santé du parcours de location</h1>
          <p className="mt-1 text-sm text-muted-foreground">Paiement, éjection, retour et réconciliation financière.</p>
        </div>
        <Button variant="ghost" onClick={() => void load()} className="gap-2"><RefreshCw className="h-4 w-4" />Rafraîchir</Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card label="En attente de paiement" value={sum(["created", "checkout_created"])} />
        <Card label="Payées" value={sum(["payment_succeeded", "ejecting", "ejected", "active_rental"])} tone="text-success" />
        <Card label="Payées non éjectées" value={sum(["payment_succeeded", "ejecting", "chargenow_failed", "eject_failed"])} tone="text-warning" />
        <Card label="États en erreur" value={sum(["payment_failed", "needs_support", "manual_review", "chargenow_failed", "eject_failed"])} tone="text-destructive" />
        <Card label="Retournées / clôturées" value={sum(["battery_returned", "returned", "closed", "completed"])} />
        <Card label="Settlements à réconcilier" value={settlementFailed} tone={settlementFailed ? "text-destructive" : "text-success"} />
        <Card label="Settlements en cours" value={settlementWorking} tone={settlementWorking ? "text-warning" : ""} />
        <Card label="Erreurs API Stripe" value={webhookErrors} tone={webhookErrors ? "text-destructive" : ""} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card label="Dernier webhook Stripe reçu" value={fmt(lastWebhook)} />
        <Card label="Dernier appel ChargeNow réussi" value={fmt(lastCn)} />
      </div>

      <section className="glass liquid-border overflow-hidden rounded-2xl">
        <div className="border-b border-border/60 p-5">
          <h2 className="font-semibold">Réconciliation financière</h2>
          <p className="mt-1 text-sm text-muted-foreground">Locations dont le prix peut déjà être calculé mais dont le règlement n'est pas encore confirmé.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="bg-muted/20 text-xs uppercase tracking-wide text-muted-foreground">
              <tr><th className="px-4 py-3">Location</th><th className="px-4 py-3">Borne</th><th className="px-4 py-3">État</th><th className="px-4 py-3">Settlement</th><th className="px-4 py-3">Tentatives</th><th className="px-4 py-3">Prix</th><th className="px-4 py-3">Erreur</th><th className="px-4 py-3">Retour</th></tr>
            </thead>
            <tbody>
              {settlementRows.map((row) => (
                <tr key={row.id} className="border-t border-border/40">
                  <td className="px-4 py-3 font-mono text-xs">{row.public_session_code ?? row.id.slice(0, 8)}</td>
                  <td className="px-4 py-3">{row.station_id}</td>
                  <td className="px-4 py-3 font-mono text-xs">{row.state}</td>
                  <td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${row.settlement_status === "settling" ? "bg-warning/15 text-warning" : "bg-destructive/15 text-destructive"}`}>{row.settlement_status ?? "—"}</span></td>
                  <td className="px-4 py-3 font-bold">{row.settlement_attempts ?? 0}</td>
                  <td className="px-4 py-3 font-bold">{money(row.final_amount_cents, row.currency)}</td>
                  <td className="max-w-[280px] truncate px-4 py-3 font-mono text-xs text-destructive" title={row.settlement_error ?? row.failure_code ?? ""}>{row.settlement_error ?? row.failure_code ?? "—"}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{fmt(row.returned_at)}</td>
                </tr>
              ))}
              {settlementRows.length === 0 && <tr><td colSpan={8} className="px-5 py-8 text-center text-muted-foreground">Aucune réconciliation financière en attente.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <div className="glass liquid-border rounded-2xl p-5">
        <h2 className="mb-3 font-semibold">Répartition par état</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {Object.entries(counts).sort().map(([k, v]) => (
            <div key={k} className="rounded-lg bg-muted/30 p-2 text-sm"><span className="font-mono">{k}</span>: <b>{v}</b></div>
          ))}
          {Object.keys(counts).length === 0 && <p className="text-muted-foreground">Aucune session.</p>}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">Aucun secret n'est affiché. Les preuves d'opérations API détaillées restent dans la couverture API.</p>
    </div>
  );
}
