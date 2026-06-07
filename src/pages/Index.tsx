import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { LiquidBackground } from "@/components/LiquidBackground";
import { PublicNav } from "@/components/public/PublicNav";
import { Button } from "@/components/ui/button";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import {
  ArrowRight, MonitorSmartphone, ShieldCheck, Zap, ScanLine, BatteryCharging,
  Undo2, CreditCard, Smartphone, Apple, MapPin, Mail, HelpCircle,
} from "lucide-react";

const STEPS = [
  { icon: MapPin, title: "Trouvez une borne", text: "Repérez une borne Chargeurs.ch dans un bar, restaurant ou hôtel partenaire." },
  { icon: ScanLine, title: "Scannez & payez", text: "Scannez le QR code de la borne et payez en quelques secondes (TWINT, carte, wallet)." },
  { icon: BatteryCharging, title: "Rechargez", text: "Une batterie se libère automatiquement. Emportez-la et rechargez votre téléphone." },
  { icon: Undo2, title: "Rendez-la", text: "Déposez la batterie dans n'importe quelle borne du réseau lorsque vous avez terminé." },
];

const PAYMENTS = [
  { icon: Smartphone, label: "TWINT" },
  { icon: CreditCard, label: "Carte bancaire" },
  { icon: Apple, label: "Apple Pay" },
  { icon: Zap, label: "Google Pay" },
];

const FAQ = [
  { q: "Combien coûte une location ?", a: "Le tarif est affiché clairement sur la borne avant tout paiement. Vous ne payez que ce que vous consommez selon la grille en vigueur." },
  { q: "Où puis-je rendre la batterie ?", a: "Dans n'importe quelle borne du réseau Chargeurs.ch. Le retour est détecté automatiquement." },
  { q: "Quels moyens de paiement sont acceptés ?", a: "TWINT, carte bancaire, Apple Pay et Google Pay. Les paiements sont sécurisés par Stripe." },
  { q: "La batterie est-elle compatible avec mon téléphone ?", a: "Oui, les batteries embarquent des câbles pour la majorité des smartphones (USB-C, Lightning, micro-USB)." },
];

function Section({ id, children, className = "" }: { id: string; children: React.ReactNode; className?: string }) {
  return (
    <section id={id} className={`mx-auto w-full max-w-6xl scroll-mt-24 px-6 py-16 sm:px-10 ${className}`}>
      {children}
    </section>
  );
}

export default function Index() {
  const [stations, setStations] = useState<any[]>([]);
  useEffect(() => {
    supabase.from("stations").select("station_id, name, location_name, online").order("station_id").then(({ data }) => setStations(data ?? []));
  }, []);

  return (
    <div className="relative min-h-screen">
      <LiquidBackground />
      <PublicNav />

      <main className="pt-20">
        {/* Accueil / hero */}
        <Section id="accueil" className="text-center">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
            <span className="glass inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm text-secondary">
              <Zap className="h-4 w-4" />Location de batteries · Suisse
            </span>
            <h1 className="mx-auto mt-6 max-w-4xl font-display text-5xl font-extrabold leading-tight sm:text-7xl">
              Rechargez votre téléphone.<br /><span className="text-gradient">Continuez votre soirée.</span>
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-xl text-muted-foreground">
              Bornes self-service dans les bars, restaurants et hôtels. Paiement TWINT, Apple Pay, Google Pay et carte.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Button asChild className="h-auto rounded-full bg-gradient-primary px-8 py-5 text-lg font-bold shadow-glow">
                <a href="#bornes">Voir les bornes <ArrowRight className="ml-2 h-5 w-5" /></a>
              </Button>
              <Button asChild variant="ghost" className="h-auto rounded-full border border-border px-8 py-5 text-lg">
                <a href="#comment">Comment ça marche</a>
              </Button>
            </div>
            <div className="mt-8 flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <ShieldCheck className="h-4 w-4 text-success" />Paiements sécurisés par Stripe · API ChargeNow temps réel
            </div>
          </motion.div>
        </Section>

        {/* Bornes / carte */}
        <Section id="bornes">
          <h2 className="font-display text-3xl font-bold sm:text-4xl">Bornes / Carte</h2>
          <p className="mt-2 max-w-2xl text-muted-foreground">Choisissez une borne pour ouvrir l'écran de location.</p>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {stations.length === 0 && (
              <div className="glass rounded-2xl p-6 text-muted-foreground">Aucune borne disponible pour le moment.</div>
            )}
            {stations.map((s) => (
              <Link key={s.station_id} to={`/kiosk/${s.station_id}`}
                className="glass liquid-border group rounded-2xl p-6 text-left transition-transform hover:scale-[1.03]">
                <MonitorSmartphone className="mb-3 h-7 w-7 text-primary" />
                <div className="font-mono text-xs text-muted-foreground">{s.station_id}</div>
                <div className="text-lg font-bold">{s.name}</div>
                {s.location_name && <div className="text-sm text-muted-foreground">{s.location_name}</div>}
                <div className={`mt-1 text-sm ${s.online ? "text-success" : "text-muted-foreground"}`}>
                  {s.online ? "En ligne" : "Hors ligne"}
                </div>
                <div className="mt-4 inline-flex items-center gap-1 text-sm text-primary">
                  Ouvrir le kiosque <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                </div>
              </Link>
            ))}
          </div>
        </Section>

        {/* Comment ça marche */}
        <Section id="comment">
          <h2 className="font-display text-3xl font-bold sm:text-4xl">Comment ça marche</h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((step, i) => (
              <div key={step.title} className="glass liquid-border rounded-2xl p-6">
                <div className="mb-3 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-primary text-primary-foreground">
                  <step.icon className="h-6 w-6" />
                </div>
                <div className="text-xs font-mono text-muted-foreground">Étape {i + 1}</div>
                <div className="mt-1 text-lg font-bold">{step.title}</div>
                <p className="mt-1 text-sm text-muted-foreground">{step.text}</p>
              </div>
            ))}
          </div>
        </Section>

        {/* Tarifs */}
        <Section id="tarifs">
          <h2 className="font-display text-3xl font-bold sm:text-4xl">Tarifs</h2>
          <div className="mt-8 glass liquid-border rounded-3xl p-8">
            <p className="text-xl">
              Tarification simple et transparente, <span className="text-gradient font-bold">affichée sur chaque borne</span> avant tout paiement.
            </p>
            <p className="mt-3 text-muted-foreground">
              Le prix exact dépend de la borne et de la durée. Aucun frais caché : le montant est confirmé avant que vous ne payiez, et la caution éventuelle est gérée de façon sécurisée par Stripe.
            </p>
          </div>
        </Section>

        {/* Paiements */}
        <Section id="paiement">
          <h2 className="font-display text-3xl font-bold sm:text-4xl">Moyens de paiement</h2>
          <p className="mt-2 max-w-2xl text-muted-foreground">Payez en quelques secondes avec votre méthode préférée.</p>
          <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
            {PAYMENTS.map((p) => (
              <div key={p.label} className="glass flex flex-col items-center gap-3 rounded-2xl p-6 text-center">
                <p.icon className="h-8 w-8 text-primary" />
                <span className="font-semibold">{p.label}</span>
              </div>
            ))}
          </div>
          <div className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
            <ShieldCheck className="h-4 w-4 text-success" />Tous les paiements sont chiffrés et sécurisés par Stripe.
          </div>
        </Section>

        {/* FAQ */}
        <Section id="faq">
          <h2 className="font-display text-3xl font-bold sm:text-4xl">FAQ</h2>
          <Accordion type="single" collapsible className="mt-6 glass liquid-border rounded-2xl px-6">
            {FAQ.map((item, i) => (
              <AccordionItem key={i} value={`faq-${i}`} className="border-border">
                <AccordionTrigger className="text-left text-base font-semibold">{item.q}</AccordionTrigger>
                <AccordionContent className="text-muted-foreground">{item.a}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </Section>

        {/* Aide / Contact */}
        <Section id="contact">
          <div className="glass-strong liquid-border flex flex-col items-start gap-4 rounded-3xl p-8 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-display text-3xl font-bold">Aide / Contact</h2>
              <p className="mt-2 text-muted-foreground">Une question ou un souci avec une borne ? Notre équipe vous répond.</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button asChild className="h-auto rounded-full bg-gradient-primary px-6 py-4 font-bold">
                <a href="mailto:support@chargeurs.ch"><Mail className="mr-2 h-4 w-4" />support@chargeurs.ch</a>
              </Button>
              <Button asChild variant="ghost" className="h-auto rounded-full border border-border px-6 py-4">
                <a href="#faq"><HelpCircle className="mr-2 h-4 w-4" />Consulter la FAQ</a>
              </Button>
            </div>
          </div>
        </Section>
      </main>

      {/* Footer — discreet administrative access only here */}
      <footer className="mx-auto w-full max-w-6xl px-6 py-10 sm:px-10">
        <div className="flex flex-col items-center justify-between gap-4 border-t border-border pt-6 text-sm text-muted-foreground sm:flex-row">
          <span>© {new Date().getFullYear()} Chargeurs.ch · Location de batteries en Suisse</span>
          <Link to="/admin" className="text-muted-foreground/70 transition-colors hover:text-foreground">
            Accès administrateur
          </Link>
        </div>
      </footer>
    </div>
  );
}
