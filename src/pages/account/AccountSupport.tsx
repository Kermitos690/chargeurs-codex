import { FormEvent, useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AlertTriangle, CheckCircle2, HelpCircle, Loader2, Mail, RefreshCw, Send } from "lucide-react";
import { useCustomer } from "@/hooks/useCustomer";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/i18n/i18n";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CustomerIncident, fetchPrivateAccountSummary, formatAccountDate } from "./accountData";

type FormState = { name: string; stationId: string; rentalId: string; message: string; website: string };

export default function AccountSupport() {
  const { user } = useCustomer();
  const { lang } = useI18n();
  const [searchParams] = useSearchParams();
  const [incidents, setIncidents] = useState<CustomerIncident[]>([]);
  const [loading, setLoading] = useState(true);
  const [summaryError, setSummaryError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({
    name: String(user?.user_metadata?.display_name ?? ""),
    stationId: searchParams.get("station")?.trim().toUpperCase() ?? "",
    rentalId: searchParams.get("rental")?.trim() ?? "",
    message: "",
    website: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    setSummaryError(false);
    try {
      const summary = await fetchPrivateAccountSummary();
      setIncidents(summary.incidents);
      setForm((current) => ({
        ...current,
        name: current.name || String(summary.profile?.display_name ?? ""),
      }));
    } catch {
      setSummaryError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setFormError(null);
    const message = [
      form.rentalId ? `Location : ${form.rentalId}` : "",
      form.message.trim(),
    ].filter(Boolean).join("\n\n");
    const { data, error } = await supabase.functions.invoke("public-contact", {
      body: {
        requestType: "support",
        locale: lang,
        name: form.name,
        email: user?.email ?? "",
        stationId: form.stationId,
        message,
        phone: "",
        organization: "",
        website: form.website,
      },
    });
    setBusy(false);
    if (error || !data?.ok) {
      const code = data?.error ?? "REQUEST_NOT_RECORDED";
      setFormError(code === "RATE_LIMITED"
        ? "Trop de demandes ont été envoyées. Réessayez plus tard."
        : code === "NOT_CONFIGURED"
          ? "Le formulaire n'est pas configuré sur cet environnement. Utilisez support@chargeurs.ch."
          : "Votre demande n'a pas pu être enregistrée. Vérifiez les champs ou contactez-nous par email.");
      return;
    }
    setRequestId(String(data.requestId));
    setForm((current) => ({ ...current, rentalId: "", message: "", website: "" }));
  };

  return (
    <div className="space-y-7 pt-3">
      <header>
        <h1 className="font-display text-3xl font-extrabold">Support</h1>
        <p className="mt-1 text-sm text-muted-foreground">Une demande enregistrée rejoint réellement la file du support Chargeurs.ch.</p>
      </header>

      {requestId ? (
        <section className="glass-strong liquid-border rounded-3xl p-8 text-center" aria-live="polite">
          <CheckCircle2 className="mx-auto h-12 w-12 text-success" />
          <h2 className="mt-4 font-display text-2xl font-bold">Demande enregistrée</h2>
          <p className="mt-2 text-muted-foreground">Référence <span className="font-mono text-foreground">{requestId.slice(0, 8)}</span>. Conservez-la pour vos échanges.</p>
          <Button variant="outline" className="mt-5 rounded-full" onClick={() => setRequestId(null)}>Ouvrir une autre demande</Button>
        </section>
      ) : (
        <section className="glass-strong liquid-border rounded-3xl p-6 sm:p-8">
          <div className="flex items-start gap-3"><HelpCircle className="mt-1 h-6 w-6 shrink-0 text-primary" /><div><h2 className="font-display text-xl font-bold">Décrire le problème</h2><p className="mt-1 text-sm text-muted-foreground">Ajoutez l'identifiant de la borne et de la location si vous les connaissez. Ne saisissez jamais de numéro de carte complet.</p></div></div>
          <form onSubmit={submit} className="mt-6 grid gap-4 sm:grid-cols-2">
            <div><label htmlFor="account-support-name" className="text-sm font-medium">Nom *</label><Input id="account-support-name" required minLength={2} maxLength={120} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></div>
            <div><label htmlFor="account-support-email" className="text-sm font-medium">Email du compte</label><Input id="account-support-email" type="email" disabled value={user?.email ?? ""} /></div>
            <div><label htmlFor="account-support-station" className="text-sm font-medium">Borne</label><Input id="account-support-station" maxLength={32} placeholder="DTA21269" value={form.stationId} onChange={(event) => setForm({ ...form, stationId: event.target.value.replace(/[^A-Za-z0-9_-]/g, "").toUpperCase() })} /></div>
            <div><label htmlFor="account-support-rental" className="text-sm font-medium">Numéro de location</label><Input id="account-support-rental" maxLength={64} value={form.rentalId} onChange={(event) => setForm({ ...form, rentalId: event.target.value.trim() })} /></div>
            <div className="hidden" aria-hidden="true"><label htmlFor="account-support-website">Site web</label><Input id="account-support-website" tabIndex={-1} autoComplete="off" value={form.website} onChange={(event) => setForm({ ...form, website: event.target.value })} /></div>
            <div className="sm:col-span-2"><label htmlFor="account-support-message" className="text-sm font-medium">Message *</label><Textarea id="account-support-message" required minLength={10} maxLength={3900} rows={6} value={form.message} onChange={(event) => setForm({ ...form, message: event.target.value })} /></div>
            {formError && <p role="alert" className="sm:col-span-2 text-sm text-destructive">{formError}</p>}
            <div className="sm:col-span-2"><Button type="submit" disabled={busy} className="rounded-full bg-gradient-primary px-7 font-bold">{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}Envoyer</Button></div>
          </form>
        </section>
      )}

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3"><div><h2 className="font-display text-xl font-bold">Incidents liés à vos locations</h2><p className="text-sm text-muted-foreground">Seuls les incidents associés à votre compte sont retournés.</p></div><Button variant="ghost" size="icon" aria-label="Actualiser les incidents" onClick={() => void load()} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /></Button></div>
        {loading && <div className="glass grid min-h-28 place-items-center rounded-2xl"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>}
        {!loading && summaryError && <p role="alert" className="rounded-2xl border border-warning/30 bg-warning/10 p-4 text-sm text-warning">Les incidents ne peuvent pas être chargés actuellement.</p>}
        {!loading && !summaryError && incidents.length === 0 && <p className="glass rounded-2xl p-5 text-sm text-muted-foreground">Aucun incident n'est associé à vos locations.</p>}
        {!loading && !summaryError && incidents.map((incident) => (
          <article key={incident.id} className="glass rounded-2xl p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><div className="flex items-center gap-2"><AlertTriangle className={`h-5 w-5 ${incident.resolved ? "text-success" : "text-warning"}`} /><h3 className="font-semibold">{incident.type.replace(/_/g, " ")}</h3></div><p className="mt-2 text-xs text-muted-foreground">{formatAccountDate(incident.created_at)}</p></div>
              <Badge variant={incident.resolved ? "secondary" : "outline"}>{incident.resolved ? "Résolu" : "En cours"}</Badge>
            </div>
          </article>
        ))}
      </section>

      <section className="glass flex flex-col items-start justify-between gap-4 rounded-2xl p-5 sm:flex-row sm:items-center">
        <div><h2 className="font-semibold">Contact direct</h2><p className="mt-1 text-sm text-muted-foreground">Pour une urgence, indiquez toujours la borne concernée.</p></div>
        <Button asChild variant="outline" className="rounded-full"><a href="mailto:support@chargeurs.ch"><Mail className="mr-2 h-4 w-4" />support@chargeurs.ch</a></Button>
      </section>
      <Link to="/compte/locations" className="inline-flex text-sm font-semibold text-primary">Consulter mes locations</Link>
    </div>
  );
}
