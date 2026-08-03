import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Download, Loader2, Save, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useCustomer } from "@/hooks/useCustomer";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { CustomerProfile, fetchPrivateAccountSummary, profileFromRecord } from "./accountData";

const EMPTY_PROFILE: CustomerProfile = { display_name: "", phone: "", preferred_language: "fr", marketing_consent: false };

export default function AccountProfile() {
  const { user } = useCustomer();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<CustomerProfile>(EMPTY_PROFILE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const summary = await fetchPrivateAccountSummary();
      setProfile(profileFromRecord(summary.profile));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    if (!user) return;
    setBusy(true);
    const { error: updateError } = await supabase.from("profiles").update({
      display_name: profile.display_name.trim() || null,
      phone: profile.phone.trim() || null,
      preferred_language: profile.preferred_language,
      marketing_consent: profile.marketing_consent,
      privacy_acknowledged_at: new Date().toISOString(),
    } as never).eq("id", user.id);
    setBusy(false);
    if (updateError) toast.error("Le profil n'a pas pu être enregistré.");
    else toast.success("Profil enregistré.");
  };

  const exportData = async () => {
    setBusy(true);
    const { data, error: exportError } = await supabase.functions.invoke("account-privacy", { body: { action: "export" } });
    setBusy(false);
    if (exportError || !data?.ok) {
      toast.error("L'export n'a pas pu être généré.");
      return;
    }
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `chargeurs-export-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const deleteAccount = async () => {
    const confirmation = window.prompt("Cette action est définitive. Tapez DELETE_ACCOUNT pour confirmer.");
    if (confirmation !== "DELETE_ACCOUNT") return;
    setBusy(true);
    const { data, error: deleteError } = await supabase.functions.invoke("account-privacy", {
      body: { action: "delete", confirmation },
    });
    setBusy(false);
    if (deleteError || !data?.ok) {
      toast.error(data?.error === "ACTIVE_OR_UNSETTLED_RENTAL"
        ? "Suppression impossible tant qu'une location ou un règlement est actif."
        : "Le compte n'a pas pu être supprimé.");
      return;
    }
    await supabase.auth.signOut();
    navigate("/", { replace: true });
  };

  return (
    <div className="space-y-7 pt-3">
      <header>
        <h1 className="font-display text-3xl font-extrabold">Profil</h1>
        <p className="mt-1 text-sm text-muted-foreground">Gérez vos coordonnées, vos préférences et vos droits sur les données.</p>
      </header>

      {loading && <div className="glass grid min-h-56 place-items-center rounded-3xl"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>}
      {!loading && error && (
        <section className="rounded-3xl border border-warning/30 bg-warning/10 p-6" role="alert">
          <h2 className="font-semibold text-warning">Votre profil ne peut pas être chargé</h2>
          <p className="mt-1 text-sm text-muted-foreground">Aucune information par défaut n'a été présentée comme enregistrée.</p>
          <Button variant="outline" size="sm" className="mt-4 rounded-full" onClick={() => void load()}>Réessayer</Button>
        </section>
      )}

      {!loading && !error && (
        <section className="glass-strong liquid-border space-y-6 rounded-3xl p-6 sm:p-8">
          <div className="flex items-start gap-3"><ShieldCheck className="mt-1 h-6 w-6 text-primary" /><div><h2 className="font-display text-xl font-bold">Informations du compte</h2><p className="mt-1 text-sm text-muted-foreground">L'email d'authentification ne peut pas être modifié depuis cet écran.</p></div></div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div><label htmlFor="profile-email" className="text-sm font-medium">Email</label><Input id="profile-email" type="email" disabled value={user?.email ?? ""} /></div>
            <div><label htmlFor="profile-display-name" className="text-sm font-medium">Nom affiché</label><Input id="profile-display-name" maxLength={120} value={profile.display_name} onChange={(event) => setProfile({ ...profile, display_name: event.target.value })} /></div>
            <div><label htmlFor="profile-phone" className="text-sm font-medium">Téléphone</label><Input id="profile-phone" type="tel" maxLength={40} value={profile.phone} onChange={(event) => setProfile({ ...profile, phone: event.target.value })} /></div>
            <div><label htmlFor="profile-language" className="text-sm font-medium">Langue préférée</label><select id="profile-language" className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={profile.preferred_language} onChange={(event) => setProfile({ ...profile, preferred_language: event.target.value })}><option value="fr">Français</option><option value="de">Deutsch</option><option value="it">Italiano</option><option value="en">English</option></select></div>
          </div>
          <label className="flex items-start gap-3 rounded-2xl border border-border p-4 text-sm"><Checkbox checked={profile.marketing_consent} onCheckedChange={(checked) => setProfile({ ...profile, marketing_consent: checked === true })} /><span><strong className="block">Actualités Chargeurs.ch</strong><span className="text-muted-foreground">Recevoir les nouveautés et offres. Facultatif et désactivable à tout moment.</span></span></label>
          <Button onClick={() => void save()} disabled={busy} className="rounded-full bg-gradient-primary px-7 font-bold">{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Enregistrer</Button>
        </section>
      )}

      <section className="glass rounded-3xl p-6">
        <h2 className="font-display text-xl font-bold">Confidentialité</h2>
        <p className="mt-2 text-sm text-muted-foreground">Téléchargez une copie des données rattachées à votre compte. La suppression est bloquée lorsqu'une location ou un règlement est encore actif.</p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Button variant="outline" onClick={() => void exportData()} disabled={busy} className="rounded-full"><Download className="mr-2 h-4 w-4" />Exporter mes données</Button>
          <Button variant="destructive" onClick={() => void deleteAccount()} disabled={busy} className="rounded-full"><Trash2 className="mr-2 h-4 w-4" />Supprimer mon compte</Button>
        </div>
      </section>
    </div>
  );
}
