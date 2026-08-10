import { FormEvent, useState } from "react";
import { Loader2, Send, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/i18n/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type Props = {
  requestType: "support" | "partner_installation";
  title: string;
  description: string;
};

const EMPTY = { name: "", email: "", phone: "", organization: "", stationId: "", message: "", website: "" };

export function PublicContactForm({ requestType, title, description }: Props) {
  const { lang } = useI18n();
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [sentId, setSentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const { data, error: invokeError } = await supabase.functions.invoke("public-contact", {
      body: { requestType, locale: lang, ...form },
    });
    setBusy(false);
    if (invokeError || !data?.ok) {
      const code = data?.error ?? invokeError?.message ?? "REQUEST_NOT_RECORDED";
      setError(code === "NOT_CONFIGURED"
        ? "Le formulaire n'est pas encore configuré sur cet environnement. Utilisez l'adresse email affichée sur la page."
        : code === "RATE_LIMITED"
          ? "Trop de demandes ont été envoyées. Réessayez dans une heure."
          : "La demande n'a pas pu être enregistrée. Vérifiez les champs ou contactez-nous par email.");
      return;
    }
    setSentId(String(data.requestId));
    setForm(EMPTY);
  };

  if (sentId) {
    return (
      <section className="glass liquid-border rounded-3xl p-8 text-center">
        <CheckCircle2 className="mx-auto h-12 w-12 text-success" />
        <h2 className="mt-4 font-display text-2xl font-bold">Demande enregistrée</h2>
        <p className="mt-2 text-muted-foreground">Notre équipe dispose maintenant de votre demande. Référence : <span className="font-mono text-foreground">{sentId.slice(0, 8)}</span>.</p>
        <Button variant="outline" className="mt-5 rounded-full" onClick={() => setSentId(null)}>Envoyer une autre demande</Button>
      </section>
    );
  }

  return (
    <section className="glass liquid-border rounded-3xl p-8">
      <h2 className="font-display text-2xl font-bold">{title}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
      <form onSubmit={submit} className="mt-6 grid gap-4 sm:grid-cols-2">
        <div><label className="text-sm font-medium" htmlFor={`${requestType}-name`}>Nom *</label><Input id={`${requestType}-name`} required minLength={2} maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
        <div><label className="text-sm font-medium" htmlFor={`${requestType}-email`}>Email *</label><Input id={`${requestType}-email`} required type="email" maxLength={254} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
        <div><label className="text-sm font-medium" htmlFor={`${requestType}-phone`}>Téléphone</label><Input id={`${requestType}-phone`} type="tel" maxLength={40} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
        {requestType === "partner_installation" ? (
          <div><label className="text-sm font-medium" htmlFor="partner-organization">Établissement</label><Input id="partner-organization" maxLength={160} value={form.organization} onChange={(e) => setForm({ ...form, organization: e.target.value })} /></div>
        ) : (
          <div><label className="text-sm font-medium" htmlFor="support-station">Identifiant de borne</label><Input id="support-station" maxLength={32} value={form.stationId} onChange={(e) => setForm({ ...form, stationId: e.target.value })} /></div>
        )}
        <div className="hidden" aria-hidden="true"><label htmlFor={`${requestType}-website`}>Site web</label><Input id={`${requestType}-website`} tabIndex={-1} autoComplete="off" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} /></div>
        <div className="sm:col-span-2"><label className="text-sm font-medium" htmlFor={`${requestType}-message`}>Message *</label><Textarea id={`${requestType}-message`} required minLength={10} maxLength={4000} rows={6} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} /></div>
        {error && <p role="alert" className="sm:col-span-2 text-sm text-destructive">{error}</p>}
        <div className="sm:col-span-2">
          <Button type="submit" disabled={busy} className="rounded-full bg-gradient-primary px-8 font-bold">
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}Envoyer la demande
          </Button>
        </div>
      </form>
    </section>
  );
}
