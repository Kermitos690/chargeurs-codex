import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { DataTable } from "@/components/admin/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Loader2, RefreshCw, Plus } from "lucide-react";

type Profile = { id: string; name: string; amount: number; currency: string; period_label: string | null; is_default: boolean; active: boolean; chargenow_price_id: string | null; shop_id: string | null };

export default function AdminPricing() {
  const [rows, setRows] = useState<Profile[]>([]);
  const [cn, setCn] = useState<any>(null);
  const [loadingCn, setLoadingCn] = useState(false);
  const [form, setForm] = useState({ name: "", amount: "2.00", currency: "CHF", period_label: "par 30 min" });

  const load = useCallback(async () => {
    const { data } = await supabase.from("price_profiles").select("*").order("amount");
    setRows((data ?? []) as Profile[]);
  }, []);
  useEffect(() => { load(); }, [load]);

  const create = async () => {
    if (!form.name) return toast.error("Nom requis");
    const { error } = await supabase.from("price_profiles").insert({
      name: form.name, amount: Number(form.amount), currency: form.currency, period_label: form.period_label, active: true,
    });
    if (error) toast.error(error.message); else { toast.success("Formule créée"); setForm({ name: "", amount: "2.00", currency: "CHF", period_label: "par 30 min" }); load(); }
  };
  const toggle = async (p: Profile) => {
    await supabase.from("price_profiles").update({ active: !p.active }).eq("id", p.id); load();
  };
  const setDefault = async (p: Profile) => {
    await supabase.from("price_profiles").update({ is_default: false }).neq("id", p.id);
    await supabase.from("price_profiles").update({ is_default: true }).eq("id", p.id); load();
  };
  const remove = async (p: Profile) => {
    if (!confirm("Supprimer cette formule ?")) return;
    const { error } = await supabase.from("price_profiles").delete().eq("id", p.id);
    if (error) toast.error(error.message); else load();
  };
  const fetchChargeNow = async () => {
    setLoadingCn(true);
    const { data } = await supabase.functions.invoke("chargenow-admin", { body: { action: "invoke", code: "P1", params: { body: {} } } });
    setLoadingCn(false);
    setCn(data);
  };

  return (
    <div className="animate-fade-in space-y-8">
      <h1 className="font-display text-3xl font-bold">Tarifs</h1>

      <section className="glass liquid-border rounded-2xl p-5">
        <h2 className="mb-3 font-semibold">Formules locales (utilisées par la borne)</h2>
        <DataTable
          columns={["Nom", "Montant", "Période", "Défaut", "Actif", "CN priceId", ""]}
          rows={rows.map((p) => [
            p.name, `${p.amount} ${p.currency}`, p.period_label ?? "—",
            p.is_default ? "★" : <Button size="sm" variant="ghost" onClick={() => setDefault(p)}>définir</Button>,
            <Button size="sm" variant="ghost" onClick={() => toggle(p)}>{p.active ? "oui" : "non"}</Button>,
            p.chargenow_price_id ?? "—",
            <Button size="sm" variant="destructive" onClick={() => remove(p)}>Suppr.</Button>,
          ])}
        />
        <div className="mt-4 flex flex-wrap items-end gap-2">
          <div><label className="text-xs text-muted-foreground">Nom</label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div className="w-28"><label className="text-xs text-muted-foreground">Montant</label><Input value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></div>
          <div className="w-24"><label className="text-xs text-muted-foreground">Devise</label><Input value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} /></div>
          <div><label className="text-xs text-muted-foreground">Période</label><Input value={form.period_label} onChange={(e) => setForm({ ...form, period_label: e.target.value })} /></div>
          <Button onClick={create} className="gap-2"><Plus className="h-4 w-4" />Créer</Button>
        </div>
      </section>

      <section className="glass liquid-border rounded-2xl p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">Stratégies tarifaires ChargeNow (P1)</h2>
          <Button variant="ghost" onClick={fetchChargeNow} className="gap-2">{loadingCn ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}Charger</Button>
        </div>
        <pre className="max-h-80 overflow-auto rounded-lg bg-muted/30 p-3 text-xs">{cn ? JSON.stringify(cn, null, 2) : "Cliquez sur Charger pour interroger ChargeNow (P1)."}</pre>
        <p className="mt-2 text-xs text-muted-foreground">Création / liaison / suppression (P3–P6) passent par le dispatcher admin avec dry-run, confirmation et preuve dans /admin/api-coverage.</p>
      </section>
    </div>
  );
}
