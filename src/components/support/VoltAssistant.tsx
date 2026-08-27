import { FormEvent, useState } from "react";
import { AlertTriangle, Bot, CheckCircle2, Loader2, Send, ShieldCheck, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/i18n/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type VoltMode = "public" | "client";
type VoltPriority = "normal" | "high";
type VoltCategory = "ejection" | "return" | "payment" | "station" | "account" | "pricing" | "contact" | "general";
type VoltMessage = { id: string; role: "volt" | "user"; text: string };
type Triage = { category: VoltCategory; priority: VoltPriority; escalate: boolean; reply: string };
type PendingCase = { text: string; triage: Triage };

type Props = {
  mode: VoltMode;
  userName?: string;
  userEmail?: string;
  stationId?: string;
  rentalId?: string;
  contextHint?: string;
  onCaseCreated?: (requestId: string) => void;
};

const QUICK_ACTIONS = [
  { label: "La batterie ne sort pas", prompt: "J'ai payé mais la batterie ne sort pas de la borne." },
  { label: "Mon retour n'est pas reconnu", prompt: "J'ai rendu la batterie mais le retour n'est pas reconnu." },
  { label: "Question de paiement", prompt: "J'ai un problème ou une question concernant mon paiement." },
  { label: "La borne a un problème", prompt: "La borne semble endommagée ou ne fonctionne pas correctement." },
];

function id(prefix: string) { return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }

function isCloudflareStagingHost() {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname;
  return host === "chargeurs-ch-staging-cf.pages.dev" || host.endsWith(".chargeurs-ch-staging-cf.pages.dev");
}

async function invokeVoltCase(body: Record<string, unknown>, mode: VoltMode) {
  if (!isCloudflareStagingHost()) return supabase.functions.invoke("public-contact", { body });

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (mode === "client") {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
  }

  try {
    const response = await fetch("/api/volt-support", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      credentials: "same-origin",
      cache: "no-store",
    });
    const data = await response.json().catch(() => null);
    return { data, error: response.ok ? null : new Error(data?.error ?? `HTTP_${response.status}`) };
  } catch (error) {
    return { data: null, error };
  }
}

// UI-only preview. The server independently recomputes all category/priority/escalation
// fields before it creates a support case, so changing this function cannot grant access.
function previewTriage(raw: string): Triage {
  const text = raw.toLocaleLowerCase("fr");
  if (/(ne sort|sort pas|éject|eject|distribu|batterie.*bloqu)/.test(text)) return { category: "ejection", priority: "high", escalate: true, reply: "Je vois un problème de distribution. Je vais préparer un dossier prioritaire afin que le support puisse vérifier le paiement, la borne et l’éjection sans vous demander de tout répéter." };
  if (/(retour|rendu|rendue|restitution|toujours.*location|location.*continue)/.test(text)) return { category: "return", priority: "high", escalate: true, reply: "Le retour semble ne pas avoir été reconnu correctement. Je vais transmettre au support le contexte que le serveur peut vérifier pour votre location." };
  if (/(paiement|payé|paye|carte|débit|debit|factur|rembours|rembourse|garantie|caution)/.test(text)) return { category: "payment", priority: "normal", escalate: true, reply: "Je peux faire remonter ce dossier avec les références que le serveur peut vérifier. Ne transmettez jamais votre numéro de carte complet : le support n’en a pas besoin." };
  if (/(cass|endommag|écran|ecran|borne.*hors|borne.*marche|slot)/.test(text)) return { category: "station", priority: "high", escalate: true, reply: "Merci pour le signalement. Je vais créer un dossier borne afin que l’équipe puisse vérifier le matériel concerné." };
  if (/(humain|personne|contacter|contact|support|parler à|parler a)/.test(text)) return { category: "contact", priority: "normal", escalate: true, reply: "Oui. Je peux transmettre votre demande directement dans la file support Chargeurs.ch et vous donner une référence de suivi." };
  if (/(prix|tarif|combien|coût|cout)/.test(text)) return { category: "pricing", priority: "normal", escalate: false, reply: "Les montants affichés dans le parcours de location au moment de votre commande font foi. Si votre question concerne une location précise ou un montant inattendu, décrivez-le et je pourrai ouvrir un dossier support." };
  if (/(compte|pass|profil|connexion|connecter|crédit|credit|points)/.test(text)) return { category: "account", priority: "normal", escalate: false, reply: "Je peux vous aider sur votre compte Chargeurs.ch. Lorsqu’un dossier est créé, le serveur utilise uniquement l’identité de votre session et ne fait jamais confiance à un identifiant utilisateur envoyé par le navigateur." };
  return { category: "general", priority: "normal", escalate: false, reply: "Je peux vous aider sur une location, un retour, un paiement, une borne ou votre compte Chargeurs.ch. Décrivez ce qui s’est passé et, si une intervention humaine est nécessaire, je créerai un dossier structuré." };
}

export function VoltAssistant({ mode, userName = "", userEmail = "", stationId = "", rentalId = "", contextHint: _contextHint = "", onCaseCreated }: Props) {
  const { lang } = useI18n();
  const [messages, setMessages] = useState<VoltMessage[]>([{ id: id("volt"), role: "volt", text: mode === "client" ? "Bonjour, je suis Volt. Je peux vous aider avec votre location, votre paiement, votre retour ou votre compte Chargeurs.ch." : "Bonjour, je suis Volt, l'assistant Chargeurs.ch. Décrivez votre question ou choisissez un cas fréquent ci-dessous." }]);
  const [input, setInput] = useState("");
  const [identity, setIdentity] = useState({ name: userName, email: userEmail });
  const [pendingCase, setPendingCase] = useState<PendingCase | null>(null);
  const [busy, setBusy] = useState(false);
  const [caseId, setCaseId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const identityReady = () => identity.name.trim().length >= 2 && /^\S+@\S+\.\S+$/.test(identity.email.trim());
  const addVoltMessage = (text: string) => setMessages((current) => [...current, { id: id("volt"), role: "volt", text }]);

  const createCase = async (text: string, triage: Triage) => {
    if (busy || caseId) return;
    if (mode === "public" && !identityReady()) {
      setPendingCase({ text, triage });
      addVoltMessage("Pour transmettre ce dossier, j'ai besoin d'un nom et d'une adresse email valide. Ces informations servent uniquement à identifier et suivre la demande.");
      return;
    }
    setBusy(true); setError(null);
    const body: Record<string, unknown> = { action: "volt_case", mode, message: text, stationId, rentalId, locale: lang };
    if (mode === "public") { body.name = identity.name.trim(); body.email = identity.email.trim(); }
    const { data, error: invokeError } = await invokeVoltCase(body, mode);
    setBusy(false);
    if (invokeError || !data?.ok) {
      const code = data?.error ?? "REQUEST_NOT_RECORDED";
      setError(code === "RATE_LIMITED" ? "Trop de demandes ont été envoyées depuis cette connexion. Réessayez plus tard." : code === "RENTAL_NOT_ACCESSIBLE" ? "La référence de location ne peut pas être utilisée avec ce compte." : code === "CASE_NOT_REQUIRED" ? "Ce message ne nécessite pas encore l'ouverture d'un dossier support." : "Le dossier n'a pas pu être enregistré. Vous pouvez réessayer sans ressaisir votre message.");
      setPendingCase({ text, triage });
      return;
    }
    const requestId = String(data.requestId);
    setCaseId(requestId); setPendingCase(null);
    addVoltMessage(`C'est transmis. Votre référence support est ${requestId.slice(0, 8)}. L'équipe dispose déjà du contexte que le serveur a pu vérifier.`);
    onCaseCreated?.(requestId);
  };

  const handleUserMessage = async (text: string) => {
    const clean = text.trim();
    if (!clean || busy || clean.length > 1200) return;
    setError(null);
    setMessages((current) => [...current, { id: id("user"), role: "user", text: clean }]);
    const triage = previewTriage(clean);
    addVoltMessage(triage.reply);
    if (triage.escalate && !caseId) await createCase(clean, triage);
  };

  const submitMessage = (event: FormEvent) => { event.preventDefault(); const value = input; setInput(""); void handleUserMessage(value); };
  const submitIdentity = (event: FormEvent) => { event.preventDefault(); if (!pendingCase) return; if (!identityReady()) { setError("Saisissez un nom et une adresse email valides pour transmettre le dossier."); return; } void createCase(pendingCase.text, pendingCase.triage); };

  return (
    <section className="glass-strong liquid-border overflow-hidden rounded-3xl" aria-label="Volt, assistant Chargeurs.ch">
      <header className="border-b border-border/70 bg-card/40 px-5 py-5 sm:px-7"><div className="flex items-center justify-between gap-4"><div className="flex items-center gap-3"><div className="grid h-11 w-11 place-items-center rounded-2xl bg-primary/15 text-primary shadow-glow"><Bot className="h-6 w-6" /></div><div><div className="flex items-center gap-2"><h2 className="font-display text-xl font-extrabold">Volt</h2><span className="rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-[0.68rem] font-bold uppercase tracking-wide text-success">Chargeurs.ch</span></div><p className="text-xs text-muted-foreground">Support Chargeurs.ch · escalade humaine intégrée</p></div></div><ShieldCheck className="h-5 w-5 text-success" aria-label="Contexte protégé" /></div></header>
      <div className="max-h-[32rem] space-y-4 overflow-y-auto px-5 py-6 sm:px-7" aria-live="polite">
        {messages.map((message) => <div key={message.id} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}><div className={message.role === "user" ? "max-w-[88%] rounded-2xl rounded-br-md bg-primary px-4 py-3 text-sm leading-6 text-primary-foreground" : "max-w-[88%] rounded-2xl rounded-bl-md border border-border bg-background/70 px-4 py-3 text-sm leading-6 text-foreground"}>{message.text}</div></div>)}
        {pendingCase && !caseId && mode === "public" && <form onSubmit={submitIdentity} className="rounded-2xl border border-primary/25 bg-primary/5 p-4"><div className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><p className="text-sm font-medium">Transmission au support</p></div><div className="mt-4 grid gap-3 sm:grid-cols-2"><Input aria-label="Votre nom" placeholder="Votre nom" required minLength={2} maxLength={120} value={identity.name} onChange={(event) => setIdentity((current) => ({ ...current, name: event.target.value }))} /><Input aria-label="Votre email" placeholder="vous@exemple.ch" type="email" required maxLength={254} value={identity.email} onChange={(event) => setIdentity((current) => ({ ...current, email: event.target.value }))} /></div>{error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}<Button type="submit" disabled={busy} className="mt-4 rounded-full bg-gradient-primary font-bold">{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}Transmettre le dossier</Button></form>}
        {error && !(pendingCase && mode === "public") && <p role="alert" className="rounded-2xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
        {caseId && <div className="rounded-2xl border border-success/30 bg-success/10 p-4 text-sm text-success"><div className="flex items-center gap-2 font-semibold"><CheckCircle2 className="h-4 w-4" />Dossier transmis</div><p className="mt-1">Référence <span className="font-mono">{caseId.slice(0, 8)}</span>.</p></div>}
      </div>
      <div className="border-t border-border/70 bg-card/30 px-5 py-5 sm:px-7">
        {!caseId && <div className="mb-4 flex flex-wrap gap-2">{QUICK_ACTIONS.map((action) => <button key={action.label} type="button" disabled={busy} onClick={() => void handleUserMessage(action.prompt)} className="rounded-full border border-border bg-background/70 px-3 py-2 text-xs font-semibold text-muted-foreground transition hover:border-primary/40 hover:text-foreground disabled:opacity-50">{action.label}</button>)}</div>}
        <form onSubmit={submitMessage} className="flex gap-2"><Input value={input} disabled={busy} maxLength={1200} onChange={(event) => setInput(event.target.value)} placeholder="Écrivez votre message à Volt…" aria-label="Message à Volt" /><Button type="submit" size="icon" disabled={busy || !input.trim()} className="shrink-0 rounded-xl bg-gradient-primary" aria-label="Envoyer">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}</Button></form>
        <div className="mt-3 flex items-start gap-2 text-[0.72rem] leading-5 text-muted-foreground"><Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" /><p>Les réponses courantes sont déterministes et locales, sans coût API. Lorsqu'un dossier est transmis, le serveur recalcule lui-même la catégorie, la priorité et le contexte autorisé avant toute écriture.</p></div>
      </div>
    </section>
  );
}
