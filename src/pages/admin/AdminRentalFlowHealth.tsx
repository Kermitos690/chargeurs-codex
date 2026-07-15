import { useCallback, useEffect, useMemo, useState } from "react";
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

interface SessionHealthRow {
  state: string;
  settlement_status: string | null;
  returned_at: string | null;
  settlement_locked_at: string | null;
}

interface WebhookHealthRow {
  created_at: string;
  processing_status: string | null;
  processing_started_at: string | null;
}

const STALE_LOCK_MS = 15 * 60 * 1000;

export default function AdminRentalFlowHealth() {
  const [sessions, setSessions] = useState<SessionHealthRow[]>([]);
  const [webhooks, setWebhooks] = useState<WebhookHealthRow[]>([]);
  const [lastChargeNow, setLastChargeNow] = useState<string | null>(null);
  const [stripeApiErrors, setStripeApiErrors] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    const [sessionResult, webhookResult, chargeNowResult, stripeErrorsResult] = await Promise.all([
      supabase.from("rental_sessions").select("state,settlement_status,returned_at,settlement_locked_at"),
      supabase.from("webhook_events")
        .select("created_at,processing_status,processing_started_at")
        .eq("provider", "stripe")
        .order("created_at", { ascending: false })
        .limit(250),
      supabase.from("api_logs")
        .select("created_at")
        .eq("service", "chargenow")
        .is("error", null)
        .order("created_at", { ascending: false })
        .limit(1),
      supabase.from("api_logs")
        .select("*", { count: "exact", head: true })
        .eq("service", "stripe")
        .not("error", "is", null),
    ]);

    const firstError = sessionResult.error ?? webhookResult.error ?? chargeNowResult.error ?? stripeErrorsResult.error;
    if (firstError) setLoadError(firstError.message);

    setSessions((sessionResult.data ?? []) as unknown as SessionHealthRow[]);
    setWebhooks((webhookResult.data ?? []) as unknown as WebhookHealthRow[]);
    setLastChargeNow((chargeNowResult.data?.[0] as { created_at?: string } | undefined)?.created_at ?? null);
    setStripeApiErrors(stripeErrorsResult.count ?? 0);
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 10_000);
    return () => clearInterval(interval);
  }, [load]);

  const stateCounts = useMemo(() => countBy(sessions.map((row) => row.state)), [sessions]);
  const settlementCounts = useMemo(
    () => countBy(sessions.map((row) => row.settlement_status ?? "legacy_untracked")),
    [sessions],
  );
  const webhookCounts = useMemo(
    () => countBy(webhooks.map((row) => row.processing_status ?? "legacy_processed")),
    [webhooks],
  );

  const staleSettlementLocks = sessions.filter((row) => {
    if (row.settlement_status !== "settling" || !row.settlement_locked_at) return false;
    return Date.now() - new Date(row.settlement_locked_at).getTime() > STALE_LOCK_MS;
  }).length;

  const staleWebhookLocks = webhooks.filter((row) => {
    if (row.processing_status !== "processing" || !row.processing_started_at) return false;
    return Date.now() - new Date(row.processing_started_at).getTime() > STALE_LOCK_MS;
  }).length;

  const lastWebhook = webhooks[0]?.created_at ?? null;
  const sumStates = (keys: string[]) => keys.reduce((total, key) => total + (stateCounts[key] ?? 0), 0);
  const sumSettlements = (keys: string[]) => keys.reduce((total, key) => total + (settlementCounts[key] ?? 0), 0);
  const formatDate = (value: string | null) => (value ? new Date(value).toLocaleString("fr-CH") : "—");

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold">Santé du parcours de location</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Lecture opérationnelle séparée entre matériel, paiements et règlement financier final.
          </p>
        </div>
        <Button variant="ghost" onClick={load} className="gap-2 border border-border">
          <RefreshCw className="h-4 w-4" />
          Rafraîchir
        </Button>
      </div>

      {loadError && (
        <div className="rounded-xl border border-warning/40 bg-warning/5 p-4 text-sm text-warning">
          Certaines colonnes de santé ne sont pas encore disponibles : {loadError}. Vérifier l'application des migrations de règlement.
        </div>
      )}

      <section className="space-y-3">
        <h2 className="font-display text-xl font-bold">Parcours matériel</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card label="En attente de paiement" value={sumStates(["created", "checkout_created"])} />
          <Card label="Autorisées / payées" value={sumStates(["payment_succeeded", "ejecting", "ejected", "active_rental"])} tone="text-success" />
          <Card label="Payées non éjectées" value={sumStates(["payment_succeeded", "ejecting", "chargenow_failed", "eject_failed"])} tone="text-warning" />
          <Card label="Retournées / terminées" value={sumStates(["battery_returned", "returned", "closed", "completed"])} />
          <Card label="Erreurs matérielles" value={sumStates(["chargenow_failed", "eject_failed"])} tone="text-destructive" />
          <Card label="Revue / support" value={sumStates(["needs_support", "manual_review"])} tone="text-destructive" />
          <Card label="Remboursées" value={sumStates(["refunded"])} />
          <Card label="Expirées / annulées" value={sumStates(["payment_expired", "payment_cancelled", "cancelled"])} />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-xl font-bold">Règlement financier</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card label="Cautions autorisées" value={settlementCounts.authorized ?? 0} />
          <Card label="Cautions prépayées" value={settlementCounts.prepaid ?? 0} />
          <Card label="Règlements terminés" value={settlementCounts.settled ?? 0} tone="text-success" />
          <Card label="Compléments requis" value={settlementCounts.supplemental_required ?? 0} tone={(settlementCounts.supplemental_required ?? 0) ? "text-warning" : ""} />
          <Card label="Règlements échoués" value={sumSettlements(["failed", "manual_review"])} tone={sumSettlements(["failed", "manual_review"]) ? "text-destructive" : ""} />
          <Card label="Règlements en cours" value={settlementCounts.settling ?? 0} />
          <Card label="Verrous règlement expirés" value={staleSettlementLocks} tone={staleSettlementLocks ? "text-destructive" : ""} />
          <Card label="Anciennes locations non suivies" value={settlementCounts.legacy_untracked ?? 0} />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-xl font-bold">Webhooks et fournisseurs</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card label="Dernier webhook Stripe" value={formatDate(lastWebhook)} />
          <Card label="Webhooks Stripe échoués" value={webhookCounts.failed ?? 0} tone={(webhookCounts.failed ?? 0) ? "text-destructive" : ""} />
          <Card label="Webhooks en cours" value={webhookCounts.processing ?? 0} />
          <Card label="Verrous webhook expirés" value={staleWebhookLocks} tone={staleWebhookLocks ? "text-destructive" : ""} />
          <Card label="Webhooks traités" value={sumMap(webhookCounts, ["processed", "ignored", "legacy_processed"])} />
          <Card label="Erreurs API Stripe journalisées" value={stripeApiErrors} tone={stripeApiErrors ? "text-destructive" : ""} />
          <Card label="Dernier ChargeNow réussi" value={formatDate(lastChargeNow)} />
          <Card label="Locations totalisées" value={sessions.length} />
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <Distribution title="États matériels" values={stateCounts} />
        <Distribution title="États de règlement" values={settlementCounts} />
        <Distribution title="Inbox Stripe" values={webhookCounts} />
      </div>

      <p className="text-xs text-muted-foreground">
        Aucun secret n'est affiché. Les diagnostics détaillés restent dans les journaux d'audit et l'API coverage.
      </p>
    </div>
  );
}

function countBy(values: string[]): Record<string, number> {
  return values.reduce<Record<string, number>>((result, value) => {
    result[value] = (result[value] ?? 0) + 1;
    return result;
  }, {});
}

function sumMap(values: Record<string, number>, keys: string[]): number {
  return keys.reduce((total, key) => total + (values[key] ?? 0), 0);
}

function Distribution({ title, values }: { title: string; values: Record<string, number> }) {
  return (
    <div className="glass liquid-border rounded-2xl p-5">
      <h2 className="mb-3 font-semibold">{title}</h2>
      <div className="grid grid-cols-2 gap-2">
        {Object.entries(values).sort().map(([key, value]) => (
          <div key={key} className="rounded-lg bg-muted/30 p-2 text-xs">
            <span className="break-all font-mono">{key}</span>: <b>{value}</b>
          </div>
        ))}
        {Object.keys(values).length === 0 && <p className="col-span-2 text-sm text-muted-foreground">Aucune donnée.</p>}
      </div>
    </div>
  );
}
