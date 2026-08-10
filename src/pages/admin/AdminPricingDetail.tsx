import { useEffect, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { DataTable, StateChip } from "@/components/admin/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Loader2, ArrowLeft, Save, FlaskConical, ExternalLink } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

const chf = (c: number) => (Number(c) / 100).toFixed(2);
const READ_ACTIONS = new Set(["list", "get", "simulate"]);

async function call(action: string, payload: any = {}) {
  const functionName = READ_ACTIONS.has(action) ? "pricing-admin-read" : "pricing-admin";
  const { data, error } = await supabase.functions.invoke(functionName, { body: { action, ...payload } });
  if (error) throw new Error(error.message);
  if (!(data as { ok?: boolean })?.ok) throw new Error((data as { error?: string })?.error ?? "Erreur");
  return data;
}

const RULES: { key: string; label: string; money?: boolean }[] = [
  { key: "initial_fee_cents", label: "Frais initial", money: true },
  { key: "included_minutes", label: "Durée incluse (min)" },
  { key: "period_minutes", label: "Durée période (min)" },
  { key: "price_per_period_cents", label: "Prix / période", money: true },
  { key: "grace_minutes", label: "Période de grâce (min)" },
  { key: "daily_cap_cents", label: "Plafond journalier", money: true },
  { key: "total_cap_cents", label: "Plafond total", money: true },
  { key: "max_amount_cents", label: "Montant max", money: true },
  { key: "min_amount_cents", label: "Montant min", money: true },
  { key: "deposit_cents", label: "Dépôt", money: true },
  { key: "late_fee_cents", label: "Frais de retard", money: true },
  { key: "unreturned_fee_cents", label: "Frais batterie perdue", money: true },
  { key: "unreturned_after_minutes", label: "Délai non-retour (min)" },
  { key: "tax_percent", label: "TVA (%)" },
];

export default function AdminPricingDetail() {
  const { canManageFinance } = useAuth();
  const { id } = useParams();
  const [data, setData] = useState<any>(null);
  const [form, setForm] = useState<any>({});
  const [saving, setSaving] = useState(false);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [assign, setAssign] = useState({ scope: "station", scope_ref: "" });
  const [sim, setSim] = useState({ minutes: "30", return_state: "normal" });
  const [simResult, setSimResult] = useState<any>(null);

  const load = useCallback(async () => {
    try { const d = await call("get", { id }); setData(d); setForm({ ...((d as Record<string, any>).profile) }); }
    catch (e) { toast.error(String((e as Error).message)); setData(null); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  if (!data) return <Loader2 className="h-6 w-6 animate-spin" />;
  const p = data.profile;
  const firstStation = data.assignments.find((a: any) => a.scope === "station" && a.active)?.scope_ref;

  const save = async () => {
    setSaving(true);
    try {
      const payload: any = { id, name: form.name, description: form.description, currency: form.currency, rounding: form.rounding, valid_to: form.valid_to || null, valid_from: form.valid_from || null, priority: Number(form.priority) || 0 };
      for (const r of RULES) {
        const value = Number(form[r.key]);
        if (!Number.isFinite(value) || value < 0) throw new Error(`${r.label} invalide`);
        payload[r.key] = value;
      }
      await call("update", payload);
      toast.success("Tarif mis à jour (nouvelle version)");
      await load();
    } catch (e) { toast.error(String((e as Error).message)); }
    finally { setSaving(false); }
  };
  const doAssign = async () => {
    if (!assign.scope_ref.trim()) return toast.error("Identifiant requis");
    try { await call("assign", { price_profile_id: id, scope: assign.scope, scope_ref: assign.scope_ref.trim() }); setAssign({ scope: "station", scope_ref: "" }); await load(); toast.success("Affectation enregistrée"); }
    catch (e) { toast.error(String((e as Error).message)); }
  };
  const unassign = async (aid: string) => { try { await call("unassign", { assignment_id: aid }); await load(); toast.success("Affectation retirée"); } catch (e) { toast.error(String((e as Error).message)); } };
  const simulate = async () => {
    if (!firstStation) return toast.error("Affectez ce tarif à une station pour simuler son application réelle.");
    const minutes = Number(sim.minutes);
    if (!Number.isFinite(minutes) || minutes < 0) return toast.error("Durée invalide");
    try {
      const end = new Date(Date.now() + minutes * 60000).toISOString();
      const d = await call("simulate", { station: firstStation, end, return_state: sim.return_state });
      setSimResult((d as { snapshot: any }).snapshot);
    } catch (e) { toast.error(String((e as Error).message)); }
  };
  const runAction = async (action: "toggle" | "setDefault" | "duplicate", payload: Record<string, unknown>, success: string) => {
    setActionBusy(action);
    try { await call(action, payload); toast.success(success); await load(); }
    catch (e) { toast.error(String((e as Error).message)); }
    finally { setActionBusy(null); }
  };

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex items-center justify-between">
        <Link to="/admin/pricing" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" />Tarifs</Link>
        <div className="flex gap-2">
          {canManageFinance && <Button size="sm" variant="ghost" disabled={!!actionBusy} onClick={() => void runAction("toggle", { id, active: !p.active }, p.active ? "Tarif désactivé" : "Tarif activé")}>{p.active ? "Désactiver" : "Activer"}</Button>}
          {canManageFinance && <Button size="sm" variant="ghost" disabled={p.is_default || !!actionBusy} onClick={() => void runAction("setDefault", { id }, "Tarif défini par défaut")}>Définir par défaut</Button>}
          {canManageFinance && <Button size="sm" variant="ghost" disabled={!!actionBusy} onClick={() => void runAction("duplicate", { id }, "Tarif dupliqué")}>Dupliquer</Button>}
          {firstStation && <a href={`/kiosk/station/${firstStation}`} target="_blank" rel="noreferrer"><Button size="sm" className="gap-1"><ExternalLink className="h-4 w-4" />Test kiosk</Button></a>}
        </div>
      </div>

      <div className="flex items-center gap-3"><h1 className="font-display text-3xl font-bold">{p.name}</h1><StateChip state={p.active ? "active_rental" : "error"} />{p.is_default && <span className="rounded-full bg-primary/15 px-2.5 py-1 text-xs font-semibold text-primary">défaut</span>}<span className="text-sm text-muted-foreground">v{p.version}</span></div>

      <section className="glass liquid-border rounded-2xl p-5">
        <h2 className="mb-3 font-semibold">Informations & règles de facturation</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <div><label className="text-xs text-muted-foreground">Nom</label><Input disabled={!canManageFinance} value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div><label className="text-xs text-muted-foreground">Devise</label><Input disabled={!canManageFinance} value={form.currency ?? ""} onChange={(e) => setForm({ ...form, currency: e.target.value })} /></div>
          <div><label className="text-xs text-muted-foreground">Priorité</label><Input disabled={!canManageFinance} type="number" value={form.priority ?? 0} onChange={(e) => setForm({ ...form, priority: e.target.value })} /></div>
          <div className="sm:col-span-3"><label className="text-xs text-muted-foreground">Description</label><Input disabled={!canManageFinance} value={form.description ?? ""} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
          <div><label className="text-xs text-muted-foreground">Valide jusqu'au</label><Input disabled={!canManageFinance} type="datetime-local" value={form.valid_to ? String(form.valid_to).slice(0, 16) : ""} onChange={(e) => setForm({ ...form, valid_to: e.target.value })} /></div>
          <div><label className="text-xs text-muted-foreground">Arrondi</label><select disabled={!canManageFinance} className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.rounding ?? "none"} onChange={(e) => setForm({ ...form, rounding: e.target.value })}><option value="none">Aucun</option><option value="up_5">Au 0.05 sup.</option><option value="up_10">Au 0.10 sup.</option></select></div>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-4">{RULES.map((r) => <div key={r.key}><label className="text-xs text-muted-foreground">{r.label}{r.money ? " (centimes)" : ""}</label><Input disabled={!canManageFinance} type="number" min="0" value={form[r.key] ?? 0} onChange={(e) => setForm({ ...form, [r.key]: e.target.value })} /></div>)}</div>
        {canManageFinance && <Button onClick={() => void save()} disabled={saving} className="mt-4 gap-2">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Enregistrer</Button>}
      </section>

      <section className="glass liquid-border rounded-2xl p-5">
        <h2 className="mb-3 font-semibold">Affectations (priorité : borne &gt; station &gt; boutique &gt; défaut)</h2>
        <DataTable columns={["Portée", "Référence", "Active", ""]} empty="Aucune affectation" rows={data.assignments.map((a: any) => [a.scope, a.scope_ref, a.active ? "oui" : "non", canManageFinance ? <Button size="sm" variant="destructive" onClick={() => void unassign(a.id)}>retirer</Button> : "—"])} />
        {canManageFinance && <div className="mt-3 flex flex-wrap items-end gap-2"><div className="w-36"><label className="text-xs text-muted-foreground">Portée</label><select className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={assign.scope} onChange={(e) => setAssign({ ...assign, scope: e.target.value })}><option value="device">Borne</option><option value="station">Station</option><option value="shop">Boutique</option></select></div><div className="w-52"><label className="text-xs text-muted-foreground">Référence</label><Input value={assign.scope_ref} onChange={(e) => setAssign({ ...assign, scope_ref: e.target.value })} /></div><Button onClick={() => void doAssign()}>Affecter</Button></div>}
      </section>

      <section className="glass liquid-border rounded-2xl p-5"><h2 className="mb-3 flex items-center gap-2 font-semibold"><FlaskConical className="h-4 w-4" />Simulation</h2><div className="flex flex-wrap items-end gap-2"><div className="w-28"><label className="text-xs text-muted-foreground">Durée (min)</label><Input type="number" value={sim.minutes} onChange={(e) => setSim({ ...sim, minutes: e.target.value })} /></div><div className="w-44"><label className="text-xs text-muted-foreground">Scénario</label><select className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={sim.return_state} onChange={(e) => setSim({ ...sim, return_state: e.target.value })}><option value="normal">Normal</option><option value="late">Retard</option><option value="not_returned">Non retournée</option></select></div><Button onClick={() => void simulate()}>Simuler</Button></div>{simResult && <pre className="mt-3 max-h-64 overflow-auto rounded-xl bg-muted/30 p-3 text-xs">{JSON.stringify(simResult, null, 2)}</pre>}</section>

      <div className="grid gap-6 lg:grid-cols-2"><section className="glass liquid-border rounded-2xl p-5"><h2 className="mb-3 font-semibold">Historique des versions</h2><DataTable columns={["Version", "Prix/période", "Date"]} empty="—" rows={data.versions.map((v: any) => [`v${v.version}`, v.snapshot?.price_per_period_cents != null ? chf(v.snapshot.price_per_period_cents) : "—", new Date(v.created_at).toLocaleString()])} /></section><section className="glass liquid-border rounded-2xl p-5"><h2 className="mb-3 font-semibold">Locations récentes</h2><DataTable columns={["Station", "État", "Montant", "Date"]} empty="Aucune location" rows={data.rentals.map((r: any) => [r.station_id, <StateChip state={r.state} />, `${Number(r.amount_expected ?? 0).toFixed(2)} ${r.currency}`, new Date(r.created_at).toLocaleDateString()])} /></section></div>
      <section className="glass liquid-border rounded-2xl p-5"><h2 className="mb-3 font-semibold">Journal des modifications</h2><DataTable columns={["Action", "Acteur", "Date"]} empty="—" rows={data.logs.map((l: any) => [l.action, l.actor ?? "système", new Date(l.created_at).toLocaleString()])} /></section>
    </div>
  );
}
