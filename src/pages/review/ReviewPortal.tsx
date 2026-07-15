import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import {
  Activity,
  ArrowRight,
  BatteryCharging,
  Building2,
  CheckCircle2,
  CircleDollarSign,
  ClipboardCheck,
  CreditCard,
  Gauge,
  Globe2,
  KeyRound,
  LayoutDashboard,
  LockKeyhole,
  MapPin,
  MonitorSmartphone,
  Radio,
  RefreshCcw,
  Server,
  ShieldCheck,
  Smartphone,
  Store,
  UserRound,
  Users,
  WalletCards,
  Wrench,
  XCircle,
} from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";
import { LiquidBackground } from "@/components/LiquidBackground";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

type ReviewSection = "overview" | "site" | "client" | "admin" | "kiosk";

const NAV: Array<{ id: ReviewSection; label: string; icon: typeof Globe2 }> = [
  { id: "overview", label: "Vue générale", icon: LayoutDashboard },
  { id: "site", label: "Site public", icon: Globe2 },
  { id: "client", label: "Compte client", icon: UserRound },
  { id: "admin", label: "Administration", icon: ShieldCheck },
  { id: "kiosk", label: "Écran borne", icon: MonitorSmartphone },
];

const STATIONS = [
  { id: "DTA21269", place: "Lausanne Centre", online: true, available: 5, returns: 1, total: 6 },
  { id: "DTA21277", place: "Lausanne Gare", online: true, available: 4, returns: 2, total: 6 },
  { id: "DTA22032", place: "Ouchy", online: true, available: 6, returns: 0, total: 6 },
];

const ADMIN_ROUTES = [
  ["Pilotage", "Vue d’ensemble", "KPI, alertes, revenus et état du réseau"],
  ["Exploitation", "Bornes", "Stocks, slots, synchronisation et diagnostic"],
  ["Exploitation", "Tablettes kiosque", "Appairage sécurisé station-bound"],
  ["Exploitation", "Locations / Commandes", "Cycle location, tradeNo et batterie"],
  ["Finance", "Paiements", "Autorisation, capture, remboursement et incidents"],
  ["Finance", "Tarification", "1,50 CHF/h, blocs 30 min, plafond 18 CHF/jour"],
  ["Réseau", "Partenaires", "Contrats, établissements et affectations"],
  ["Support", "Maintenance", "Incidents, interventions et rapprochement"],
  ["Technique", "Santé parcours", "Stripe → ChargeNow → retour → règlement"],
  ["Technique", "Santé API", "Fonctions, quotas, scopes et disponibilité"],
  ["Technique", "Couverture API", "Routes branchées, tests et opérations futures"],
  ["Technique", "Événements", "Webhooks Stripe/ChargeNow et journal d’audit"],
  ["Configuration", "Utilisateurs & rôles", "Super-admin, admin, viewer et support"],
  ["Configuration", "Clés API", "Clés hashées, scopes lecture et quotas"],
];

const RENTALS = [
  { code: "CHG-7K2P9A", station: "DTA21269", status: "En cours", amount: "3,00 CHF", duration: "1 h 34" },
  { code: "CHG-4M8R2Q", station: "DTA21277", status: "Terminée", amount: "7,50 CHF", duration: "4 h 41" },
  { code: "CHG-1V6N5T", station: "DTA22032", status: "Remboursée", amount: "0,00 CHF", duration: "Échec éjection" },
];

function SectionShell({ children }: { children: React.ReactNode }) {
  return <div className="space-y-6">{children}</div>;
}

function SectionTitle({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return (
    <div>
      <p className="mb-2 text-xs font-bold uppercase tracking-[0.24em] text-primary">{eyebrow}</p>
      <h1 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">{title}</h1>
      <p className="mt-3 max-w-3xl text-muted-foreground">{description}</p>
    </div>
  );
}

function MetricCard({ icon: Icon, label, value, hint }: { icon: typeof Activity; label: string; value: string; hint: string }) {
  return (
    <Card className="glass liquid-border">
      <CardContent className="flex items-start gap-4 p-5">
        <div className="rounded-2xl bg-primary/15 p-3 text-primary"><Icon className="h-6 w-6" /></div>
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="mt-1 text-2xl font-extrabold">{value}</p>
          <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function Overview() {
  const improvements = [
    [ShieldCheck, "Paiement canonique", "Carte en autorisation manuelle, TWINT prépayé puis remboursé."],
    [BatteryCharging, "Retour exact", "Corrélation uniquement par tradeNo ou identifiant batterie."],
    [LockKeyhole, "Éjection protégée", "Service-role ou administrateur, feature flags et compensation Stripe."],
    [KeyRound, "Platform API", "Clés hashées, scopes, quotas atomiques et journaux expurgés."],
    [RefreshCcw, "Reprise automatique", "Inbox Stripe idempotente et règlements récupérables après interruption."],
    [ClipboardCheck, "Trois CI vertes", "Application, finance et matériel contrôlés séparément."],
  ] as const;

  return (
    <SectionShell>
      <SectionTitle
        eyebrow="Revue GitHub"
        title="Chargeurs.ch — plateforme consolidée"
        description="Cette prévisualisation autonome permet de parcourir les quatre surfaces du produit sans utiliser Lovable, sans compte réel, sans paiement et sans mouvement matériel."
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={Server} label="Bornes de test" value="3" hint="DTA21269 · DTA21277 · DTA22032" />
        <MetricCard icon={BatteryCharging} label="Batteries disponibles" value="15" hint="Données de démonstration" />
        <MetricCard icon={CircleDollarSign} label="Caution" value="30 CHF" hint="Autorisation ou prépaiement selon méthode" />
        <MetricCard icon={Gauge} label="Non-retour" value="99 CHF" hint="69 CHF supplémentaires avec consentement" />
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {improvements.map(([Icon, title, text]) => (
          <Card key={title} className="glass">
            <CardHeader>
              <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-2xl bg-success/15 text-success"><Icon className="h-6 w-6" /></div>
              <CardTitle className="text-lg">{title}</CardTitle>
              <CardDescription>{text}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </div>
      <Card className="glass-strong liquid-border">
        <CardHeader>
          <CardTitle>Parcours à examiner</CardTitle>
          <CardDescription>Utilise le menu pour ouvrir chaque surface comme si tu changeais de rôle.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {NAV.slice(1).map(({ id, label, icon: Icon }) => (
            <Button key={id} asChild variant="outline" className="h-auto justify-between rounded-2xl p-4">
              <Link to={`/review/${id}`}>
                <span className="flex items-center gap-3"><Icon className="h-5 w-5" />{label}</span>
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          ))}
        </CardContent>
      </Card>
    </SectionShell>
  );
}

function PublicSite() {
  return (
    <SectionShell>
      <SectionTitle eyebrow="Visiteur" title="Site public Chargeurs.ch" description="Présentation du service, tarification transparente et accès aux points de location." />
      <Card className="overflow-hidden border-primary/30 bg-gradient-to-br from-primary/20 via-background to-background">
        <CardContent className="grid gap-8 p-7 lg:grid-cols-[1.35fr_0.65fr] lg:p-10">
          <div>
            <Badge className="mb-5 rounded-full">Lausanne · Réseau en préparation</Badge>
            <h2 className="max-w-3xl font-display text-4xl font-black leading-tight sm:text-6xl">Une batterie nomade, quand ton téléphone en a besoin.</h2>
            <p className="mt-5 max-w-2xl text-lg text-muted-foreground">Scanne le QR code, autorise la caution, prends une batterie et rends-la dans une borne du réseau.</p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Button className="rounded-full px-7">Trouver une borne</Button>
              <Button variant="outline" className="rounded-full px-7">Devenir partenaire</Button>
            </div>
          </div>
          <div className="glass-strong rounded-3xl p-6">
            <p className="text-sm font-semibold text-muted-foreground">Tarification</p>
            <p className="mt-2 text-4xl font-black">1,50 CHF<span className="text-base font-medium text-muted-foreground"> / heure</span></p>
            <div className="mt-5 space-y-3 text-sm">
              <div className="flex justify-between"><span>Facturation</span><strong>par 30 minutes</strong></div>
              <div className="flex justify-between"><span>Plafond journalier</span><strong>18 CHF</strong></div>
              <div className="flex justify-between"><span>Caution initiale</span><strong>30 CHF</strong></div>
              <div className="flex justify-between"><span>Non-retour</span><strong>99 CHF au total</strong></div>
            </div>
          </div>
        </CardContent>
      </Card>
      <div className="grid gap-4 md:grid-cols-3">
        {[
          [Smartphone, "1. Scanne", "Le QR code de la borne ouvre un paiement sécurisé sur ton téléphone."],
          [CreditCard, "2. Autorise", "Carte et wallets compatibles ou TWINT selon les capacités Stripe."],
          [BatteryCharging, "3. Recharge", "La batterie libérée peut être rendue dans une borne du réseau."],
        ].map(([Icon, title, text]) => (
          <Card key={String(title)} className="glass">
            <CardHeader><Icon className="mb-3 h-8 w-8 text-primary" /><CardTitle>{String(title)}</CardTitle><CardDescription>{String(text)}</CardDescription></CardHeader>
          </Card>
        ))}
      </div>
      <Card className="glass">
        <CardHeader><CardTitle>Bornes visibles sur le réseau</CardTitle><CardDescription>Données fictives pour la revue visuelle.</CardDescription></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          {STATIONS.map((station) => (
            <div key={station.id} className="rounded-2xl border border-border p-4">
              <div className="flex items-center justify-between"><Badge variant="outline">{station.id}</Badge><span className="flex items-center gap-1 text-xs text-success"><CheckCircle2 className="h-3.5 w-3.5" />En ligne</span></div>
              <p className="mt-4 font-bold">{station.place}</p>
              <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground"><MapPin className="h-4 w-4" />Lausanne</p>
              <p className="mt-4 text-2xl font-black">{station.available}<span className="text-sm font-medium text-muted-foreground"> batteries</span></p>
            </div>
          ))}
        </CardContent>
      </Card>
    </SectionShell>
  );
}

function ClientAccount() {
  return (
    <SectionShell>
      <SectionTitle eyebrow="Client connecté" title="Compte de démonstration" description="Aucune authentification réelle n’est utilisée. Les données ci-dessous servent uniquement à examiner l’expérience client." />
      <div className="grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
        <Card className="glass-strong">
          <CardHeader><CardTitle className="flex items-center gap-2"><UserRound className="h-5 w-5" />Gaëtan — compte test</CardTitle><CardDescription>demo-client@chargeurs.invalid</CardDescription></CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Statut</span><Badge>Vérifié</Badge></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Langue</span><strong>Français</strong></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Moyen préféré</span><strong>Carte</strong></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Locations</span><strong>12</strong></div>
          </CardContent>
        </Card>
        <Card className="border-primary/30 bg-primary/5">
          <CardHeader><div className="flex items-center justify-between"><div><CardTitle>Location en cours</CardTitle><CardDescription>CHG-7K2P9A · DTA21269</CardDescription></div><Badge className="bg-success text-success-foreground">Active</Badge></div></CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-3">
              <div><p className="text-xs text-muted-foreground">Durée</p><p className="mt-1 text-xl font-black">1 h 34</p></div>
              <div><p className="text-xs text-muted-foreground">Estimation</p><p className="mt-1 text-xl font-black">3,00 CHF</p></div>
              <div><p className="text-xs text-muted-foreground">Caution</p><p className="mt-1 text-xl font-black">30 CHF</p></div>
            </div>
            <Progress value={38} className="mt-6" />
            <p className="mt-3 text-xs text-muted-foreground">Montant final calculé à la restitution. La carte n’est capturée qu’à hauteur du prix réel.</p>
          </CardContent>
        </Card>
      </div>
      <Card className="glass">
        <CardHeader><CardTitle>Historique des locations</CardTitle><CardDescription>Exemples des principaux états visibles par le client.</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          {RENTALS.map((rental) => (
            <div key={rental.code} className="grid gap-3 rounded-2xl border border-border p-4 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-center">
              <div><p className="font-mono text-sm font-bold">{rental.code}</p><p className="text-xs text-muted-foreground">{rental.station}</p></div>
              <div><p className="text-sm font-semibold">{rental.duration}</p><p className="text-xs text-muted-foreground">Durée / motif</p></div>
              <div><p className="font-bold">{rental.amount}</p><p className="text-xs text-muted-foreground">Montant final</p></div>
              <Badge variant={rental.status === "En cours" ? "default" : "outline"}>{rental.status}</Badge>
            </div>
          ))}
        </CardContent>
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="glass"><CardHeader><WalletCards className="mb-2 h-7 w-7 text-primary" /><CardTitle>Carte et wallets</CardTitle><CardDescription>Autorisation manuelle de 30 CHF, puis capture partielle au retour.</CardDescription></CardHeader></Card>
        <Card className="glass"><CardHeader><Smartphone className="mb-2 h-7 w-7 text-primary" /><CardTitle>TWINT</CardTitle><CardDescription>Prépaiement de 30 CHF, puis remboursement de la partie non utilisée.</CardDescription></CardHeader></Card>
      </div>
    </SectionShell>
  );
}

function AdminDashboard() {
  return (
    <SectionShell>
      <SectionTitle eyebrow="Super-administrateur" title="Back-office complet" description="Vue de revue sans connexion à la base réelle. Elle expose les écrans, statuts et nouvelles protections à contrôler avant staging." />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={Server} label="Bornes en ligne" value="3 / 3" hint="Synchronisation fictive récente" />
        <MetricCard icon={BatteryCharging} label="Locations actives" value="7" hint="Aucun cas ambigu" />
        <MetricCard icon={CreditCard} label="Autorisations" value="210 CHF" hint="7 × 30 CHF, non capturés" />
        <MetricCard icon={Wrench} label="Incidents ouverts" value="2" hint="1 paiement · 1 matériel" />
      </div>
      <div className="grid gap-4 xl:grid-cols-[1.25fr_0.75fr]">
        <Card className="glass">
          <CardHeader><CardTitle>Réseau des bornes</CardTitle><CardDescription>État opérationnel et stock de démonstration.</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            {STATIONS.map((station) => (
              <div key={station.id} className="grid gap-3 rounded-2xl border border-border p-4 sm:grid-cols-[1fr_auto_auto] sm:items-center">
                <div><div className="flex items-center gap-2"><strong>{station.id}</strong><Badge variant="outline">{station.place}</Badge></div><p className="mt-1 text-xs text-success">En ligne · synchronisée</p></div>
                <div className="text-sm"><strong>{station.available}</strong> disponibles</div>
                <div className="text-sm"><strong>{station.returns}</strong> retours libres</div>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card className="glass-strong">
          <CardHeader><CardTitle>Cycle financier</CardTitle><CardDescription>Flux canonique consolidé.</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            {[
              ["1", "Checkout", "Caution serveur de 30 CHF"],
              ["2", "Autorisation", "Carte manuelle ou TWINT prépayé"],
              ["3", "Éjection", "Après preuve financière valide"],
              ["4", "Retour exact", "tradeNo ou batterie"],
              ["5", "Règlement", "Capture, annulation ou remboursement"],
            ].map(([n, title, text]) => (
              <div key={n} className="flex gap-3"><div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary text-sm font-black text-primary-foreground">{n}</div><div><p className="font-bold">{title}</p><p className="text-xs text-muted-foreground">{text}</p></div></div>
            ))}
          </CardContent>
        </Card>
      </div>
      <Card className="glass">
        <CardHeader><CardTitle>Catalogue du back-office</CardTitle><CardDescription>Tous les espaces accessibles dans l’administration finale.</CardDescription></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {ADMIN_ROUTES.map(([group, label, description]) => (
            <div key={`${group}-${label}`} className="rounded-2xl border border-border p-4">
              <p className="text-[0.65rem] font-bold uppercase tracking-wider text-primary">{group}</p>
              <p className="mt-1 font-bold">{label}</p>
              <p className="mt-2 text-xs text-muted-foreground">{description}</p>
            </div>
          ))}
        </CardContent>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="glass">
          <CardHeader><CardTitle className="flex items-center gap-2"><KeyRound className="h-5 w-5" />Platform API</CardTitle><CardDescription>Administration des intégrations partenaires.</CardDescription></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex justify-between"><span>Clés brutes</span><strong>affichées une fois</strong></div>
            <div className="flex justify-between"><span>Stockage</span><strong>SHA-256 uniquement</strong></div>
            <div className="flex justify-between"><span>Scopes actuels</span><strong>lecture uniquement</strong></div>
            <div className="flex justify-between"><span>Quotas</span><strong>atomiques / minute</strong></div>
            <div className="flex justify-between"><span>LIVE</span><Badge variant="outline">désactivé</Badge></div>
          </CardContent>
        </Card>
        <Card className="glass">
          <CardHeader><CardTitle className="flex items-center gap-2"><Radio className="h-5 w-5" />Événements et incidents</CardTitle><CardDescription>Les cas ambigus ne modifient jamais l’argent automatiquement.</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-3 rounded-xl border border-warning/40 bg-warning/10 p-3"><XCircle className="h-5 w-5 text-warning" /><div><p className="text-sm font-bold">Retour batterie non concordant</p><p className="text-xs text-muted-foreground">Envoyé en intervention manuelle.</p></div></div>
            <div className="flex items-center gap-3 rounded-xl border border-success/40 bg-success/10 p-3"><CheckCircle2 className="h-5 w-5 text-success" /><div><p className="text-sm font-bold">Échec d’éjection compensé</p><p className="text-xs text-muted-foreground">Autorisation annulée ou TWINT remboursé.</p></div></div>
          </CardContent>
        </Card>
      </div>
    </SectionShell>
  );
}

function KioskReview() {
  return (
    <SectionShell>
      <SectionTitle eyebrow="Tablette appairée" title="Kiosk DTA21269" description="Simulation de l’écran tactile lié à une borne. Aucun bouton de cette page n’appelle Stripe ou ChargeNow." />
      <div className="mx-auto max-w-4xl rounded-[2.5rem] border-[10px] border-foreground/15 bg-background p-4 shadow-2xl sm:p-7">
        <div className="glass-strong rounded-[1.8rem] p-6 sm:p-10">
          <div className="flex items-center justify-between"><BrandLogo size="sm" /><Badge className="bg-success text-success-foreground">Borne en ligne</Badge></div>
          <div className="mt-12 text-center">
            <Badge variant="outline" className="mb-5 rounded-full">DTA21269 · Lausanne Centre</Badge>
            <h2 className="font-display text-4xl font-black sm:text-6xl">Batterie nomade, à emporter</h2>
            <p className="mx-auto mt-4 max-w-xl text-lg text-muted-foreground">Recharge ton téléphone partout et rends la batterie dans une borne Chargeurs.ch.</p>
            <div className="mx-auto mt-8 grid max-w-2xl gap-4 sm:grid-cols-3">
              <div className="rounded-2xl border border-border p-4"><BatteryCharging className="mx-auto h-8 w-8 text-success" /><p className="mt-2 text-3xl font-black">5</p><p className="text-xs text-muted-foreground">disponibles</p></div>
              <div className="rounded-2xl border border-border p-4"><CircleDollarSign className="mx-auto h-8 w-8 text-primary" /><p className="mt-2 text-3xl font-black">30 CHF</p><p className="text-xs text-muted-foreground">caution</p></div>
              <div className="rounded-2xl border border-border p-4"><Activity className="mx-auto h-8 w-8 text-primary" /><p className="mt-2 text-3xl font-black">1,50</p><p className="text-xs text-muted-foreground">CHF / heure</p></div>
            </div>
            <Button className="mt-9 h-auto rounded-full px-10 py-6 text-xl font-black" disabled>Mode revue — location désactivée</Button>
            <div className="mt-7 flex flex-wrap justify-center gap-2 text-xs text-muted-foreground">
              <Badge variant="outline">Carte</Badge><Badge variant="outline">Apple Pay</Badge><Badge variant="outline">Google Pay</Badge><Badge variant="outline">TWINT</Badge>
            </div>
          </div>
        </div>
      </div>
      <Card className="glass">
        <CardHeader><CardTitle>Protections visibles dans cette version</CardTitle></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          {[
            [LockKeyhole, "Tablette liée à la borne", "Le token kiosk ne peut pas agir sur une autre station."],
            [ShieldCheck, "Montant calculé côté serveur", "Le navigateur ne décide jamais de la caution."],
            [RefreshCcw, "Reprise idempotente", "Un double toucher ne crée pas deux sessions."],
            [Wrench, "Compensation automatique", "Échec définitif : annulation ou remboursement sécurisé."],
          ].map(([Icon, title, text]) => (
            <div key={String(title)} className="flex gap-3 rounded-2xl border border-border p-4"><Icon className="h-5 w-5 shrink-0 text-primary" /><div><p className="font-bold">{String(title)}</p><p className="mt-1 text-xs text-muted-foreground">{String(text)}</p></div></div>
          ))}
        </CardContent>
      </Card>
    </SectionShell>
  );
}

export default function ReviewPortal() {
  const params = useParams();
  const section = useMemo<ReviewSection>(() => {
    const candidate = params.section as ReviewSection | undefined;
    return NAV.some((item) => item.id === candidate) ? candidate! : "overview";
  }, [params.section]);

  const content = section === "site"
    ? <PublicSite />
    : section === "client"
      ? <ClientAccount />
      : section === "admin"
        ? <AdminDashboard />
        : section === "kiosk"
          ? <KioskReview />
          : <Overview />;

  return (
    <div className="relative min-h-screen">
      <LiquidBackground />
      <div className="relative z-10 mx-auto flex min-h-screen max-w-[1600px] flex-col lg:flex-row">
        <aside className="glass-strong border-b border-border p-4 lg:sticky lg:top-0 lg:h-screen lg:w-72 lg:border-b-0 lg:border-r lg:p-6">
          <div className="flex items-center justify-between lg:block">
            <BrandLogo size="sm" />
            <Badge variant="outline" className="lg:mt-4">GitHub Preview</Badge>
          </div>
          <nav className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-5 lg:grid-cols-1">
            {NAV.map(({ id, label, icon: Icon }) => (
              <Button key={id} asChild variant="ghost" className={cn("h-auto justify-start rounded-xl px-3 py-3", section === id && "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground")}>
                <Link to={id === "overview" ? "/review" : `/review/${id}`}><Icon className="mr-2 h-4 w-4" />{label}</Link>
              </Button>
            ))}
          </nav>
          <div className="mt-6 hidden rounded-2xl border border-warning/30 bg-warning/10 p-4 text-xs lg:block">
            <p className="font-bold">Mode démonstration</p>
            <p className="mt-1 text-muted-foreground">Aucun compte réel, aucune clé, aucun paiement et aucune commande matérielle.</p>
          </div>
        </aside>
        <main className="min-w-0 flex-1 p-5 sm:p-8 lg:p-10">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-background/60 px-4 py-3 backdrop-blur-xl">
            <div className="flex items-center gap-2 text-sm"><Building2 className="h-4 w-4 text-primary" /><strong>Chargeurs.ch</strong><span className="text-muted-foreground">· branche integration/chargeurs-beta-platform</span></div>
            <div className="flex items-center gap-2"><Badge variant="outline">Lecture seule</Badge><Badge className="bg-success text-success-foreground">CI validée</Badge></div>
          </div>
          {content}
          <footer className="mt-12 border-t border-border pt-5 text-center text-xs text-muted-foreground">Prévisualisation générée et déployée depuis GitHub uniquement.</footer>
        </main>
      </div>
    </div>
  );
}
