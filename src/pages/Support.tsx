import { Bot, LifeBuoy, MessageCircle, ShieldCheck, Zap } from "lucide-react";
import { Link } from "react-router-dom";
import { PublicNav } from "@/components/public/PublicNav";
import { LiquidBackground } from "@/components/LiquidBackground";
import { Button } from "@/components/ui/button";

const FEATURES = [
  { icon: Zap, title: "Diagnostic immédiat", text: "Volt reconnaît les problèmes fréquents de location, de retour, de paiement ou de borne et prépare le bon contexte." },
  { icon: LifeBuoy, title: "Escalade structurée", text: "Lorsqu'une intervention humaine est nécessaire, la conversation devient un dossier support avec une référence de suivi." },
  { icon: ShieldCheck, title: "Contexte limité", text: "Aucun numéro de carte complet n'est demandé. Volt reste strictement limité au périmètre Chargeurs.ch." },
];

export default function Support() {
  const openVolt = () => window.dispatchEvent(new Event("volt:open"));

  return (
    <div className="relative min-h-screen">
      <LiquidBackground />
      <PublicNav />
      <main className="mx-auto max-w-6xl px-6 pb-28 pt-32 sm:px-10">
        <section className="glass-strong liquid-border overflow-hidden rounded-3xl p-8 sm:p-12">
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-2 text-sm font-semibold text-primary"><Bot className="h-4 w-4" />Volt · Assistant Chargeurs.ch</span>
            <span className="rounded-full border border-success/30 bg-success/10 px-3 py-1.5 text-xs font-semibold text-success">Disponible sur tout le site</span>
          </div>
          <h1 className="mt-6 max-w-4xl font-display text-4xl font-extrabold sm:text-6xl">Besoin d'aide ? Appelez Volt.</h1>
          <p className="mt-5 max-w-3xl text-lg leading-8 text-muted-foreground">Volt vous accompagne sans vous faire quitter la page que vous consultez. Touchez la petite batterie en bas à droite, posez votre question et, si une intervention humaine est nécessaire, Volt prépare le dossier support.</p>
          <Button type="button" onClick={openVolt} className="mt-7 rounded-full bg-gradient-primary px-7 py-6 font-bold shadow-glow">
            <MessageCircle className="mr-2 h-5 w-5" />Ouvrir Volt
          </Button>
        </section>

        <section className="mt-8 grid gap-4 md:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, text }) => (
            <article key={title} className="glass liquid-border rounded-2xl p-6">
              <Icon className="h-7 w-7 text-primary" />
              <h2 className="mt-4 text-lg font-bold">{title}</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{text}</p>
            </article>
          ))}
        </section>

        <section className="mt-10 rounded-3xl border border-border bg-card/60 p-6 sm:p-8">
          <h2 className="font-display text-xl font-bold">Correspondance formelle</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">Volt est le canal d'assistance principal. Pour une correspondance juridique ou administrative formelle, l'adresse de contact reste <a className="font-semibold text-primary hover:underline" href="mailto:support@chargeurs.ch">support@chargeurs.ch</a>.</p>
          <Link to="/" className="mt-5 inline-flex text-sm font-semibold text-primary">Retour à l'accueil</Link>
        </section>
      </main>
    </div>
  );
}
