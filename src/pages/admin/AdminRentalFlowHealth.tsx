import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { RefreshCw, Loader2 } from "lucide-react";
import { toast } from "sonner";

function Card({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return <div className="glass liquid-border rounded-2xl p-5"><div className="text-sm text-muted-foreground">{label}</div><div className={`mt-1 text-3xl font-bold ${tone ?? ""}`}>{value}</div></div>;
}

type SettlementRow = {
  id: string; public_session_code: string | null; station_id: string; state: string;
  settlement_status: string | null; settlement_attempts: number | null; settlement_error: string | null;
  failure_code: string | null; final_amount_cents: number | null; currency: string | null;
  returned_at: string | null; updated_at: string;
};

type HealthResponse = {
  ok?: boolean; error?: string; counts?: Record<string, number>; lastWebhook?: string | null; lastChargeNow?: string | null;
  stripeApiErrors?: number; settlementFailed?: number; settlementWorking?: number; settlements?: SettlementRow[];
};

export default function AdminRentalFlowHealth() {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [lastWebhook, setLastWebhook] = useState<string | null>(null);
  const [lastCn, setLastCn] = useState<string | null>(null);
  const [webhookErrors, setWebhookErrors] = useState(0);
  const [settlementRows, setSettlementRows] = useState<SettlementRow[]>([]);
  const [settlementFailed, setSettlementFailed] = useState(0);
  const [settlementWorking, setSettlementWorking] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-operations-read", { body: { action: "rental_health" } });
      const result = data as HealthResponse | null;
      if (error || !result?.ok) {
        if (!silent) toast.error(result?.error ?? error?.message ?? "Impossible de charger la santé du parcours.");
        return;
      }
      setCounts(result.counts ?? {});
      setLastWebhook(result.lastWebhook ?? null);
      setLastCn(result.lastChargeNow ?? null);
      setWebhookErrors(result.stripeApiErrors ?? 0);
      setSettlementFailed(result.settlementFailed ?? 0);
      setSettlementWorking(result.settlementWorking ?? 0);
      setSettlementRows(result.settlements ?? []);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); const i = window.setInterval(() => void load(true), 10000); return () => window.clearInterval(i); }, [load]);
  const sum = (keys: string[]) => keys.reduce((a, k) => a + (counts[k] ?? 0), 0);
  const fmt = (d: string | null) => (d ? new Date(d).toLocaleString("fr-CH") : "—");
  const money = (cents: number | null, currency: string | null) => cents == null ? "—" : `${(cents / 100).toFixed(2)} ${currency || "CHF"}`;

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div><h1 className="font-display text-3xl font-bold">Santé du parcours de location</h1><p className="mt-1 text-sm text-muted-foreground">Paiement, éjection, retour et réconciliation financière.</p></div>
        <Button variant="ghost" onClick={() => void load()} disabled={loading} className="gap-2">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}Rafraîchir</Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card label="En attente de paiement" value={sum(["created", "checkout_created", "payment_pending"])} />
        <Card label="Payées" value={sum(["payment_succeeded", "ejecting", "ejected", "active_rental", "active"])} tone="text-success" />
        <Card label="Payées non éjectées" value={sum(["payment_succeeded", "ejecting", "chargenow_failed", "eject_failed", "release_requested"])} tone="text-warning" />
        <Card label="États en erreur" value={sum(["payment_failed", "needs_support", "manual_review", "chargenow_failed", "eject_failed", "failed"])} tone="text-destructive" />
        <Card label="Retournées / clôturées" value={sum(["battery_returned", "returned", "closed", "completed"])} />
        <Card label="Settlements à réconcilier" value={settlementFailed} tone={settlementFailed ? "text-destructive" : "text-success"} />
        <Card label="Settlements en cours" value={settlementWorking} tone={settlementWorking ? "text-warning" : ""} />
        <Card label="Erreurs API Stripe" value={webhookErrors} tone={webhookErrors ? "text-destructive" : ""} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2"><Card label="Dernier webhook Stripe reçu" value={fmt(lastWebhook)} /><Card label="Dernier appel ChargeNow réussi" value={fmt(lastCn)} /></div>

      <section className="glass liquid-border overflow-hidden rounded-2xl">
        <div className="border-b border-border/60 p-5"><h2 className="font-semibold">Réconciliation financière</h2><p className="mt-1 text-sm text-muted-foreground">Locations dont le prix peut déjà être calculé mais dont le règlement n'est pas encore confirmé.</p></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[980px] text-left text-sm"><thead className="bg-muted/20 text-xs uppercase tracking-wide text-muted-foreground"><tr><th className="px-4 py-3">Location</th><th className="px-4 py-3">Borne</th><th className="px-4 py-3">État</th><th className="px-4 py-3">Settlement</th><th className="px-4 py-3">Tentatives</th><th className="px-4 py-3">Prix</th><th className="px-4 py-3">Erreur</th><th className="px-4 py-3">Retour</th></tr></thead><tbody>
          {settlementRows.map((row) => <tr key={row.id} className="border-t border-border/40"><td className="px-4 py-3 font-mono text-xs">{row.public_session_code ?? row.id.slice(0, 8)}</td><td className="px-4 py-3">{row.station_id}</td><td className="px-4 py-3 font-mono text-xs">{row.state}</td><td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${row.settlement_status === "settling" ? "bg-warning/15 text-warning" : "bg-destructive/15 text-destructive"}`}>{row.settlement_status ?? "—"}</span></td><td className="px-4 py-3 font-bold">{row.settlement_attempts ?? 0}</td><td className="px-4 py-3 font-bold">{money(row.final_amount_cents, row.currency)}</td><td className="max-w-[280px] truncate px-4 py-3 font-mono text-xs text-destructive" title={row.settlement_error ?? row.failure_code ?? ""}>{row.settlement_error ?? row.failure_code ?? "—"}</td><td className="px-4 py-3 text-xs text-muted-foreground">{fmt(row.returned_at)}</td></tr>)}
          {settlementRows.length === 0 && <tr><td colSpan={8} className="px-5 py-8 text-center text-muted-foreground">Aucune réconciliation financière en attente.</td></tr>}
        </tbody></table></div>
      </section>

      <div className="glass liquid-border rounded-2xl p-5"><h2 className="mb-3 font-semibold">Répartition par état</h2><div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{Object.entries(counts).sort().map(([k, v]) => <div key={k} className="rounded-lg bg-muted/30 p-2 text-sm"><span className="font-mono">{k}</span>: <b>{v}</b></div>)}{Object.keys(counts).length === 0 && <p className="text-muted-foreground">{loading ? "Chargement…" : "Aucune session."}</p>}</div></div>
      <p className="text-xs text-muted-foreground">Aucun secret ni payload fournisseur brut n'est envoyé à cette page.</p>
    </div>
  );
}
