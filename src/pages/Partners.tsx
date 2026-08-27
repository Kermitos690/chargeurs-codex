import { Building2, ChartNoAxesCombined, Headphones, MapPin, ShieldCheck, Zap } from "lucide-react";
import { Link } from "react-router-dom";
import { PublicNav } from "@/components/public/PublicNav";
import { LiquidBackground } from "@/components/LiquidBackground";
import { Button } from "@/components/ui/button";
import { PublicContactForm } from "@/components/public/PublicContactForm";

const BENEFITS = [
  { icon: Zap, title: "Un service utile immédiatement", text: "Vos clients restent joignables, prolongent leur visite et n'ont plus besoin de chercher une prise." },
  { icon: ChartNoAxesCombined, title: "Des statistiques claires", text: "Suivez les locations, la disponibilité, les incidents et l'activité de votre établissement." },
  { icon: MapPin, title: "Une page locale dédiée", text: "Chaque partenaire bénéficie d'une page publique optimisée pour son établissement, sa ville et son quartier." },
  { icon: Headphones, title: "Support centralisé", text: "Chargeurs.ch gère les demandes clients, le suivi technique et les tickets depuis un même espace." },
  { icon: ShieldCheck, title: "Paiements sécurisés", text: "Les paiements et cautions sont gérés par Stripe, sans terminal bancaire physique sur la borne." },
  { icon: Building2, title: "Pilotage multi-sites", text: "Un partenaire peut gérer un ou plusieurs établissements avec des droits strictement séparés." },
];

export default function Partners() {
  return (
    <div className="relative min-h-screen">
      <LiquidBackground />
      <PublicNav />
      <main className="mx-auto max-w-6xl px-6 pb-20 pt-32 sm:px-10">
        <section className="glass-strong liquid-border rounded-3xl p-8 sm:p-12">
          <div className="max-w-3xl">
            <span className="rounded-full border border-primary/30 bg-primary/10 px-4 py-2 text-sm font-semibold text-primary">Partenaires Chargeurs.ch</span>
            <h1 className="mt-6 font-display text-4xl font-extrabold sm:text-6xl">Installez une borne de location de powerbanks dans votre établissement.</h1>
            <p className="mt-5 text-lg text-muted-foreground">Bars, restaurants, hôtels, clubs, salles de sport, festivals et lieux culturels peuvent proposer un service de recharge mobile simple, visible et pilotable à distance.</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild className="rounded-full bg-gradient-primary px-7 py-6 font-bold shadow-glow"><a href="mailto:partenaires@chargeurs.ch?subject=Devenir partenaire Chargeurs.ch">Demander une installation</a></Button>
              <Button asChild variant="ghost" className="rounded-full border border-border px-7 py-6"><Link to="/support">Voir le service client</Link></Button>
            </div>
          </div>
        </section>

        <section className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {BENEFITS.map(({ icon: Icon, title, text }) => (
            <article key={title} className="glass liquid-border rounded-2xl p-6">
              <Icon className="h-7 w-7 text-primary" />
              <h2 className="mt-4 text-xl font-bold">{title}</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{text}</p>
            </article>
          ))}
        </section>

        <section className="mt-12 rounded-3xl border border-border bg-card/70 p-8">
          <h2 className="font-display text-3xl font-bold">Déploiement prioritaire</h2>
          <p className="mt-3 max-w-3xl text-muted-foreground">La première zone commerciale visée est le canton de Vaud, avec une priorité autour d'Épalinges, Lausanne, Renens, Prilly, Pully, Morges, Nyon, Vevey, Montreux et Yverdon-les-Bains. L'architecture est prévue pour toute la Suisse romande.</p>
        </section>

        <div className="mt-12">
          <PublicContactForm
            requestType="partner_installation"
            title="Demander une installation"
            description="Décrivez votre établissement, la ville et le volume de visiteurs. La demande rejoint directement la file de suivi Chargeurs.ch."
          />
        </div>
      </main>
    </div>
  );
}
