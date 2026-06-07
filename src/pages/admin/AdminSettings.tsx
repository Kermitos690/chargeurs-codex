import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Loader2, ArrowRight } from "lucide-react";

export default function AdminSettings() {
  const [prices, setPrices] = useState<any[]>([]);
  const [lang, setLang] = useState("fr");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.from("price_profiles").select("id,name,price_per_period_cents,period_minutes,currency,is_default,active")
      .order("priority", { ascending: false }).then(({ data }) => setPrices(data ?? []));
    supabase.from("kiosk_settings").select("*").eq("key", "default_language").maybeSingle()
      .then(({ data }) => setLang((data?.value as any)?.value ?? "fr"));
  }, []);

  const setLanguage = async (l: string) => {
    setSaving(true);
    const prev = lang;
    setLang(l);
    const { data, error } = await supabase.functions.invoke("admin-maintenance-action", {
      body: { actionType: "set_default_language", language: l },
    });
    setSaving(false);
    if (error || !(data as any)?.ok) {
      setLang(prev);
      toast.error((data as any)?.error ?? "Échec de la mise à jour");
    } else {
      toast.success("Langue par défaut : " + l.toUpperCase());
    }
  };

  return (
    <div className="animate-fade-in max-w-2xl space-y-6">
      <h1 className="font-display text-3xl font-bold">Réglages</h1>

      <section className="glass liquid-border rounded-2xl p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-xl font-bold">Tarifs</h2>
          <Button asChild variant="ghost" className="gap-2">
            <Link to="/admin/pricing">Gérer les tarifs <ArrowRight className="h-4 w-4" /></Link>
          </Button>
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
                {(p.price_per_period_cents / 100).toFixed(2)} {p.currency} / {p.period_minutes} min
              </span>
            </div>
          ))}
          {prices.length === 0 && <p className="text-sm text-muted-foreground">Aucune stratégie tarifaire.</p>}
        </div>
      </section>

      <section className="glass liquid-border rounded-2xl p-6">
        <h2 className="mb-2 font-display text-xl font-bold">Langue par défaut</h2>
        <div className="flex items-center gap-2">
          {["fr", "en", "de"].map((l) => (
            <Button key={l} variant={lang === l ? "default" : "ghost"} disabled={saving}
              className={lang === l ? "bg-gradient-primary uppercase" : "uppercase"}
              onClick={() => setLanguage(l)}>{l}</Button>
          ))}
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
        </div>
      </section>
    </div>
  );
}
