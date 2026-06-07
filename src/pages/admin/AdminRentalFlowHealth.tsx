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

export default function AdminRentalFlowHealth() {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [lastWebhook, setLastWebhook] = useState<string | null>(null);
  const [lastCn, setLastCn] = useState<string | null>(null);
  const [webhookErrors, setWebhookErrors] = useState(0);

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
  }, []);

  useEffect(() => { load(); const i = setInterval(load, 10000); return () => clearInterval(i); }, [load]);

  const sum = (keys: string[]) => keys.reduce((a, k) => a + (counts[k] ?? 0), 0);
  const fmt = (d: string | null) => (d ? new Date(d).toLocaleString() : "—");

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-3xl font-bold">Santé du parcours de location</h1>
        <Button variant="ghost" onClick={load} className="gap-2"><RefreshCw className="h-4 w-4" />Rafraîchir</Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card label="En attente de paiement" value={sum(["created", "checkout_created"])} />
        <Card label="Payées" value={sum(["payment_succeeded", "ejecting", "ejected", "active_rental"])} tone="text-success" />
        <Card label="Payées non éjectées" value={sum(["payment_succeeded", "ejecting", "chargenow_failed", "eject_failed"])} tone="text-warning" />
        <Card label="En erreur" value={sum(["payment_failed", "needs_support", "manual_review", "chargenow_failed", "eject_failed"])} tone="text-destructive" />
        <Card label="Retournées / clôturées" value={sum(["battery_returned", "returned", "closed", "completed"])} />
        <Card label="Remboursées" value={sum(["refunded"])} />
        <Card label="Expirées / annulées" value={sum(["payment_expired", "payment_cancelled", "cancelled"])} />
        <Card label="Erreurs webhook Stripe" value={webhookErrors} tone={webhookErrors ? "text-destructive" : ""} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card label="Dernier webhook Stripe reçu" value={fmt(lastWebhook)} />
        <Card label="Dernier appel ChargeNow réussi" value={fmt(lastCn)} />
      </div>

      <div className="glass liquid-border rounded-2xl p-5">
        <h2 className="mb-3 font-semibold">Répartition par état</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {Object.entries(counts).sort().map(([k, v]) => (
            <div key={k} className="rounded-lg bg-muted/30 p-2 text-sm"><span className="font-mono">{k}</span>: <b>{v}</b></div>
          ))}
          {Object.keys(counts).length === 0 && <p className="text-muted-foreground">Aucune session.</p>}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">Aucun secret n'est affiché. Les preuves d'opérations API détaillées sont dans /admin/api-coverage.</p>
    </div>
  );
}
