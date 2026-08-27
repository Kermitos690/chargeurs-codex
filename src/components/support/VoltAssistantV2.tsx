import { FormEvent, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Send } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/i18n/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type VoltMode = "public" | "client";
type VoltPriority = "normal" | "high";
type VoltCategory = "ejection" | "return" | "payment" | "station" | "account" | "pricing" | "contact" | "general";
type VoltMessage = { id: string; role: "volt" | "user"; text: string };
type Triage = { category: VoltCategory; priority: VoltPriority; escalate: boolean };
type PendingCase = { text: string; triage: Triage };
type ChatResult = {
  ok?: boolean;
  reply?: string;
  triage?: { category?: VoltCategory; priority?: VoltPriority; escalate?: boolean };
  provider?: string;
  aiReady?: boolean;
};

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
  "La batterie ne sort pas",
  "Mon retour n'est pas reconnu",
  "Question de paiement",
  "La borne a un problème",
];

const QUICK_PROMPTS: Record<string, string> = {
  "La batterie ne sort pas": "J'ai payé mais la batterie ne sort pas de la borne.",
  "Mon retour n'est pas reconnu": "J'ai rendu la batterie mais mon retour n'est pas reconnu.",
  "Question de paiement": "J'ai un problème ou une question concernant mon paiement.",
  "La borne a un problème": "La borne a un problème ou ne fonctionne pas correctement.",
};

function id(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function validEmail(email: string) {
  return /^\S+@\S+\.\S+$/.test(email.trim());
}

function isCloudflareStagingHost() {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname;
  return host === "chargeurs-ch-staging-cf.pages.dev" || host.endsWith(".chargeurs-ch-staging-cf.pages.dev");
}

function cleanReply(text: string) {
  return text
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/\*\*/g, "")
    .replace(/\*(?=\s|$)/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function loadingLabel(raw: string) {
  const text = raw.toLocaleLowerCase("fr");
  if (/^(salut|bonjour|hello|hey|coucou|yo|yoyo|yop|ça va|ca va|comment ça va|comment ca va|merci)/.test(text)) return "Volt te répond…";
  if (/(prix|tarif|combien|co[ûu]t|palier)/.test(text)) return "Volt vérifie les tarifs…";
  if (/(paiement|payé|paye|retour|rendu|borne|batterie|location|compte|pass)/.test(text)) return "Volt vérifie les informations utiles…";
  return "Volt réfléchit…";
}

function fallbackTriage(raw: string): Triage {
  const text = raw.toLocaleLowerCase("fr");
  if (/(pay[ée].*(ne sort|sort pas)|batterie.*(ne sort|sort pas|bloqu))/.test(text)) return { category: "ejection", priority: "high", escalate: true };
  if (/((rendu|rendue).*(pas reconnu|non reconnu|continue|toujours)|retour.*(pas reconnu|non reconnu))/.test(text)) return { category: "return", priority: "high", escalate: true };
  if (/(d[ée]bit.*(double|inattendu|incorrect)|factur.*(double|inattendu|incorrect)|rembours.*(pas|attend|retard)|montant.*(faux|incorrect|inattendu))/.test(text)) return { category: "payment", priority: "normal", escalate: true };
  if (/(cass|endommag|borne.*(hors|marche pas|ne fonctionne)|slot.*(bloqu|cass))/.test(text)) return { category: "station", priority: "high", escalate: true };
  if (/(humain|personne|contacter|contact|support|parler [àa])/.test(text)) return { category: "contact", priority: "normal", escalate: true };
  if (/(prix|tarif|combien|co[ûu]t)/.test(text)) return { category: "pricing", priority: "normal", escalate: false };
  if (/(paiement|payer|carte|twint|apple pay|google pay|remboursement)/.test(text)) return { category: "payment", priority: "normal", escalate: false };
  if (/(retour|rendre|restitution|restituer)/.test(text)) return { category: "return", priority: "normal", escalate: false };
  if (/(compte|pass|profil|connexion|cr[ée]dit|points|abonnement|adh[ée]sion|wallet)/.test(text)) return { category: "account", priority: "normal", escalate: false };
  return { category: "general", priority: "normal", escalate: false };
}

function suggestionsFor(message: string, triage: Triage): string[] {
  const text = message.toLocaleLowerCase("fr");

  if (triage.category === "payment" && !triage.escalate) {
    return [
      "J'ai eu un débit inattendu",
      "Mon paiement a été refusé",
      "J'attends un remboursement",
      "J'ai payé mais la batterie ne sort pas",
    ];
  }
  if (triage.category === "ejection") {
    return ["Le paiement est confirmé", "Je vois un débit mais rien ne sort", "Je veux contacter le support"];
  }
  if (triage.category === "return") {
    return ["La location continue après le retour", "Je ne vois pas le retour dans mon compte", "Je veux contacter le support"];
  }
  if (triage.category === "station") {
    return ["L'écran ne répond plus", "Un emplacement semble bloqué", "Je veux signaler cette borne"];
  }
  if (triage.category === "pricing") {
    return ["Combien coûte 2 heures ?", "Combien coûte 24 heures ?", "Et pour les clients Chargeurs+ ?"];
  }
  if (triage.category === "account") {
    return ["Comment fonctionne Chargeurs+ ?", "Où voir mon crédit ?", "Comment retrouver ma location ?"];
  }
  if (/(salut|bonjour|ça va|ca va|yo|yoyo)/.test(text)) {
    return ["Quels sont les tarifs ?", "Comment louer une batterie ?", "J'ai besoin d'aide"];
  }
  return [];
}

async function invokeVoltChat(body: Record<string, unknown>) {
  if (!isCloudflareStagingHost()) return { data: null as ChatResult | null, error: new Error("VOLT_CHAT_NOT_AVAILABLE") };
  try {
    const response = await fetch("/api/volt-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      credentials: "same-origin",
      cache: "no-store",
    });
    const data = await response.json().catch(() => null) as ChatResult | null;
    return { data, error: response.ok ? null : new Error(`HTTP_${response.status}`) };
  } catch (error) {
    return { data: null as ChatResult | null, error };
  }
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

export function VoltAssistantV2({ mode, userName = "", userEmail = "", stationId = "", rentalId = "", contextHint = "", onCaseCreated }: Props) {
  const { lang } = useI18n();
  const initialPublicEmailReady = mode === "client" || validEmail(userEmail);
  const [emailReady, setEmailReady] = useState(initialPublicEmailReady);
  const [identity, setIdentity] = useState({ name: userName, email: userEmail });
  const [messages, setMessages] = useState<VoltMessage[]>([
    {
      id: id("volt"),
      role: "volt",
      text: mode === "client"
        ? "Bonjour, je suis Volt. Posez-moi votre question."
        : initialPublicEmailReady
          ? "Bonjour, je suis Volt. Comment puis-je vous aider ?"
          : "Bonjour, je suis Volt ⚡ Avant de commencer, indiquez votre adresse email. Elle servira à retrouver cette conversation si un suivi devient nécessaire.",
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadingText, setLoadingText] = useState("Volt réfléchit…");
  const [pendingCase, setPendingCase] = useState<PendingCase | null>(null);
  const [caseId, setCaseId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);

  const needsPublicEmail = mode === "public" && !emailReady;
  const supportIdentityReady = mode === "client" || (validEmail(identity.email) && identity.name.trim().length >= 2);
  const canChat = !needsPublicEmail && !busy;

  const addVoltMessage = (text: string) => {
    const cleaned = cleanReply(text);
    if (cleaned) setMessages((current) => [...current, { id: id("volt"), role: "volt", text: cleaned }]);
  };

  const conversationHistory = useMemo(() => messages.slice(-10).map((message) => ({
    role: message.role === "volt" ? "assistant" : "user",
    content: message.text,
  })), [messages]);

  const createCase = async (text: string, triage: Triage) => {
    if (busy || caseId) return;
    if (!supportIdentityReady) {
      setPendingCase({ text, triage });
      return;
    }
    setLoadingText("Volt transmet le dossier…");
    setBusy(true);
    setError(null);
    const body: Record<string, unknown> = { action: "volt_case", mode, message: text, stationId, rentalId, locale: lang };
    if (mode === "public") {
      body.name = identity.name.trim();
      body.email = identity.email.trim();
    }
    const { data, error: invokeError } = await invokeVoltCase(body, mode);
    setBusy(false);
    if (invokeError || !data?.ok) {
      const code = data?.error ?? "REQUEST_NOT_RECORDED";
      setError(code === "RATE_LIMITED" ? "Trop de demandes ont été envoyées depuis cette connexion. Réessayez plus tard." : "Le dossier n'a pas pu être enregistré. Vous pouvez réessayer sans ressaisir votre message.");
      setPendingCase({ text, triage });
      return;
    }
    const requestId = String(data.requestId);
    setCaseId(requestId);
    setPendingCase(null);
    setSuggestions([]);
    addVoltMessage(`C'est transmis. Votre référence support est ${requestId.slice(0, 8)}.`);
    onCaseCreated?.(requestId);
  };

  const handleUserMessage = async (text: string) => {
    const clean = text.trim();
    if (!clean || !canChat || clean.length > 1200) return;
    setError(null);
    setSuggestions([]);

    const history = conversationHistory;
    setMessages((current) => [...current, { id: id("user"), role: "user", text: clean }]);
    setLoadingText(loadingLabel(clean));
    setBusy(true);

    const { data: chat, error: chatError } = await invokeVoltChat({
      mode,
      message: clean,
      history,
      stationId,
      rentalId,
      contextHint: mode === "client" ? contextHint : "",
      locale: lang,
    });
    setBusy(false);

    const fallback = fallbackTriage(clean);
    const triage: Triage = {
      category: chat?.triage?.category ?? fallback.category,
      priority: chat?.triage?.priority ?? fallback.priority,
      escalate: chat?.triage?.escalate ?? fallback.escalate,
    };

    const reply = !chatError && chat?.ok && chat.reply
      ? chat.reply
      : "Je n'ai pas pu obtenir la réponse complète. Vous pouvez reformuler ou choisir une option ci-dessous.";
    addVoltMessage(reply);
    setSuggestions(suggestionsFor(clean, triage));

    if (triage.escalate && !caseId) setPendingCase({ text: clean, triage });
  };

  const submitEmail = (event: FormEvent) => {
    event.preventDefault();
    if (!validEmail(identity.email)) {
      setError("Saisissez une adresse email valide pour commencer.");
      return;
    }
    setError(null);
    setEmailReady(true);
    addVoltMessage("Parfait, merci. Comment puis-je vous aider ?");
    setSuggestions(["Quels sont les tarifs ?", "Comment louer une batterie ?", "J'ai besoin d'aide"]);
  };

  const submitMessage = (event: FormEvent) => {
    event.preventDefault();
    const value = input;
    setInput("");
    void handleUserMessage(value);
  };

  const submitIdentity = (event: FormEvent) => {
    event.preventDefault();
    if (!pendingCase) return;
    if (identity.name.trim().length < 2) {
      setError("Indiquez votre nom pour transmettre ce dossier.");
      return;
    }
    void createCase(pendingCase.text, pendingCase.triage);
  };

  return (
    <section className="glass-strong liquid-border overflow-hidden rounded-3xl" aria-label="Volt, assistant Chargeurs.ch">
      <div className="max-h-[32rem] space-y-4 overflow-y-auto px-5 py-6 sm:px-7" aria-live="polite">
        {messages.map((message) => (
          <div key={message.id} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={message.role === "user" ? "max-w-[88%] rounded-2xl rounded-br-md bg-primary px-4 py-3 text-sm leading-6 text-primary-foreground" : "max-w-[88%] rounded-2xl rounded-bl-md border border-border bg-background/70 px-4 py-3 text-sm leading-6 text-foreground"}>
              {message.text}
            </div>
          </div>
        ))}

        {busy && (
          <div className="flex justify-start">
            <div className="inline-flex items-center gap-2 rounded-2xl rounded-bl-md border border-border bg-background/70 px-4 py-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />{loadingText}
            </div>
          </div>
        )}

        {needsPublicEmail && (
          <form onSubmit={submitEmail} className="rounded-2xl border border-primary/25 bg-primary/5 p-4">
            <p className="text-sm font-semibold">Votre email</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">Il permet à Volt d'associer un éventuel suivi à cette conversation. Aucun compte n'est créé automatiquement.</p>
            <div className="mt-3 flex gap-2">
              <Input
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="vous@exemple.ch"
                value={identity.email}
                onChange={(event) => setIdentity((current) => ({ ...current, email: event.target.value }))}
                aria-label="Votre email"
                required
              />
              <Button type="submit" className="shrink-0 rounded-xl bg-gradient-primary font-bold">Continuer</Button>
            </div>
            {error && <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}
          </form>
        )}

        {!needsPublicEmail && suggestions.length > 0 && !busy && !caseId && (
          <div className="flex flex-wrap gap-2" aria-label="Réponses proposées">
            {suggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => void handleUserMessage(suggestion)}
                className="rounded-full border border-primary/30 bg-primary/10 px-3 py-2 text-left text-xs font-semibold text-foreground transition hover:border-primary/60 hover:bg-primary/15"
              >
                {suggestion}
              </button>
            ))}
          </div>
        )}

        {pendingCase && !caseId && !needsPublicEmail && (
          mode === "public" ? (
            <form onSubmit={submitIdentity} className="rounded-2xl border border-primary/25 bg-primary/5 p-4">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <div>
                  <p className="text-sm font-medium">Une vérification support peut être utile</p>
                  <p className="mt-1 text-xs text-muted-foreground">Votre email est déjà enregistré pour cette conversation. Indiquez simplement votre nom si vous souhaitez transmettre le dossier.</p>
                </div>
              </div>
              <div className="mt-3">
                <Input
                  aria-label="Votre nom"
                  placeholder="Votre nom"
                  required
                  minLength={2}
                  maxLength={120}
                  value={identity.name}
                  onChange={(event) => setIdentity((current) => ({ ...current, name: event.target.value }))}
                />
              </div>
              {error && <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}
              <div className="mt-3 flex flex-wrap gap-2">
                <Button type="submit" disabled={busy} className="rounded-full bg-gradient-primary font-bold"><Send className="mr-2 h-4 w-4" />Transmettre au support</Button>
                <Button type="button" variant="ghost" className="rounded-full" onClick={() => { setPendingCase(null); setError(null); }}>Pas maintenant</Button>
              </div>
            </form>
          ) : (
            <div className="rounded-2xl border border-primary/25 bg-primary/5 p-4">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <div>
                  <p className="text-sm font-medium">Une vérification support peut être utile</p>
                  <p className="mt-1 text-xs text-muted-foreground">Rien n'est envoyé sans votre confirmation.</p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button type="button" disabled={busy} className="rounded-full bg-gradient-primary font-bold" onClick={() => void createCase(pendingCase.text, pendingCase.triage)}><Send className="mr-2 h-4 w-4" />Transmettre au support</Button>
                <Button type="button" variant="ghost" className="rounded-full" onClick={() => { setPendingCase(null); setError(null); }}>Pas maintenant</Button>
              </div>
            </div>
          )
        )}

        {caseId && (
          <div className="rounded-2xl border border-success/30 bg-success/10 p-4 text-sm text-success">
            <div className="flex items-center gap-2 font-semibold"><CheckCircle2 className="h-4 w-4" />Dossier transmis</div>
            <p className="mt-1">Référence <span className="font-mono">{caseId.slice(0, 8)}</span>.</p>
          </div>
        )}
      </div>

      {!needsPublicEmail && (
        <div className="border-t border-border/70 bg-card/30 px-5 py-5 sm:px-7">
          {!caseId && suggestions.length === 0 && (
            <div className="mb-4 flex flex-wrap gap-2">
              {QUICK_ACTIONS.map((label) => (
                <button
                  key={label}
                  type="button"
                  disabled={busy}
                  onClick={() => void handleUserMessage(QUICK_PROMPTS[label])}
                  className="rounded-full border border-border bg-background/70 px-3 py-2 text-xs font-semibold text-muted-foreground transition hover:border-primary/40 hover:text-foreground disabled:opacity-50"
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          <form onSubmit={submitMessage} className="flex gap-2">
            <Input
              value={input}
              disabled={busy}
              maxLength={1200}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Écrivez votre message à Volt…"
              aria-label="Message à Volt"
            />
            <Button type="submit" size="icon" disabled={busy || !input.trim()} className="shrink-0 rounded-xl bg-gradient-primary" aria-label="Envoyer">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </form>
        </div>
      )}
    </section>
  );
}
