import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { stationConnectionLabel, stationConnectionState } from "@/lib/stationConnection";
import { supabase } from "@/integrations/supabase/client";
import { LiquidBackground } from "@/components/LiquidBackground";
import { PublicNav } from "@/components/public/PublicNav";
import { Button } from "@/components/ui/button";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import {
  ArrowRight, MonitorSmartphone, ShieldCheck, Zap, ScanLine, BatteryCharging,
  Undo2, CreditCard, Smartphone, Apple, MapPin, Mail, HelpCircle, Clock3, Building2,
} from "lucide-react";
import { formatChf, PUBLIC_PRICING } from "@/lib/publicPricing";
import { publicStationPath } from "./public/publicStationData";

const STEPS = [
  { icon: MapPin, title: "Trouvez une borne", text: "Repérez une borne Chargeurs.ch dans un bar, restaurant, hôtel ou lieu partenaire." },
  { icon: ScanLine, title: "Scannez et payez", text: "Scannez le QR code affiché sur la borne et confirmez le paiement sécurisé sur votre natel." },
  { icon: BatteryCharging, title: "Rechargez", text: "Une batterie se libère automatiquement. Emportez-la pour recharger votre smartphone." },
  { icon: Undo2, title: "Rendez-la", text: "Déposez la batterie dans une borne compatible du réseau lorsque vous avez terminé." },
];

const PAYMENTS = [
  { icon: Smartphone, label: "TWINT" },
  { icon: CreditCard, label: "Carte bancaire" },
  { icon: Apple, label: "Apple Pay" },
  { icon: Zap, label: "Google Pay" },
];

const FAQ = [
  { q: "Combien coûte une location ?", a: `La location coûte ${formatChf(PUBLIC_PRICING.hourlyRate)} par heure, facturée par tranches de ${PUBLIC_PRICING.incrementMinutes} minutes à ${formatChf(PUBLIC_PRICING.incrementPrice)}, avec un plafond de ${formatChf(PUBLIC_PRICING.dailyCap)} par jour.` },
  { q: "À quoi sert la caution de 30 CHF ?", a: "La caution sécurise la mise à disposition de la batterie. À la restitution, le montant final de la location est calculé et le solde non utilisé est libéré ou remboursé selon le parcours de paiement." },
  { q: "Où puis-je rendre la batterie ?", a: "Dans une borne compatible du réseau Chargeurs.ch disposant d'un emplacement libre. Le retour est détecté automatiquement par le système." },
  { q: "Que se passe-t-il si je ne rends pas la batterie ?", a: `En cas de non-retour selon les conditions applicables, le montant total peut atteindre ${formatChf(PUBLIC_PRICING.nonReturnTotal)}. La caution initiale de ${formatChf(PUBLIC_PRICING.deposit)} est alors complétée par un solde de ${formatChf(PUBLIC_PRICING.nonReturnBalanceAfterDeposit)}.` },
  { q: "La batterie est-elle compatible avec mon téléphone ?", a: "Les modèles proposés sont conçus pour les smartphones courants, notamment USB-C et Lightning. La compatibilité exacte est indiquée sur la borne et la fiche du lieu." },
];

function Section({ id, children, className = "" }: { id: string; children: React.ReactNode; className?: string }) {
  return <section id={id} className={`mx-auto w-full max-w-6xl scroll-mt-24 px-6 py-16 sm:px-10 ${className}`}>{children}</section>;
}

export default function Index() {
  const [stations, setStations] = useState<any[]>([]);
  const [loadingStations, setLoadingStations] = useState(true);
  const [stationsError, setStationsError] = useState(false);
  const [searchParams] = useSearchParams();
  const requestedSection = searchParams.get("section");

  useEffect(() => {
    supabase
      .from("stations")
      .select("station_id, name, location_name, online, status")
      .order("station_id")
      .then(({ data, error }) => {
        setStations(data ?? []);
        setStationsError(Boolean(error));
        setLoadingStations(false);
      });
  }, []);

  useEffect(() => {
    if (!requestedSection) return;
    const animationFrame = window.requestAnimationFrame(() => {
      document.getElementById(requestedSection)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => window.cancelAnimationFrame(animationFrame);
  }, [requestedSection]);

  const visibleStations = useMemo(() => stations, [stations]);

  return (
    <div className="relative min-h-screen">
      <LiquidBackground />
      <PublicNav />

      <main className="pt-20">
        <Section id="accueil" className="text-center">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
            <span className="glass inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm text-secondary"><Zap className="h-4 w-4" />Location de powerbanks · Vaud et Suisse romande</span>
            <h1 className="mx-auto mt-6 max-w-5xl font-display text-5xl font-extrabold leading-tight sm:text-7xl">Votre natel n'a plus de batterie ?<br /><span className="text-gradient">Trouvez une powerbank près de vous.</span></h1>
            <p className="mx-auto mt-6 max-w-3xl text-xl text-muted-foreground">Chargeurs.ch déploie des bornes self-service dans les bars, restaurants, hôtels, clubs et événements. Scannez, payez, rechargez et rendez la batterie dans une borne compatible.</p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Button asChild className="h-auto rounded-full bg-gradient-primary px-8 py-5 text-lg font-bold shadow-glow"><Link to="/?section=bornes">Trouver une borne <ArrowRight className="ml-2 h-5 w-5" /></Link></Button>
              <Button asChild variant="ghost" className="h-auto rounded-full border border-border px-8 py-5 text-lg"><Link to="/partenaires"><Building2 className="mr-2 h-5 w-5" />Devenir partenaire</Link></Button>
            </div>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-4 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-success" />Paiements sécurisés par Stripe</span>
              <span className="inline-flex items-center gap-2"><Clock3 className="h-4 w-4 text-primary" />Tarif transparent dès {formatChf(PUBLIC_PRICING.incrementPrice)} / 30 min</span>
            </div>
          </motion.div>
        </Section>

        <Section id="bornes">
          <h2 className="font-display text-3xl font-bold sm:text-4xl">Bornes Chargeurs.ch</h2>
          <p className="mt-2 max-w-3xl text-muted-foreground">Les bornes publiées et connectées apparaissent automatiquement à partir des données de la plateforme.</p>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {visibleStations.map((station) => {
              const connection = stationConnectionState(station);
              return <Link key={station.station_id} to={publicStationPath(station.station_id)} className="glass liquid-border group rounded-2xl p-6 text-left transition-transform hover:scale-[1.03]">
                <div className="flex items-start justify-between gap-3">
                  <MonitorSmartphone className="h-7 w-7 text-primary" />
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ${connection === "online" ? "bg-success/15 text-success" : connection === "unknown" ? "bg-warning/15 text-warning" : "bg-muted text-muted-foreground"}`}>{connection === "online" ? "Disponible" : stationConnectionLabel(station)}</span>
                </div>
                <div className="mt-4 font-mono text-xs text-muted-foreground">{station.station_id}</div>
                <div className="text-lg font-bold">{station.name}</div>
                {station.location_name && <div className="text-sm text-muted-foreground">{station.location_name}</div>}
                <div className="mt-4 inline-flex items-center gap-1 text-sm text-primary">Voir la borne <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" /></div>
              </Link>
            })}
          </div>
          {loadingStations && <p className="mt-4 text-sm text-muted-foreground">Synchronisation de l'état des bornes…</p>}
          {!loadingStations && stationsError && <p className="mt-4 rounded-2xl border border-warning/30 bg-warning/10 p-4 text-sm text-warning">La disponibilité des bornes est momentanément indisponible. Aucune donnée de démonstration n’est affichée.</p>}
          {!loadingStations && !stationsError && visibleStations.length === 0 && <p className="mt-4 rounded-2xl border border-border bg-card/70 p-4 text-sm text-muted-foreground">Aucune borne publique n’est actuellement publiée. Revenez prochainement ou contactez le support.</p>}
        </Section>

        <Section id="comment">
          <h2 className="font-display text-3xl font-bold sm:text-4xl">Comment louer une batterie externe</h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((step, index) => (
              <div key={step.title} className="glass liquid-border rounded-2xl p-6">
                <div className="mb-3 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-primary text-primary-foreground"><step.icon className="h-6 w-6" /></div>
                <div className="text-xs font-mono text-muted-foreground">Étape {index + 1}</div>
                <div className="mt-1 text-lg font-bold">{step.title}</div>
                <p className="mt-1 text-sm text-muted-foreground">{step.text}</p>
              </div>
            ))}
          </div>
        </Section>

        <Section id="tarifs">
          <h2 className="font-display text-3xl font-bold sm:text-4xl">Tarification simple et transparente</h2>
          <p className="mt-2 max-w-3xl text-muted-foreground">Le client voit les conditions avant de confirmer. Les règles centrales pourront ensuite être attribuées à une borne ou un partenaire depuis le back-office.</p>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <article className="glass liquid-border rounded-2xl p-6"><p className="text-sm text-muted-foreground">Caution initiale</p><p className="mt-2 text-3xl font-extrabold text-gradient">{formatChf(PUBLIC_PRICING.deposit)}</p><p className="mt-2 text-sm text-muted-foreground">Autorisation sécurisée au démarrage.</p></article>
            <article className="glass liquid-border rounded-2xl p-6"><p className="text-sm text-muted-foreground">Location</p><p className="mt-2 text-3xl font-extrabold text-gradient">{formatChf(PUBLIC_PRICING.hourlyRate)} / h</p><p className="mt-2 text-sm text-muted-foreground">Facturée par tranches de {PUBLIC_PRICING.incrementMinutes} minutes.</p></article>
            <article className="glass liquid-border rounded-2xl p-6"><p className="text-sm text-muted-foreground">Plafond journalier</p><p className="mt-2 text-3xl font-extrabold text-gradient">{formatChf(PUBLIC_PRICING.dailyCap)}</p><p className="mt-2 text-sm text-muted-foreground">Maximum de location par période journalière.</p></article>
            <article className="glass liquid-border rounded-2xl p-6"><p className="text-sm text-muted-foreground">Non-retour</p><p className="mt-2 text-3xl font-extrabold text-gradient">{formatChf(PUBLIC_PRICING.nonReturnTotal)}</p><p className="mt-2 text-sm text-muted-foreground">Montant total prévu lorsqu'une batterie n'est pas restituée.</p></article>
          </div>
        </Section>

        <Section id="paiement">
          <h2 className="font-display text-3xl font-bold sm:text-4xl">Moyens de paiement</h2>
          <p className="mt-2 max-w-2xl text-muted-foreground">Le QR code ouvre le paiement mobile. Les méthodes réellement affichées dépendent de la configuration Stripe active.</p>
          <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
            {PAYMENTS.map((payment) => <div key={payment.label} className="glass flex flex-col items-center gap-3 rounded-2xl p-6 text-center"><payment.icon className="h-8 w-8 text-primary" /><span className="font-semibold">{payment.label}</span></div>)}
          </div>
        </Section>

        <Section id="faq">
          <h2 className="font-display text-3xl font-bold sm:text-4xl">Questions fréquentes sur la location de powerbanks</h2>
          <Accordion type="single" collapsible className="mt-6 glass liquid-border rounded-2xl px-6">
            {FAQ.map((item, index) => <AccordionItem key={item.q} value={`faq-${index}`} className="border-border"><AccordionTrigger className="text-left text-base font-semibold">{item.q}</AccordionTrigger><AccordionContent className="text-muted-foreground">{item.a}</AccordionContent></AccordionItem>)}
          </Accordion>
        </Section>

        <Section id="contact">
          <div className="glass-strong liquid-border flex flex-col items-start gap-4 rounded-3xl p-8 sm:flex-row sm:items-center sm:justify-between">
            <div><h2 className="font-display text-3xl font-bold">Besoin d'aide ?</h2><p className="mt-2 text-muted-foreground">Un souci avec une borne, une batterie ou un paiement ? Le support centralise votre demande.</p></div>
            <div className="flex flex-wrap gap-3">
              <Button asChild className="h-auto rounded-full bg-gradient-primary px-6 py-4 font-bold"><Link to="/support"><HelpCircle className="mr-2 h-4 w-4" />Ouvrir le support</Link></Button>
              <Button asChild variant="ghost" className="h-auto rounded-full border border-border px-6 py-4"><a href="mailto:support@chargeurs.ch"><Mail className="mr-2 h-4 w-4" />support@chargeurs.ch</a></Button>
            </div>
          </div>
        </Section>
      </main>

      <footer className="mx-auto w-full max-w-6xl px-6 py-10 sm:px-10">
        <div className="flex flex-col items-center justify-between gap-4 border-t border-border pt-6 text-sm text-muted-foreground sm:flex-row">
          <span>© {new Date().getFullYear()} Chargeurs.ch · Location de powerbanks en Suisse romande</span>
          <div className="flex flex-wrap justify-center gap-4"><Link to="/partenaires">Partenaires</Link><Link to="/support">Support</Link><Link to="/legal/conditions">Conditions</Link><Link to="/legal/confidentialite">Confidentialité</Link><Link to="/legal/mentions-legales">Mentions légales</Link><Link to="/admin" className="text-muted-foreground/70">Administration</Link></div>
        </div>
      </footer>
    </div>
  );
}
