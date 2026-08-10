import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Loader2, ArrowRight, RefreshCw } from "lucide-react";
import { canAccessAdminPath } from "./adminNav";

type PricingList = { ok?: boolean; profiles?: any[]; error?: string };
type SettingsRead = { ok?: boolean; defaultLanguage?: string; error?: string };

export default function AdminSettings() {
  const { roles } = useAuth();
  const [prices, setPrices] = useState<any[]>([]);
  const [lang, setLang] = useState("fr");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const canOpenPricing = canAccessAdminPath("/admin/pricing", roles);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [priceResult, settingsResult] = await Promise.all([
        supabase.functions.invoke("pricing-admin", { body: { action: "list" } }),
        supabase.functions.invoke("admin-settings-read", { body: {} }),
      ]);

      const pricing = priceResult.data as PricingList | null;
      const settings = settingsResult.data as SettingsRead | null;

      if (priceResult.error || !pricing?.ok) {
        toast.error(pricing?.error ?? priceResult.error?.message ?? "Impossible de charger les tarifs.");
        setPrices([]);
      } else {
        setPrices(pricing.profiles ?? []);
      }

      if (settingsResult.error || !settings?.ok) {
        toast.error(settings?.error ?? settingsResult.error?.message ?? "Impossible de charger les réglages.");
      } else {
        setLang(settings.defaultLanguage ?? "fr");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const setLanguage = async (l: string) => {
    setSaving(true);
    const prev = lang;
    setLang(l);
    try {
      const { data, error } = await supabase.functions.invoke("admin-maintenance-action", {
        body: { actionType: "set_default_language", language: l },
      });
      if (error || !data?.ok) {
        setLang(prev);
        toast.error(data?.error ?? error?.message ?? "Échec de la mise à jour");
      } else {
        toast.success("Langue par défaut : " + l.toUpperCase());
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="animate-fade-in max-w-2xl space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-bold">Réglages</h1>
        <Button variant="ghost" onClick={() => void load()} disabled={loading} className="gap-2">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}Actualiser
        </Button>
      </div>

      <section className="glass liquid-border rounded-2xl p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-xl font-bold">Tarifs</h2>
          {canOpenPricing && (
            <Button asChild variant="ghost" className="gap-2">
              <Link to="/admin/pricing">Gérer les tarifs <ArrowRight className="h-4 w-4" /></Link>
            </Button>
          )}
        </div>
        <p className="mb-4 text-sm text-muted-foreground">
          Les tarifs sont gérés dans le moteur tarifaire (stratégies, plafonds, dépôt, attribution par station).
          Cette section est en lecture seule.
        </p>
        <div className="space-y-2">
          {prices.map((p) => (
            <div key={p.id} className="flex items-center justify-between rounded-lg bg-muted/30 p-3 text-sm">
              <span className="font-medium">
                {p.name}{p.is_default ? " · par défaut" : ""}{!p.active ? " · inactif" : ""}
              </span>
              <span className="font-mono text-muted-foreground">
                {(Number(p.price_per_period_cents ?? 0) / 100).toFixed(2)} {p.currency ?? "CHF"} / {p.period_minutes ?? "—"} min
              </span>
            </div>
          ))}
          {!loading && prices.length === 0 && <p className="text-sm text-muted-foreground">Aucune stratégie tarifaire disponible.</p>}
        </div>
      </section>

      <section className="glass liquid-border rounded-2xl p-6">
        <h2 className="mb-2 font-display text-xl font-bold">Langue par défaut</h2>
        <div className="flex items-center gap-2">
          {["fr", "en", "de"].map((l) => (
            <Button key={l} variant={lang === l ? "default" : "ghost"} disabled={saving || loading}
              className={lang === l ? "bg-gradient-primary uppercase" : "uppercase"}
              onClick={() => void setLanguage(l)}>{l}</Button>
          ))}
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
        </div>
      </section>
    </div>
  );
}
