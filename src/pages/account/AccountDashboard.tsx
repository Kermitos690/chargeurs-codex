import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Loader2, BatteryCharging, MapPin, Receipt, RefreshCw, Download, Save, Trash2, ShieldCheck } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";

type Rental = {
  id: string;
  station_id: string | null;
  state: string;
  amount_paid: number | null;
  amount_expected: number | null;
  currency: string | null;
  created_at: string;
  paid_at: string | null;
  ejected_at: string | null;
  returned_at: string | null;
  closed_at: string | null;
};

const ACTIVE_STATES = ["ejected", "battery_taken", "active_rental"];

const STATE_LABELS: Record<string, string> = {
  ejected: "Batterie distribuée",
  battery_taken: "Batterie retirée",
  active_rental: "Location en cours",
  battery_returned: "Batterie rendue",
  closing: "Clôture en cours",
  closed: "Terminée",
  payment_succeeded: "Payée",
  refunded: "Remboursée",
  partially_refunded: "Partiellement remboursée",
  refund_pending: "Remboursement en cours",
  needs_support: "Vérification en cours",
};

function stateLabel(s: string) {
  return STATE_LABELS[s] ?? s;
}

function money(amount: number | null, currency: string | null) {
  if (amount == null) return "—";
  return new Intl.NumberFormat("fr-CH", { style: "currency", currency: currency ?? "CHF" }).format(amount);
}

function fmtDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleString("fr-CH", { dateStyle: "medium", timeStyle: "short" });
}

export default function AccountDashboard() {
  const [rentals, setRentals] = useState<Rental[]>([]);
  const [loading, setLoading] = useState(true);
  const [payments, setPayments] = useState<Array<{ id: string; status: string; amount: number | null; currency: string | null; payment_method: string | null; created_at: string }>>([]);
  const [refunds, setRefunds] = useState<Array<{ id: string; status: string; amount: number; currency: string; created_at: string }>>([]);
  const [incidents, setIncidents] = useState<Array<{ id: string; type: string; severity: string; resolved: boolean; created_at: string }>>([]);
  const [profile, setProfile] = useState({ display_name: "", phone: "", preferred_language: "fr", marketing_consent: false });
  const [privacyBusy, setPrivacyBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("rental_sessions")
      .select("id,station_id,state,amount_paid,amount_expected,currency,created_at,paid_at,ejected_at,returned_at,closed_at")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) {
      toast.error("Impossible de charger vos locations.");
    } else {
      setRentals((data ?? []) as Rental[]);
    }
    const { data: privacyData } = await supabase.functions.invoke("account-privacy", { body: { action: "summary" } });
    if (privacyData?.ok) {
      const summary = privacyData.data as {
        profile?: Record<string, unknown> | null;
        payments?: typeof payments;
        refunds?: typeof refunds;
        incidents?: typeof incidents;
      };
      setPayments(summary.payments ?? []);
      setRefunds(summary.refunds ?? []);
      setIncidents(summary.incidents ?? []);
      if (summary.profile) setProfile({
        display_name: String(summary.profile.display_name ?? ""),
        phone: String(summary.profile.phone ?? ""),
        preferred_language: String(summary.profile.preferred_language ?? "fr"),
        marketing_consent: Boolean(summary.profile.marketing_consent),
      });
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const active = rentals.filter((r) => ACTIVE_STATES.includes(r.state));
  const history = rentals.filter((r) => !ACTIVE_STATES.includes(r.state));

  const saveProfile = async () => {
    setPrivacyBusy(true);
    const { error } = await supabase.from("profiles").update({
      display_name: profile.display_name || null,
      phone: profile.phone || null,
      preferred_language: profile.preferred_language,
      marketing_consent: profile.marketing_consent,
      privacy_acknowledged_at: new Date().toISOString(),
    } as never).eq("id", (await supabase.auth.getUser()).data.user?.id ?? "");
    setPrivacyBusy(false);
    if (error) toast.error("Le profil n'a pas pu être enregistré.");
    else toast.success("Profil enregistré.");
  };

  const exportData = async () => {
    setPrivacyBusy(true);
    const { data, error } = await supabase.functions.invoke("account-privacy", { body: { action: "export" } });
    setPrivacyBusy(false);
    if (error || !data?.ok) return toast.error("L'export n'a pas pu être généré.");
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = `chargeurs-export-${new Date().toISOString().slice(0, 10)}.json`; anchor.click();
    URL.revokeObjectURL(url);
  };

  const deleteAccount = async () => {
    const confirmation = window.prompt("Cette action est définitive. Tapez DELETE_ACCOUNT pour confirmer.");
    if (confirmation !== "DELETE_ACCOUNT") return;
    setPrivacyBusy(true);
    const { data, error } = await supabase.functions.invoke("account-privacy", { body: { action: "delete", confirmation } });
    setPrivacyBusy(false);
    if (error || !data?.ok) {
      toast.error(data?.error === "ACTIVE_OR_UNSETTLED_RENTAL"
        ? "Suppression impossible tant qu'une location ou un règlement est actif."
        : "Le compte n'a pas pu être supprimé.");
      return;
    }
    await supabase.auth.signOut();
    window.location.assign("/");
  };

  return (
    <div className="space-y-8 pt-2">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold">Mes locations</h1>
          <p className="text-sm text-muted-foreground">Historique et suivi de vos batteries louées.</p>
        </div>
        <Button variant="outline" size="sm" className="rounded-full" onClick={load} disabled={loading}>
          <RefreshCw className={`mr-1.5 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Actualiser
        </Button>
      </header>

      {loading ? (
        <div className="grid place-items-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
      ) : rentals.length === 0 ? (
        <div className="glass rounded-3xl p-10 text-center">
          <BatteryCharging className="mx-auto mb-4 h-10 w-10 text-primary" />
          <p className="font-semibold">Aucune location pour le moment</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Vos locations apparaîtront ici après un paiement effectué avec cette adresse email.
          </p>
        </div>
      ) : (
        <>
          {active.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">En cours</h2>
              {active.map((r) => (
                <div key={r.id} className="glass-strong liquid-border rounded-3xl p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <BatteryCharging className="h-5 w-5 text-primary" />
                        <span className="font-semibold">{stateLabel(r.state)}</span>
                      </div>
                      <p className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
                        <MapPin className="h-4 w-4" /> Borne {r.station_id ?? "—"}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">Démarrée le {fmtDate(r.ejected_at ?? r.paid_at)}</p>
                    </div>
                    <Badge className="bg-gradient-primary">{money(r.amount_paid ?? r.amount_expected, r.currency)}</Badge>
                  </div>
                </div>
              ))}
            </section>
          )}

          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Historique</h2>
            {history.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucune location passée.</p>
            ) : (
              history.map((r) => (
                <div key={r.id} className="glass rounded-2xl p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Receipt className="h-4 w-4 text-muted-foreground" />
                        <span className="font-semibold">{stateLabel(r.state)}</span>
                      </div>
                      <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                        <MapPin className="h-4 w-4" /> Borne {r.station_id ?? "—"}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">{fmtDate(r.paid_at ?? r.created_at)}</p>
                    </div>
                    <Badge variant="secondary">{money(r.amount_paid ?? r.amount_expected, r.currency)}</Badge>
                  </div>
                </div>
              ))
            )}
          </section>
        </>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Paiements et remboursements</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="glass rounded-2xl p-4"><p className="font-semibold">Paiements</p><p className="mt-1 text-2xl font-bold">{payments.length}</p><p className="text-xs text-muted-foreground">Historique relié à vos locations</p></div>
          <div className="glass rounded-2xl p-4"><p className="font-semibold">Remboursements</p><p className="mt-1 text-2xl font-bold">{refunds.length}</p><p className="text-xs text-muted-foreground">{refunds.some((refund) => refund.status === "pending") ? "Un remboursement est en cours" : "Aucun remboursement en attente"}</p></div>
        </div>
        {incidents.length > 0 && <div className="glass rounded-2xl p-4"><p className="font-semibold">Incidents liés à vos locations</p><p className="mt-1 text-sm text-muted-foreground">{incidents.filter((incident) => !incident.resolved).length} ouvert(s), {incidents.filter((incident) => incident.resolved).length} résolu(s).</p></div>}
      </section>

      <section className="glass-strong liquid-border space-y-5 rounded-3xl p-6">
        <div><h2 className="flex items-center gap-2 font-display text-xl font-bold"><ShieldCheck className="h-5 w-5 text-primary" />Profil et confidentialité</h2><p className="mt-1 text-sm text-muted-foreground">Modifiez vos informations, exportez vos données ou supprimez votre compte.</p></div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><label className="text-sm font-medium">Nom affiché</label><Input value={profile.display_name} onChange={(e) => setProfile({ ...profile, display_name: e.target.value })} /></div>
          <div><label className="text-sm font-medium">Téléphone</label><Input type="tel" value={profile.phone} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} /></div>
          <div><label className="text-sm font-medium">Langue préférée</label><select className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={profile.preferred_language} onChange={(e) => setProfile({ ...profile, preferred_language: e.target.value })}><option value="fr">Français</option><option value="de">Deutsch</option><option value="it">Italiano</option><option value="en">English</option></select></div>
          <label className="flex items-center gap-3 self-end rounded-xl border border-border p-3 text-sm"><Checkbox checked={profile.marketing_consent} onCheckedChange={(checked) => setProfile({ ...profile, marketing_consent: checked === true })} />Recevoir les informations commerciales (facultatif)</label>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={saveProfile} disabled={privacyBusy}><Save className="mr-2 h-4 w-4" />Enregistrer</Button>
          <Button onClick={exportData} disabled={privacyBusy} variant="outline"><Download className="mr-2 h-4 w-4" />Exporter mes données</Button>
          <Button onClick={deleteAccount} disabled={privacyBusy} variant="destructive"><Trash2 className="mr-2 h-4 w-4" />Supprimer mon compte</Button>
        </div>
      </section>
    </div>
  );
}
