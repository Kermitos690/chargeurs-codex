import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

type Health = {
  stripe: boolean;
  chargenow: boolean;
  stripeWebhookConfigured: boolean;
  stripeWebhookReceived: boolean;
  stripeWebhookEvents: number;
  eventPushConfigured: boolean;
  eventPushReceived: boolean;
  cabinetEvents: number;
};

export default function AdminApiHealth() {
  const [health, setHealth] = useState<Health | null>(null);
  const [testing, setTesting] = useState(false);

  const check = useCallback(async () => {
    setTesting(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-health-read", { body: {} });
      if (error || !data?.ok || !data?.health) {
        toast.error(data?.error ?? error?.message ?? "La sonde de santé est indisponible.");
        setHealth(null);
        return;
      }
      setHealth(data.health as Health);
    } finally {
      setTesting(false);
    }
  }, []);
  useEffect(() => { void check(); }, [check]);

  const items = [
    { label: "API ChargeNow / Apifox", ok: health?.chargenow, hint: "Identifiants fournisseur configurés côté backend" },
    { label: "Stripe Test", ok: health?.stripe, hint: "Mode Test actif et clés Live désactivées" },
    { label: "Webhook Stripe configuré", ok: health?.stripeWebhookConfigured, hint: health ? `${health.stripeWebhookEvents} événement(s) Stripe vérifié(s) enregistrés` : "Secret webhook signé" },
    { label: "Webhook Stripe déjà reçu", ok: health?.stripeWebhookReceived, hint: "Au moins un événement signé traité" },
    { label: "Event Push ChargeNow configuré", ok: health?.eventPushConfigured, hint: "E1 + E2 vérifiés sur le projet Supabase actuel" },
    { label: "Event Push borne déjà reçu", ok: health?.eventPushReceived, hint: health ? `${health.cabinetEvents} événement(s) matériel(s) enregistrés` : "Au moins un événement matériel reçu" },
  ];

  return (
    <div className="animate-fade-in max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-3xl font-bold">Santé API</h1>
        <Button onClick={() => void check()} disabled={testing} variant="ghost" className="border border-border">
          {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : "Tester"}
        </Button>
      </div>
      <div className="space-y-3">
        {items.map((it) => (
          <div key={it.label} className="glass liquid-border flex items-center justify-between rounded-2xl p-5">
            <div><div className="font-semibold">{it.label}</div><div className="text-sm text-muted-foreground">{it.hint}</div></div>
            {it.ok == null ? <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              : it.ok ? <CheckCircle2 className="h-6 w-6 text-success" />
              : <XCircle className="h-6 w-6 text-destructive" />}
          </div>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">Les valeurs secrètes ne sont jamais exposées au navigateur. Un webhook peut être correctement configuré sans qu’un événement matériel ait encore été émis depuis son activation.</p>
    </div>
  );
}
