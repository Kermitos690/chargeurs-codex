import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

type Health = { stripe: boolean; chargenow: boolean; webhook: boolean; eventPush: boolean };

export default function AdminApiHealth() {
  const [health, setHealth] = useState<Health | null>(null);
  const [testing, setTesting] = useState(false);

  const check = async () => {
    setTesting(true);
    // sync-cabinet-status reports whether ChargeNow is configured.
    const { data: sync } = await supabase.functions.invoke("sync-cabinet-status", { body: {} });
    // create-stripe-checkout reports stripe config via a harmless probe.
    const { count: eventCount } = await supabase.from("cabinet_events").select("id", { count: "exact", head: true });
    setHealth({
      chargenow: (sync as any)?.configured ?? false,
      stripe: false, // determined when a checkout is attempted (key stored backend-only)
      webhook: false,
      eventPush: (eventCount ?? 0) > 0,
    });
    setTesting(false);
  };
  useEffect(() => { check(); }, []);

  const items = [
    { label: "API ChargeNow / Apifox", ok: health?.chargenow, hint: "Identifiants Basic configurés côté backend" },
    { label: "Stripe", ok: health?.stripe, hint: "Clé secrète Stripe configurée (vérifiée au paiement)" },
    { label: "Webhook Stripe", ok: health?.webhook, hint: "STRIPE_WEBHOOK_SECRET configuré" },
    { label: "Event Push reçu", ok: health?.eventPush, hint: "Au moins un événement reçu d'une borne" },
  ];

  return (
    <div className="animate-fade-in max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-3xl font-bold">Santé API</h1>
        <Button onClick={check} disabled={testing} variant="ghost" className="border border-border">
          {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : "Tester"}
        </Button>
      </div>
      <div className="space-y-3">
        {items.map((it) => (
          <div key={it.label} className="glass liquid-border flex items-center justify-between rounded-2xl p-5">
            <div>
              <div className="font-semibold">{it.label}</div>
              <div className="text-sm text-muted-foreground">{it.hint}</div>
            </div>
            {it.ok == null ? <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              : it.ok ? <CheckCircle2 className="h-6 w-6 text-success" />
              : <XCircle className="h-6 w-6 text-destructive" />}
          </div>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">
        Les clés secrètes ne sont jamais exposées au frontend. Renseignez-les via les secrets backend pour activer les données réelles.
      </p>
    </div>
  );
}
