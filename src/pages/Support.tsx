import { AlertTriangle, Camera, Mail, MessageCircle, Phone, ReceiptText } from "lucide-react";
import { Link } from "react-router-dom";
import { PublicNav } from "@/components/public/PublicNav";
import { LiquidBackground } from "@/components/LiquidBackground";
import { Button } from "@/components/ui/button";
import { PublicContactForm } from "@/components/public/PublicContactForm";

const SUPPORT_CASES = [
  { icon: AlertTriangle, title: "La batterie ne sort pas", text: "Préparez l'identifiant de la borne et l'heure du paiement. Nous vérifions la commande et l'état du slot." },
  { icon: ReceiptText, title: "Question de paiement", text: "Indiquez votre numéro de location ou l'adresse email utilisée pendant le paiement." },
  { icon: Camera, title: "Borne ou batterie endommagée", text: "Une photo permet d'identifier rapidement le slot, la batterie ou le message affiché." },
];

export default function Support() {
  return (
    <div className="relative min-h-screen">
      <LiquidBackground />
      <PublicNav />
      <main className="mx-auto max-w-5xl px-6 pb-20 pt-32 sm:px-10">
        <section className="glass-strong liquid-border rounded-3xl p-8 sm:p-12">
          <span className="rounded-full border border-primary/30 bg-primary/10 px-4 py-2 text-sm font-semibold text-primary">Assistance Chargeurs.ch</span>
          <h1 className="mt-6 font-display text-4xl font-extrabold sm:text-6xl">Un problème avec une location ou une borne ?</h1>
          <p className="mt-5 max-w-3xl text-lg text-muted-foreground">Contactez le support avec l'identifiant de la borne, votre numéro de location et une courte description. Ces informations accélèrent fortement le diagnostic.</p>
          <div className="mt-8 grid gap-3 sm:grid-cols-3">
            <Button asChild className="h-auto rounded-2xl bg-gradient-primary px-5 py-5 font-bold shadow-glow"><a href="mailto:support@chargeurs.ch?subject=Assistance Chargeurs.ch"><Mail className="mr-2 h-5 w-5" />Email</a></Button>
            <Button asChild variant="ghost" className="h-auto rounded-2xl border border-border px-5 py-5"><a href="tel:+41786336777"><Phone className="mr-2 h-5 w-5" />Appeler</a></Button>
            <Button asChild variant="ghost" className="h-auto rounded-2xl border border-border px-5 py-5"><a href="https://wa.me/41786336777" rel="noreferrer"><MessageCircle className="mr-2 h-5 w-5" />WhatsApp</a></Button>
          </div>
        </section>

        <section className="mt-10 grid gap-4 md:grid-cols-3">
          {SUPPORT_CASES.map(({ icon: Icon, title, text }) => (
            <article key={title} className="glass liquid-border rounded-2xl p-6">
              <Icon className="h-7 w-7 text-primary" />
              <h2 className="mt-4 text-lg font-bold">{title}</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{text}</p>
            </article>
          ))}
        </section>

        <div className="mt-10">
          <PublicContactForm
            requestType="support"
            title="Ouvrir une demande de support"
            description="La demande est enregistrée dans le back-office et traitée par l'équipe support. Ne saisissez jamais de numéro de carte complet."
          />
        </div>

        <section className="mt-10 rounded-3xl border border-border bg-card/70 p-8">
          <h2 className="font-display text-2xl font-bold">Informations utiles à transmettre</h2>
          <p className="mt-3 text-muted-foreground">Identifiant de borne, numéro de location, date et heure, moyen de paiement, numéro du slot affiché et photo du problème lorsque c'est possible. Ne transmettez jamais les données complètes de votre carte bancaire.</p>
          <Link to="/" className="mt-6 inline-flex text-sm font-semibold text-primary">Retour à l'accueil</Link>
        </section>
      </main>
    </div>
  );
}
