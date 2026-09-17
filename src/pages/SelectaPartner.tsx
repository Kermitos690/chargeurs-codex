import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  BarChart3,
  BatteryCharging,
  Building2,
  CheckCircle2,
  ChevronRight,
  CircleGauge,
  Globe2,
  MapPin,
  MessageCircle,
  MonitorSmartphone,
  QrCode,
  ShieldCheck,
  Sparkles,
  Store,
  TrainFront,
  Trees,
  Zap,
} from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";
import { LiquidBackground } from "@/components/LiquidBackground";
import { Button } from "@/components/ui/button";

const scenarios = [
  {
    id: "indoor",
    label: "Point de vente",
    icon: Store,
    title: "Un service compact à côté d'un point de vente autonome",
    description:
      "Une station de recharge visible, simple à comprendre et pensée pour compléter un environnement de vente sans personnel dédié.",
    bullets: ["Format compact", "Parcours QR sans application obligatoire", "Supervision à distance"],
  },
  {
    id: "outdoor",
    label: "Extérieur",
    icon: Trees,
    title: "Un scénario outdoor à étudier avec le bon matériel",
    description:
      "Pour les emplacements exposés, l'approche consiste à sélectionner une station adaptée au contexte réel : protection, fixation, alimentation et maintenance.",
    bullets: ["Matériel adapté au site", "Implantation à valider", "Maintenance intégrée au pilote"],
  },
  {
    id: "mobility",
    label: "Mobilité",
    icon: TrainFront,
    title: "Une extension naturelle dans les lieux de passage",
    description:
      "Gares, hubs et zones de transit sont des contextes où le besoin de batterie est immédiat et où un réseau de retour peut prendre tout son sens.",
    bullets: ["Besoin client identifiable", "Réseau multi-sites", "Mesure de l'usage par emplacement"],
  },
];

const principles = [
  {
    icon: QrCode,
    title: "Simple côté client",
    text: "Scanner, louer, utiliser, restituer. Le parcours est conçu pour rester compréhensible sans téléchargement imposé.",
  },
  {
    icon: CircleGauge,
    title: "Pilotable à distance",
    text: "Disponibilité, activité et incidents peuvent être suivis depuis l'infrastructure Chargeurs.ch.",
  },
  {
    icon: ShieldCheck,
    title: "Cadre de test maîtrisé",
    text: "Le pilote définit en amont les emplacements, responsabilités, indicateurs et conditions de sortie.",
  },
];

const faqs = [
  {
    q: "Est-ce une annonce de partenariat entre Selecta et Chargeurs.ch ?",
    a: "Non. Cette page est une proposition exploratoire préparée par Chargeurs.ch afin de rendre une première discussion plus concrète. Aucun partenariat n'est présenté comme acquis.",
  },
  {
    q: "Faut-il déployer beaucoup de stations dès le départ ?",
    a: "Non. L'idée proposée ici est précisément l'inverse : démarrer sur un petit nombre d'emplacements, mesurer l'usage et ne décider d'une éventuelle extension qu'avec des données terrain.",
  },
  {
    q: "Le modèle technique est-il figé ?",
    a: "Non. Le format de station, le niveau de personnalisation, l'emplacement et les modalités opérationnelles peuvent être adaptés au scénario retenu.",
  },
  {
    q: "Que cherche Chargeurs.ch à valider pendant un pilote ?",
    a: "Principalement l'adoption client, la rotation des batteries, la disponibilité des stations, les besoins de maintenance et la pertinence de chaque type d'emplacement.",
  },
];

export default function SelectaPartner() {
  const [scenarioId, setScenarioId] = useState("indoor");
  const [sites, setSites] = useState(3);
  const [rentalsPerDay, setRentalsPerDay] = useState(5);

  const activeScenario = scenarios.find((scenario) => scenario.id === scenarioId) ?? scenarios[0];
  const monthlyRentals = useMemo(() => sites * rentalsPerDay * 30, [sites, rentalsPerDay]);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = "Proposition Selecta | Chargeurs.ch";

    let robots = document.querySelector('meta[name="robots"]') as HTMLMetaElement | null;
    const previousRobots = robots?.content;
    let createdRobots = false;

    if (!robots) {
      robots = document.createElement("meta");
      robots.name = "robots";
      document.head.appendChild(robots);
      createdRobots = true;
    }

    robots.content = "noindex, nofollow, noarchive";

    return () => {
      document.title = previousTitle;
      if (createdRobots) robots?.remove();
      else if (robots && previousRobots !== undefined) robots.content = previousRobots;
    };
  }, []);

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-background text-foreground">
      <LiquidBackground />

      <header className="fixed inset-x-0 top-0 z-50 border-b border-border/60 bg-background/75 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-4 sm:px-8">
          <a href="#top" aria-label="Chargeurs.ch" className="shrink-0">
            <BrandLogo />
          </a>
          <div className="hidden items-center gap-2 rounded-full border border-border/70 bg-card/70 px-4 py-2 text-xs font-medium text-muted-foreground sm:flex">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            Proposition exploratoire dédiée à Selecta
          </div>
          <Button
            variant="outline"
            className="rounded-full"
            onClick={() => scrollTo("contact")}
          >
            Échanger
          </Button>
        </div>
      </header>

      <main id="top" className="relative z-10">
        <section className="mx-auto grid min-h-[92vh] max-w-7xl items-center gap-12 px-5 pb-20 pt-32 sm:px-8 lg:grid-cols-[1.1fr_0.9fr] lg:pt-36">
          <div>
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-4 py-2 text-sm font-semibold text-primary">
              <Zap className="h-4 w-4" />
              Chargeurs.ch × opportunité retail autonome
            </div>
            <h1 className="max-w-4xl font-display text-5xl font-black leading-[0.98] tracking-tight sm:text-6xl lg:text-7xl">
              Et si la recharge mobile devenait un service autonome de proximité ?
            </h1>
            <p className="mt-7 max-w-2xl text-lg leading-8 text-muted-foreground sm:text-xl">
              Une proposition conçue pour ouvrir la discussion avec Selecta : tester la location de powerbanks sur quelques emplacements, mesurer l'usage réel et décider ensuite — sans déploiement massif ni engagement prématuré.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button
                className="rounded-full bg-gradient-primary px-7 py-6 font-bold shadow-glow"
                onClick={() => scrollTo("pilote")}
              >
                Explorer le pilote <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                className="rounded-full px-7 py-6"
                onClick={() => scrollTo("experience")}
              >
                Voir l'expérience client
              </Button>
            </div>
            <p className="mt-5 max-w-2xl text-xs leading-5 text-muted-foreground">
              Cette page a été préparée par Chargeurs.ch. Elle ne constitue pas l'annonce d'un partenariat, d'un accord commercial ou d'une validation par Selecta.
            </p>
          </div>

          <div className="relative">
            <div className="absolute -inset-10 -z-10 rounded-full bg-primary/10 blur-3xl" />
            <div className="glass-strong liquid-border rounded-[2rem] p-5 shadow-2xl sm:p-7">
              <div className="flex items-center justify-between gap-4 border-b border-border/60 pb-5">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Concept pilote</p>
                  <p className="mt-1 text-lg font-bold">Recharge mobile, en libre-service</p>
                </div>
                <div className="rounded-2xl bg-primary/10 p-3 text-primary">
                  <BatteryCharging className="h-7 w-7" />
                </div>
              </div>

              <div className="mt-6 space-y-3">
                {[
                  ["01", "Scanner", "Un QR code ouvre le parcours de location."],
                  ["02", "Emporter", "Une powerbank est libérée pour accompagner le client."],
                  ["03", "Restituer", "La batterie revient dans une station compatible du réseau."],
                ].map(([number, title, text]) => (
                  <div key={number} className="flex gap-4 rounded-2xl border border-border/60 bg-card/60 p-4">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-black text-primary-foreground">
                      {number}
                    </div>
                    <div>
                      <p className="font-bold">{title}</p>
                      <p className="mt-1 text-sm leading-6 text-muted-foreground">{text}</p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-5 grid grid-cols-2 gap-3">
                <div className="rounded-2xl border border-border/60 bg-card/60 p-4">
                  <QrCode className="h-5 w-5 text-primary" />
                  <p className="mt-3 text-sm font-semibold">Sans application obligatoire</p>
                </div>
                <div className="rounded-2xl border border-border/60 bg-card/60 p-4">
                  <CircleGauge className="h-5 w-5 text-primary" />
                  <p className="mt-3 text-sm font-semibold">Supervision à distance</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="experience" className="scroll-mt-28 border-y border-border/60 bg-card/30 py-20">
          <div className="mx-auto max-w-7xl px-5 sm:px-8">
            <div className="max-w-3xl">
              <p className="text-sm font-bold uppercase tracking-[0.2em] text-primary">01 — Expérience</p>
              <h2 className="mt-4 font-display text-4xl font-black sm:text-5xl">Un nouveau service sans compliquer le point de vente.</h2>
              <p className="mt-5 text-lg leading-8 text-muted-foreground">
                L'objectif n'est pas d'ajouter une procédure. Il est de proposer un service autonome, visible et mesurable qui s'intègre à un environnement déjà conçu pour fonctionner efficacement.
              </p>
            </div>

            <div className="mt-10 grid gap-4 md:grid-cols-3">
              {principles.map(({ icon: Icon, title, text }) => (
                <article key={title} className="glass liquid-border rounded-3xl p-6">
                  <div className="inline-flex rounded-2xl bg-primary/10 p-3 text-primary"><Icon className="h-6 w-6" /></div>
                  <h3 className="mt-5 text-xl font-bold">{title}</h3>
                  <p className="mt-3 text-sm leading-6 text-muted-foreground">{text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-5 py-24 sm:px-8">
          <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr]">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.2em] text-primary">02 — Scénarios</p>
              <h2 className="mt-4 font-display text-4xl font-black">Explorer avant de choisir.</h2>
              <p className="mt-5 leading-7 text-muted-foreground">
                Le bon format dépend de l'emplacement. Cette proposition ne présuppose donc pas une seule configuration : elle permet d'abord de cadrer le contexte à tester.
              </p>
              <div className="mt-7 space-y-2">
                {scenarios.map(({ id, label, icon: Icon }) => {
                  const active = scenarioId === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setScenarioId(id)}
                      className={`flex w-full items-center justify-between rounded-2xl border px-5 py-4 text-left transition ${
                        active ? "border-primary/50 bg-primary/10" : "border-border/60 bg-card/40 hover:bg-card/80"
                      }`}
                    >
                      <span className="flex items-center gap-3 font-semibold"><Icon className="h-5 w-5 text-primary" />{label}</span>
                      <ChevronRight className={`h-5 w-5 transition ${active ? "translate-x-1 text-primary" : "text-muted-foreground"}`} />
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="glass-strong liquid-border rounded-[2rem] p-7 sm:p-9">
              <div className="inline-flex rounded-2xl bg-primary/10 p-3 text-primary">
                <activeScenario.icon className="h-7 w-7" />
              </div>
              <h3 className="mt-6 max-w-2xl text-3xl font-black">{activeScenario.title}</h3>
              <p className="mt-4 max-w-2xl leading-7 text-muted-foreground">{activeScenario.description}</p>
              <div className="mt-7 grid gap-3 sm:grid-cols-3">
                {activeScenario.bullets.map((bullet) => (
                  <div key={bullet} className="rounded-2xl border border-border/60 bg-card/60 p-4 text-sm font-semibold">
                    <CheckCircle2 className="mb-3 h-5 w-5 text-primary" />
                    {bullet}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="border-y border-border/60 bg-card/30 py-24">
          <div className="mx-auto grid max-w-7xl gap-12 px-5 sm:px-8 lg:grid-cols-2">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.2em] text-primary">03 — Dimensionnement</p>
              <h2 className="mt-4 font-display text-4xl font-black">Un petit pilote peut déjà produire des données utiles.</h2>
              <p className="mt-5 max-w-xl leading-7 text-muted-foreground">
                Ce simulateur ne projette ni chiffre d'affaires ni rentabilité. Il montre simplement combien d'interactions mensuelles un pilote pourrait observer selon deux hypothèses faciles à ajuster.
              </p>

              <div className="mt-8 space-y-7 rounded-3xl border border-border/60 bg-background/60 p-6">
                <label className="block">
                  <span className="flex items-center justify-between gap-4 text-sm font-semibold">
                    <span>Nombre d'emplacements</span><strong className="text-primary">{sites}</strong>
                  </span>
                  <input
                    aria-label="Nombre d'emplacements"
                    type="range"
                    min="1"
                    max="20"
                    value={sites}
                    onChange={(event) => setSites(Number(event.target.value))}
                    className="mt-4 w-full accent-current"
                  />
                </label>
                <label className="block">
                  <span className="flex items-center justify-between gap-4 text-sm font-semibold">
                    <span>Locations par jour et par emplacement</span><strong className="text-primary">{rentalsPerDay}</strong>
                  </span>
                  <input
                    aria-label="Locations par jour et par emplacement"
                    type="range"
                    min="1"
                    max="30"
                    value={rentalsPerDay}
                    onChange={(event) => setRentalsPerDay(Number(event.target.value))}
                    className="mt-4 w-full accent-current"
                  />
                </label>
              </div>
            </div>

            <div className="flex items-center">
              <div className="glass-strong liquid-border w-full rounded-[2rem] p-8 sm:p-10">
                <BarChart3 className="h-8 w-8 text-primary" />
                <p className="mt-6 text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground">Volume d'observation indicatif</p>
                <p className="mt-2 text-6xl font-black tracking-tight sm:text-7xl">{monthlyRentals.toLocaleString("fr-CH")}</p>
                <p className="mt-2 text-lg font-semibold">locations / mois</p>
                <div className="mt-7 border-t border-border/60 pt-6 text-sm leading-6 text-muted-foreground">
                  Hypothèse : {sites} emplacement{sites > 1 ? "s" : ""} × {rentalsPerDay} location{rentalsPerDay > 1 ? "s" : ""}/jour × 30 jours. Ce calcul est illustratif et ne constitue pas une prévision commerciale.
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="pilote" className="scroll-mt-28 mx-auto max-w-7xl px-5 py-24 sm:px-8">
          <div className="max-w-3xl">
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-primary">04 — Pilote proposé</p>
            <h2 className="mt-4 font-display text-4xl font-black sm:text-5xl">Commencer petit. Mesurer correctement. Décider ensuite.</h2>
            <p className="mt-5 text-lg leading-8 text-muted-foreground">
              La proposition n'est pas de vendre un déploiement national sur une présentation. C'est de construire un test suffisamment simple pour apprendre quelque chose de fiable.
            </p>
          </div>

          <div className="mt-12 grid gap-4 lg:grid-cols-4">
            {[
              ["1", "Cadrer", "Choisir quelques emplacements et définir les responsabilités opérationnelles."],
              ["2", "Installer", "Mettre en place le matériel adapté avec un parcours client clairement identifié."],
              ["3", "Mesurer", "Suivre usage, disponibilité, retours, incidents et maintenance pendant la période test."],
              ["4", "Décider", "Partager les résultats et choisir ensemble : ajuster, étendre ou arrêter proprement."],
            ].map(([number, title, text]) => (
              <article key={number} className="relative overflow-hidden rounded-3xl border border-border/60 bg-card/60 p-6">
                <span className="absolute right-4 top-1 text-7xl font-black text-primary/10">{number}</span>
                <p className="relative text-xl font-black">{title}</p>
                <p className="relative mt-4 text-sm leading-6 text-muted-foreground">{text}</p>
              </article>
            ))}
          </div>

          <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {[
              [MapPin, "Emplacement", "Comparer la performance selon le contexte réel."],
              [BatteryCharging, "Rotation", "Observer la fréquence d'utilisation des batteries."],
              [MonitorSmartphone, "Disponibilité", "Suivre le fonctionnement et les incidents du service."],
              [BarChart3, "Adoption", "Mesurer l'usage avant toute décision d'extension."],
            ].map(([Icon, title, text]) => {
              const MetricIcon = Icon as typeof MapPin;
              return (
                <div key={String(title)} className="rounded-2xl border border-border/60 bg-card/40 p-5">
                  <MetricIcon className="h-5 w-5 text-primary" />
                  <p className="mt-4 font-bold">{String(title)}</p>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{String(text)}</p>
                </div>
              );
            })}
          </div>
        </section>

        <section className="border-y border-border/60 bg-card/30 py-24">
          <div className="mx-auto max-w-7xl px-5 sm:px-8">
            <div className="grid gap-12 lg:grid-cols-[0.85fr_1.15fr]">
              <div>
                <p className="text-sm font-bold uppercase tracking-[0.2em] text-primary">05 — Intégration</p>
                <h2 className="mt-4 font-display text-4xl font-black">Le service peut rester discret — la donnée, elle, doit être claire.</h2>
                <p className="mt-5 leading-7 text-muted-foreground">
                  L'interface opérationnelle est pensée pour centraliser ce qui compte : état des stations, disponibilité, activité et suivi des anomalies.
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                {[
                  [Globe2, "Réseau", "Une logique multi-sites pour permettre à terme un retour flexible selon le réseau déployé."],
                  [CircleGauge, "Monitoring", "Suivi opérationnel à distance pour limiter les interventions à l'aveugle."],
                  [Building2, "Personnalisation", "Habillage et niveau de co-branding à définir uniquement si les deux parties le souhaitent."],
                  [MessageCircle, "Support", "Un point de contact clair pour les questions clients et les incidents à traiter."],
                ].map(([Icon, title, text]) => {
                  const FeatureIcon = Icon as typeof Globe2;
                  return (
                    <div key={String(title)} className="glass liquid-border rounded-3xl p-6">
                      <FeatureIcon className="h-6 w-6 text-primary" />
                      <h3 className="mt-5 text-lg font-bold">{String(title)}</h3>
                      <p className="mt-2 text-sm leading-6 text-muted-foreground">{String(text)}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-5xl px-5 py-24 sm:px-8">
          <div className="text-center">
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-primary">Questions naturelles</p>
            <h2 className="mt-4 font-display text-4xl font-black">Avant même le premier rendez-vous.</h2>
          </div>
          <div className="mt-10 space-y-3">
            {faqs.map(({ q, a }) => (
              <details key={q} className="group rounded-2xl border border-border/60 bg-card/60 p-5 open:bg-card/90">
                <summary className="cursor-pointer list-none pr-8 font-bold marker:hidden">{q}</summary>
                <p className="mt-4 max-w-3xl text-sm leading-7 text-muted-foreground">{a}</p>
              </details>
            ))}
          </div>
        </section>

        <section id="contact" className="scroll-mt-28 px-5 pb-24 sm:px-8">
          <div className="mx-auto max-w-6xl overflow-hidden rounded-[2.25rem] border border-primary/25 bg-primary/10 p-8 text-center shadow-2xl sm:p-14">
            <div className="mx-auto inline-flex rounded-2xl bg-primary/15 p-3 text-primary"><Sparkles className="h-7 w-7" /></div>
            <h2 className="mx-auto mt-6 max-w-3xl font-display text-4xl font-black sm:text-5xl">Pas besoin de décider aujourd'hui. Il suffit de voir si l'idée mérite une conversation.</h2>
            <p className="mx-auto mt-5 max-w-2xl text-lg leading-8 text-muted-foreground">
              Chargeurs.ch peut présenter le parcours, le matériel disponible et une proposition de pilote courte, puis laisser les données parler.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Button asChild className="rounded-full bg-gradient-primary px-8 py-6 font-bold shadow-glow">
                <a href="mailto:partenaires@chargeurs.ch?subject=Discussion%20exploratoire%20Selecta%20%2F%20Chargeurs.ch">
                  Ouvrir la discussion <ArrowRight className="ml-2 h-4 w-4" />
                </a>
              </Button>
              <Button variant="outline" className="rounded-full px-8 py-6" onClick={() => scrollTo("top")}>Revoir le concept</Button>
            </div>
          </div>
        </section>
      </main>

      <footer className="relative z-10 border-t border-border/60 bg-background/80">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 py-8 text-xs leading-5 text-muted-foreground sm:px-8 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3"><BrandLogo /><span>Proposition exploratoire B2B</span></div>
          <p className="max-w-2xl md:text-right">
            Selecta est citée uniquement comme destinataire de cette proposition. Cette page n'indique ni affiliation, ni approbation, ni partenariat existant entre Selecta et Chargeurs.ch.
          </p>
        </div>
      </footer>
    </div>
  );
}
