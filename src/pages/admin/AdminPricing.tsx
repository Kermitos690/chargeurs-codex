import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { DataTable, StateChip } from "@/components/admin/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Plus, Search, FlaskConical, Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

type Profile = {
  id: string; name: string; currency: string; active: boolean; is_default: boolean;
  price_per_period_cents: number; period_minutes: number; daily_cap_cents: number;
  valid_from: string | null; valid_to: string | null; updated_at: string; version: number;
  counts: { station: number; shop: number; device: number };
};

const chf = (cents: number) => `${(cents / 100).toFixed(2)}`;

async function call(action: string, payload: Record<string, unknown> = {}) {
  const { data, error } = await supabase.functions.invoke("pricing-admin", { body: { action, ...payload } });
  if (error) throw new Error(error.message);
  if (!(data as { ok?: boolean })?.ok) throw new Error((data as { error?: string })?.error ?? "Erreur");
  return data;
}

export default function AdminPricing() {
  const { canManageFinance } = useAuth();
  const [rows, setRows] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [onlyActive, setOnlyActive] = useState(false);
  const [form, setForm] = useState({ name: "", currency: "CHF", price: "0.75", period: "30", cap: "18.00" });
  const [sim, setSim] = useState({ station: "", minutes: "30", return_state: "normal" });
  const [simResult, setSimResult] = useState<Record<string, unknown> | null>(null);
  const [simLoading, setSimLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { const d = await call("list"); setRows((d as { profiles: Profile[] }).profiles); }
    catch (e) { toast.error(String((e as Error).message)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const create = async () => {
    if (!form.name) return toast.error("Nom requis");
    const cents = Math.round(Number(form.price) * 100);
    if (!Number.isFinite(cents) || cents < 0) return toast.error("Montant invalide");
    if (Number(form.period) <= 0) return toast.error("Période invalide");
    try {
      await call("create", {
        name: form.name, currency: form.currency,
        price_per_period_cents: cents, period_minutes: Number(form.period),
        daily_cap_cents: form.cap ? Math.round(Number(form.cap) * 100) : 1_800,
        total_cap_cents: 0,
        max_amount_cents: 9_900,
        deposit_cents: 3_000,
        unreturned_fee_cents: 9_900,
        active: true,
      });
      toast.success("Formule créée");
      setForm({ name: "", currency: "CHF", price: "0.75", period: "30", cap: "18.00" });
      load();
    } catch (e) { toast.error(String((e as Error).message)); }
  };
  const toggle = async (p: Profile) => { try { await call("toggle", { id: p.id, active: !p.active }); load(); } catch (e) { toast.error(String((e as Error).message)); } };
  const setDefault = async (p: Profile) => { try { await call("setDefault", { id: p.id }); load(); } catch (e) { toast.error(String((e as Error).message)); } };
  const duplicate = async (p: Profile) => { try { await call("duplicate", { id: p.id }); load(); } catch (e) { toast.error(String((e as Error).message)); } };
  const remove = async (p: Profile) => {
    if (!confirm(`Supprimer « ${p.name} » ? Cette action est définitive.`)) return;
    try { await call("delete", { id: p.id }); toast.success("Supprimée"); load(); }
    catch (e) { toast.error((e as Error).message === "HAS_DEPENDENCIES" ? "Impossible : tarif utilisé (locations ou affectations)." : (e as Error).message); }
  };
  const simulate = async () => {
    setSimLoading(true); setSimResult(null);
    try {
      const end = new Date(Date.now() + Number(sim.minutes) * 60000).toISOString();
      const d = await call("simulate", { station: sim.station, start: new Date().toISOString(), end, return_state: sim.return_state });
      setSimResult((d as { snapshot: Record<string, unknown> }).snapshot);
    } catch (e) { toast.error(String((e as Error).message)); }
    finally { setSimLoading(false); }
  };

  const filtered = rows
    .filter((p) => p.name.toLowerCase().includes(q.toLowerCase()))
    .filter((p) => !onlyActive || p.active);

  return (
    <div className="animate-fade-in space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-3xl font-bold">Tarifs</h1>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher…" className="w-48 pl-8" />
          </div>
          <Button variant={onlyActive ? "default" : "ghost"} size="sm" onClick={() => setOnlyActive((v) => !v)}>Actifs</Button>
        </div>
      </div>

      <section className="glass liquid-border rounded-2xl p-5">
        <h2 className="mb-3 font-semibold">Formules tarifaires</h2>
        {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : (
          <DataTable
            columns={["Nom", "Statut", "Devise", "Prix/période", "Période", "Plafond", "Stations", "Boutiques", "Bornes", "Défaut", "Validité", "Modifié", "Actions"]}
            rows={filtered.map((p) => [
              <Link to={`/admin/pricing/${p.id}`} className="font-medium text-primary hover:underline">{p.name}</Link>,
              <StateChip state={p.active ? "active_rental" : "error"} />,
              p.currency,
              `${chf(p.price_per_period_cents)}`,
              `${p.period_minutes} min`,
              p.daily_cap_cents ? chf(p.daily_cap_cents) : "—",
              p.counts.station, p.counts.shop, p.counts.device,
              p.is_default ? "★" : canManageFinance ? <Button size="sm" variant="ghost" onClick={() => setDefault(p)}>définir</Button> : "—",
              p.valid_to ? `→ ${new Date(p.valid_to).toLocaleDateString()}` : "permanent",
              `v${p.version} · ${new Date(p.updated_at).toLocaleDateString()}`,
              canManageFinance ? <div className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => toggle(p)}>{p.active ? "désact." : "activer"}</Button>
                <Button size="sm" variant="ghost" onClick={() => duplicate(p)}>dupliquer</Button>
                <Button size="sm" variant="destructive" onClick={() => remove(p)}>suppr.</Button>
              </div> : <span className="text-xs text-muted-foreground">Lecture seule</span>,
            ])}
          />
        )}
        {canManageFinance && <div className="mt-4 flex flex-wrap items-end gap-2">
          <div><label className="text-xs text-muted-foreground">Nom</label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div className="w-28"><label className="text-xs text-muted-foreground">Prix/période</label><Input type="number" step="0.01" min="0" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></div>
          <div className="w-24"><label className="text-xs text-muted-foreground">Période (min)</label><Input type="number" min="1" value={form.period} onChange={(e) => setForm({ ...form, period: e.target.value })} /></div>
          <div className="w-24"><label className="text-xs text-muted-foreground">Plafond/jour</label><Input type="number" step="0.01" min="0" value={form.cap} onChange={(e) => setForm({ ...form, cap: e.target.value })} /></div>
          <div className="w-24"><label className="text-xs text-muted-foreground">Devise</label><Input value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} /></div>
          <Button onClick={create} className="gap-2"><Plus className="h-4 w-4" />Créer</Button>
        </div>}
        <p className="mt-2 text-xs text-muted-foreground">Détails complets (frais, plafonds, validité, affectations) sur la fiche de chaque tarif.</p>
      </section>

      <section className="glass liquid-border rounded-2xl p-5">
        <h2 className="mb-3 flex items-center gap-2 font-semibold"><FlaskConical className="h-4 w-4" />Simulateur tarifaire</h2>
        <p className="mb-3 text-xs text-muted-foreground">Vérifiez le tarif réellement appliqué (résolution borne → station → boutique → défaut) avant publication.</p>
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-40"><label className="text-xs text-muted-foreground">Station / borne</label><Input value={sim.station} onChange={(e) => setSim({ ...sim, station: e.target.value })} /></div>
          <div className="w-28"><label className="text-xs text-muted-foreground">Durée (min)</label><Input type="number" min="0" value={sim.minutes} onChange={(e) => setSim({ ...sim, minutes: e.target.value })} /></div>
          <div className="w-44">
            <label className="text-xs text-muted-foreground">Scénario retour</label>
            <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={sim.return_state} onChange={(e) => setSim({ ...sim, return_state: e.target.value })}>
              <option value="normal">Retour normal</option>
              <option value="late">Retard</option>
              <option value="not_returned">Non retournée</option>
            </select>
          </div>
          <Button onClick={simulate} className="gap-2">{simLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FlaskConical className="h-4 w-4" />}Simuler</Button>
        </div>
        {simResult && (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="glass rounded-xl p-4">
              <div className="text-sm text-muted-foreground">Profil utilisé ({String(simResult.source)})</div>
              <div className="text-lg font-semibold">{String(simResult.profile_name)} v{String(simResult.profile_version)}</div>
              <div className="mt-2 text-4xl font-bold text-gradient-cyan">{chf(Number(simResult.final_cents))} {String(simResult.currency)}</div>
            </div>
            <pre className="max-h-64 overflow-auto rounded-xl bg-muted/30 p-3 text-xs">{JSON.stringify(simResult, null, 2)}</pre>
          </div>
        )}
      </section>
    </div>
  );
}
