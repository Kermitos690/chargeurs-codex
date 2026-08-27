export type VoltMode = "public" | "client";
export type VoltPriority = "normal" | "high";
export type VoltCategory = "ejection" | "return" | "payment" | "station" | "account" | "pricing" | "contact" | "general";

export type VoltServerContext = {
  rentalId?: string | null;
  stationId?: string | null;
  rentalState?: string | null;
};

export type VoltTriage = {
  category: VoltCategory;
  priority: VoltPriority;
  escalate: boolean;
  reply: string;
  provider: "deterministic";
  externalCall: false;
};

export const VOLT_MESSAGE_MAX_LENGTH = 1200;

export function validateVoltText(value: unknown): { ok: true; value: string } | { ok: false; code: string } {
  if (typeof value !== "string") return { ok: false, code: "INVALID_MESSAGE" };
  const text = value.trim();
  if (!text || text.length > VOLT_MESSAGE_MAX_LENGTH) return { ok: false, code: "INVALID_MESSAGE" };
  return { ok: true, value: text };
}

export function triageVoltMessage(raw: string, _context: VoltServerContext = {}): VoltTriage {
  const text = raw.toLocaleLowerCase("fr");
  const base = { provider: "deterministic" as const, externalCall: false as const };

  if (/(ne sort|sort pas|éject|eject|distribu|batterie.*bloqu)/.test(text)) {
    return { ...base, category: "ejection", priority: "high", escalate: true, reply: "Je vois un problème de distribution. Je vais préparer un dossier prioritaire afin que le support puisse vérifier le paiement, la borne et l’éjection sans vous demander de tout répéter." };
  }
  if (/(retour|rendu|rendue|restitution|toujours.*location|location.*continue)/.test(text)) {
    return { ...base, category: "return", priority: "high", escalate: true, reply: "Le retour semble ne pas avoir été reconnu correctement. Je vais transmettre au support le contexte que le serveur peut vérifier pour votre location." };
  }
  if (/(paiement|payé|paye|carte|débit|debit|factur|rembours|rembourse|garantie|caution)/.test(text)) {
    return { ...base, category: "payment", priority: "normal", escalate: true, reply: "Je peux faire remonter ce dossier avec les références que le serveur peut vérifier. Ne transmettez jamais votre numéro de carte complet : le support n’en a pas besoin." };
  }
  if (/(cass|endommag|écran|ecran|borne.*hors|borne.*marche|slot)/.test(text)) {
    return { ...base, category: "station", priority: "high", escalate: true, reply: "Merci pour le signalement. Je vais créer un dossier borne afin que l’équipe puisse vérifier le matériel concerné." };
  }
  if (/(humain|personne|contacter|contact|support|parler à|parler a)/.test(text)) {
    return { ...base, category: "contact", priority: "normal", escalate: true, reply: "Oui. Je peux transmettre votre demande directement dans la file support Chargeurs.ch et vous donner une référence de suivi." };
  }
  if (/(prix|tarif|combien|coût|cout)/.test(text)) {
    return { ...base, category: "pricing", priority: "normal", escalate: false, reply: "Les montants affichés dans le parcours de location au moment de votre commande font foi. Si votre question concerne une location précise ou un montant inattendu, décrivez-le et je pourrai ouvrir un dossier support." };
  }
  if (/(compte|pass|profil|connexion|connecter|crédit|credit|points)/.test(text)) {
    return { ...base, category: "account", priority: "normal", escalate: false, reply: "Je peux vous aider sur votre compte Chargeurs.ch. Pour un client connecté, le serveur utilise uniquement l’identité de la session et ne fait jamais confiance à un identifiant utilisateur fourni dans le message." };
  }
  return { ...base, category: "general", priority: "normal", escalate: false, reply: "Je peux vous aider sur une location, un retour, un paiement, une borne ou votre compte Chargeurs.ch. Décrivez ce qui s’est passé et, si une intervention humaine est nécessaire, je créerai un dossier structuré." };
}

export function buildVoltSupportMessage(args: {
  mode: VoltMode;
  text: string;
  triage: VoltTriage;
  context?: VoltServerContext;
}): string {
  const context = args.context ?? {};
  return [
    "[Volt — dossier support]",
    `Source : ${args.mode}`,
    `Catégorie : ${args.triage.category}`,
    `Priorité : ${args.triage.priority}`,
    context.rentalId ? `Location : ${context.rentalId}` : "",
    context.stationId ? `Borne : ${context.stationId}` : "",
    context.rentalState ? `État location : ${context.rentalState}` : "",
    "",
    args.text.trim(),
  ].filter(Boolean).join("\n").slice(0, 4000);
}
