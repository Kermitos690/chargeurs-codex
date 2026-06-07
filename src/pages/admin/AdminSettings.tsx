import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

export default function AdminSettings() {
  const [prices, setPrices] = useState<any[]>([]);
  const [lang, setLang] = useState("fr");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.from("price_profiles").select("*").then(({ data }) => setPrices(data ?? []));
    supabase.from("kiosk_settings").select("*").eq("key", "default_language").maybeSingle()
      .then(({ data }) => setLang((data?.value as any)?.value ?? "fr"));
  }, []);

  const savePrice = async (id: string, amount: number) => {
    setLoading(true);
    await supabase.from("price_profiles").update({ amount }).eq("id", id);
    toast.success("Prix mis à jour");
    setLoading(false);
  };

  return (
    <div className="animate-fade-in max-w-2xl space-y-6">
      <h1 className="font-display text-3xl font-bold">Réglages</h1>

      <section className="glass liquid-border rounded-2xl p-6">
        <h2 className="mb-4 font-display text-xl font-bold">Tarifs</h2>
        {prices.map((p) => (
          <div key={p.id} className="flex items-center gap-3">
            <span className="flex-1">{p.name} ({p.period_label})</span>
            <Input type="number" step="0.5" defaultValue={p.amount} className="w-28"
              onBlur={(e) => savePrice(p.id, Number(e.target.value))} />
            <span className="text-muted-foreground">{p.currency}</span>
          </div>
        ))}
        {loading && <Loader2 className="mt-2 h-4 w-4 animate-spin" />}
      </section>

      <section className="glass liquid-border rounded-2xl p-6">
        <h2 className="mb-2 font-display text-xl font-bold">Langue par défaut</h2>
        <div className="flex gap-2">
          {["fr", "en", "de"].map((l) => (
            <Button key={l} variant={lang === l ? "default" : "ghost"}
              className={lang === l ? "bg-gradient-primary uppercase" : "uppercase"}
              onClick={async () => {
                setLang(l);
                await supabase.from("kiosk_settings").update({ value: { value: l } }).eq("key", "default_language");
                toast.success("Langue par défaut : " + l.toUpperCase());
              }}>{l}</Button>
          ))}
        </div>
      </section>
    </div>
  );
}
