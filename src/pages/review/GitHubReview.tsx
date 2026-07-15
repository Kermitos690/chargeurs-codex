import { useMemo, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import {
  Activity,
  BatteryCharging,
  Building2,
  CheckCircle2,
  CircleDollarSign,
  CreditCard,
  Gauge,
  Globe2,
  KeyRound,
  LayoutDashboard,
  LockKeyhole,
  MonitorSmartphone,
  Server,
  ShieldCheck,
  Smartphone,
  UserRound,
  WalletCards,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";
import { LiquidBackground } from "@/components/LiquidBackground";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

type Section = "overview" | "site" | "client" | "admin" | "kiosk";
type Feature = { icon: LucideIcon; title: string; text: string };

const nav: Array<{ id: Section; label: string; icon: LucideIcon }> = [
  { id: "overview", label: "Vue générale", icon: LayoutDashboard },
  { id: "site", label: "Site public", icon: Globe2 },
  { id: "client", label: "Compte client", icon: UserRound },
  { id: "admin", label: "Administration", icon: ShieldCheck },
  { id: "kiosk", label: "Écran borne", icon: MonitorSmartphone },
];

const stations = [
  { id: "DTA21269", place: "Lausanne Centre", available: 5 },
  { id: "DTA21277", place: "Lausanne Gare", available: 4 },
  { id: "DTA22032", place: "Ouchy", available: 6 },
];

const improvements: Feature[] = [
  { icon: ShieldCheck, title: "Paiement canonique", text: "Carte en autorisation manuelle, TWINT prépayé puis remboursé." },
  { icon: BatteryCharging, title: "Retour exact", text: "Corrélation uniquement par tradeNo ou identifiant batterie." },
  { icon: LockKeyhole, title: "Éjection protégée", text: "Service-role ou administrateur, feature flags et compensation Stripe." },
  { icon: KeyRound, title: "Platform API", text: "Clés hashées, scopes, quotas atomiques et journaux expurgés." },
];

const adminModules = [
  "Vue d’ensemble", "Bornes", "Tablettes kiosque", "Locations / Commandes", "Paiements", "Tarification",
  "Partenaires", "Établissements", "Maintenance", "Santé parcours", "Santé API", "Couverture API",
  "Événements", "Utilisateurs & rôles", "Clés API", "Réglages",
];

function Shell({ children }: { children: ReactNode }) {
  return <div className="space-y-6">{children}</div>;
}

function Heading({ eyebrow, title, text }: { eyebrow: string; title: string; text: string }) {
  return <div><p className="text-xs font-bold uppercase tracking-[0.24em] text-primary">{eyebrow}</p><h1 className="mt-2 font-display text-3xl font-black sm:text-4xl">{title}</h1><p className="mt-3 max-w-3xl text-muted-foreground">{text}</p></div>;
}

function Metric({ icon: Icon, label, value, hint }: { icon: LucideIcon; label: string; value: string; hint: string }) {
  return <Card className="glass liquid-border"><CardContent className="flex gap-4 p-5"><div className="rounded-2xl bg-primary/15 p-3 text-primary"><Icon className="h-6 w-6" /></div><div><p className="text-sm text-muted-foreground">{label}</p><p className="text-2xl font-black">{value}</p><p className="text-xs text-muted-foreground">{hint}</p></div></CardContent></Card>;
}

function FeatureGrid({ items }: { items: Feature[] }) {
  return <div className="grid gap-4 md:grid-cols-2">{items.map(({ icon: Icon, title, text }) => <Card key={title} className="glass"><CardHeader><Icon className="mb-2 h-7 w-7 text-primary" /><CardTitle className="text-lg">{title}</CardTitle><CardDescription>{text}</CardDescription></CardHeader></Card>)}</div>;
}

function Overview() {
  return <Shell>
    <Heading eyebrow="Revue GitHub" title="Chargeurs.ch consolidé" text="Prévisualisation autonome du site, du compte client, du back-office et du kiosk, sans compte réel ni appel aux services externes." />
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Metric icon={Server} label="Bornes de test" value="3" hint="Les trois identifiants réels connus" />
      <Metric icon={BatteryCharging} label="Batteries disponibles" value="15" hint="Données de démonstration" />
      <Metric icon={CircleDollarSign} label="Caution" value="30 CHF" hint="Autorisation ou prépaiement" />
      <Metric icon={Gauge} label="Non-retour" value="99 CHF" hint="Complément soumis à consentement" />
    </div>
    <FeatureGrid items={improvements} />
  </Shell>;
}

function Site() {
  const steps: Feature[] = [
    { icon: Smartphone, title: "1. Scanner", text: "Le QR code ouvre le paiement sur le téléphone du client." },
    { icon: CreditCard, title: "2. Autoriser", text: "Carte, Apple Pay, Google Pay ou TWINT selon Stripe." },
    { icon: BatteryCharging, title: "3. Rendre", text: "La batterie peut être restituée dans une borne du réseau." },
  ];
  return <Shell>
    <Heading eyebrow="Visiteur" title="Site public" text="Présentation du service, règles tarifaires et disponibilité du réseau." />
    <Card className="border-primary/30 bg-gradient-to-br from-primary/20 via-background to-background"><CardContent className="grid gap-8 p-8 lg:grid-cols-[1.3fr_0.7fr]"><div><Badge>Lausanne</Badge><h2 className="mt-5 font-display text-4xl font-black sm:text-6xl">Une batterie nomade, quand ton téléphone en a besoin.</h2><p className="mt-4 text-lg text-muted-foreground">Scanne, paie de façon sécurisée, prends une batterie et rends-la dans le réseau.</p></div><div className="glass-strong rounded-3xl p-6"><p className="text-sm text-muted-foreground">Tarif</p><p className="text-4xl font-black">1,50 CHF<span className="text-base font-medium"> / heure</span></p><div className="mt-5 space-y-2 text-sm"><p>Blocs de 30 minutes</p><p>Plafond de 18 CHF par jour</p><p>Caution de 30 CHF</p><p>Non-retour : 99 CHF</p></div></div></CardContent></Card>
    <div className="grid gap-4 md:grid-cols-3">{steps.map(({ icon: Icon, title, text }) => <Card key={title} className="glass"><CardHeader><Icon className="mb-2 h-7 w-7 text-primary" /><CardTitle>{title}</CardTitle><CardDescription>{text}</CardDescription></CardHeader></Card>)}</div>
    <Card className="glass"><CardHeader><CardTitle>Réseau de démonstration</CardTitle></CardHeader><CardContent className="grid gap-3 md:grid-cols-3">{stations.map((station) => <div key={station.id} className="rounded-2xl border p-4"><div className="flex justify-between"><Badge variant="outline">{station.id}</Badge><CheckCircle2 className="h-5 w-5 text-success" /></div><p className="mt-4 font-bold">{station.place}</p><p className="mt-3 text-2xl font-black">{station.available} <span className="text-sm font-medium text-muted-foreground">disponibles</span></p></div>)}</CardContent></Card>
  </Shell>;
}

function Client() {
  return <Shell>
    <Heading eyebrow="Client connecté" title="Compte de démonstration" text="Données fictives pour visualiser l’expérience client sans créer de compte Supabase." />
    <div className="grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
      <Card className="glass-strong"><CardHeader><CardTitle>Gaëtan — compte test</CardTitle><CardDescription>Utilisateur de démonstration, aucune adresse réelle</CardDescription></CardHeader><CardContent className="space-y-3 text-sm"><div className="flex justify-between"><span>Statut</span><Badge>Vérifié</Badge></div><div className="flex justify-between"><span>Langue</span><strong>Français</strong></div><div className="flex justify-between"><span>Locations</span><strong>12</strong></div></CardContent></Card>
      <Card className="border-primary/30 bg-primary/5"><CardHeader><div className="flex justify-between"><div><CardTitle>Location en cours</CardTitle><CardDescription>CHG-7K2P9A · DTA21269</CardDescription></div><Badge className="bg-success text-success-foreground">Active</Badge></div></CardHeader><CardContent><div className="grid gap-4 sm:grid-cols-3"><div><p className="text-xs text-muted-foreground">Durée</p><p className="text-xl font-black">1 h 34</p></div><div><p className="text-xs text-muted-foreground">Estimation</p><p className="text-xl font-black">3,00 CHF</p></div><div><p className="text-xs text-muted-foreground">Caution</p><p className="text-xl font-black">30 CHF</p></div></div><Progress value={38} className="mt-6" /></CardContent></Card>
    </div>
    <div className="grid gap-4 md:grid-cols-2"><Card className="glass"><CardHeader><WalletCards className="h-7 w-7 text-primary" /><CardTitle>Carte et wallets</CardTitle><CardDescription>Capture uniquement du prix final après retour.</CardDescription></CardHeader></Card><Card className="glass"><CardHeader><Smartphone className="h-7 w-7 text-primary" /><CardTitle>TWINT</CardTitle><CardDescription>Prépaiement puis remboursement de la différence.</CardDescription></CardHeader></Card></div>
  </Shell>;
}

function Admin() {
  return <Shell>
    <Heading eyebrow="Super-administrateur" title="Back-office complet" text="Vue consolidée des opérations, paiements, API, incidents et configurations." />
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Metric icon={Server} label="Bornes en ligne" value="3 / 3" hint="Réseau démo" /><Metric icon={BatteryCharging} label="Locations actives" value="7" hint="Aucun cas ambigu" /><Metric icon={CreditCard} label="Autorisations" value="210 CHF" hint="Non capturées" /><Metric icon={Wrench} label="Incidents" value="2" hint="Paiement et matériel" /></div>
    <Card className="glass"><CardHeader><CardTitle>Modules du back-office</CardTitle><CardDescription>Toutes les sections prévues dans l’administration finale.</CardDescription></CardHeader><CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{adminModules.map((module) => <div key={module} className="rounded-2xl border p-4 font-semibold">{module}</div>)}</CardContent></Card>
    <div className="grid gap-4 lg:grid-cols-2"><Card className="glass"><CardHeader><KeyRound className="h-7 w-7 text-primary" /><CardTitle>Platform API</CardTitle><CardDescription>Clés hashées, scopes lecture, quotas et journaux expurgés.</CardDescription></CardHeader></Card><Card className="glass"><CardHeader><Activity className="h-7 w-7 text-primary" /><CardTitle>Cycle financier</CardTitle><CardDescription>Checkout → autorisation → éjection → retour exact → règlement.</CardDescription></CardHeader></Card></div>
  </Shell>;
}

function Kiosk() {
  return <Shell>
    <Heading eyebrow="Tablette appairée" title="Kiosk DTA21269" text="Simulation en lecture seule de l’écran tactile lié à la borne." />
    <div className="mx-auto max-w-4xl rounded-[2.5rem] border-[10px] border-foreground/15 bg-background p-5 shadow-2xl"><div className="glass-strong rounded-[1.8rem] p-8 text-center"><div className="flex justify-between"><BrandLogo size="sm" /><Badge className="bg-success text-success-foreground">En ligne</Badge></div><h2 className="mt-12 font-display text-4xl font-black sm:text-6xl">Batterie nomade, à emporter</h2><p className="mt-4 text-muted-foreground">5 batteries disponibles · 1,50 CHF/h · caution 30 CHF</p><Button className="mt-8 rounded-full px-10 py-6 text-lg" disabled>Mode revue — location désactivée</Button></div></div>
    <FeatureGrid items={[
      { icon: LockKeyhole, title: "Station-bound", text: "La tablette ne peut agir que sur sa borne." },
      { icon: ShieldCheck, title: "Serveur autoritaire", text: "La caution et le prix ne viennent jamais du navigateur." },
      { icon: Activity, title: "Idempotence", text: "Les doubles actions ne créent pas deux locations." },
      { icon: Wrench, title: "Compensation", text: "Échec définitif : annulation ou remboursement." },
    ]} />
  </Shell>;
}

export default function GitHubReview() {
  const params = useParams();
  const section = useMemo<Section>(() => {
    const candidate = params.section as Section | undefined;
    return candidate && nav.some((item) => item.id === candidate) ? candidate : "overview";
  }, [params.section]);

  const view = section === "site" ? <Site /> : section === "client" ? <Client /> : section === "admin" ? <Admin /> : section === "kiosk" ? <Kiosk /> : <Overview />;

  return <div className="relative min-h-screen"><LiquidBackground /><div className="relative z-10 mx-auto flex min-h-screen max-w-[1600px] flex-col lg:flex-row"><aside className="glass-strong border-b p-4 lg:sticky lg:top-0 lg:h-screen lg:w-72 lg:border-b-0 lg:border-r lg:p-6"><div className="flex items-center justify-between lg:block"><BrandLogo size="sm" /><Badge variant="outline" className="lg:mt-4">GitHub Preview</Badge></div><nav className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-5 lg:grid-cols-1">{nav.map(({ id, label, icon: Icon }) => <Button key={id} asChild variant="ghost" className={cn("h-auto justify-start rounded-xl px-3 py-3", section === id && "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground")}><Link to={id === "overview" ? "/review" : `/review/${id}`}><Icon className="mr-2 h-4 w-4" />{label}</Link></Button>)}</nav></aside><main className="min-w-0 flex-1 p-5 sm:p-8 lg:p-10"><div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-background/60 px-4 py-3 backdrop-blur-xl"><div className="flex items-center gap-2 text-sm"><Building2 className="h-4 w-4 text-primary" /><strong>Chargeurs.ch</strong><span className="text-muted-foreground">· GitHub uniquement</span></div><Badge variant="outline">Lecture seule</Badge></div>{view}<footer className="mt-12 border-t pt-5 text-center text-xs text-muted-foreground">Prévisualisation générée et déployée depuis GitHub uniquement.</footer></main></div></div>;
}
