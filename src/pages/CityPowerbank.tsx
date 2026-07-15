import { useEffect } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { BatteryCharging, MapPin, ShieldCheck, Smartphone, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PublicNav } from "@/components/public/PublicNav";
import { LiquidBackground } from "@/components/LiquidBackground";
import { cityBySlug, cityJsonLd, ROMAND_CITIES, SEO_TERMS, setPageSeo } from "@/lib/seo";

export default function CityPowerbank() {
  const { citySlug } = useParams();
  const city = cityBySlug(citySlug);

  useEffect(() => {
    if (!city) return;
    const title = `Location powerbank à ${city.name} | Recharge natel | Chargeurs.ch`;
    const description = `Louez une batterie externe à ${city.name} pour recharger votre natel, iPhone ou smartphone. Paiement par QR code, 1.50 CHF/h, plafond 18 CHF/jour.`;
    setPageSeo({
      title,
      description,
      path: `/powerbank/${city.slug}`,
      keywords: [
        `location powerbank ${city.name}`,
        `batterie externe ${city.name}`,
        `recharge natel ${city.name}`,
        `chargeur smartphone ${city.name}`,
        `borne de recharge téléphone ${city.name}`,
        ...SEO_TERMS,
      ],
      jsonLd: cityJsonLd(city),
    });
  }, [city]);

  if (!city) return <Navigate to="/" replace />;

  const nearby = ROMAND_CITIES.filter((item) => item.canton === city.canton && item.slug !== city.slug).slice(0, 8);

  return (
    <div className="relative min-h-screen">
      <LiquidBackground />
      <PublicNav />
      <main className="mx-auto max-w-6xl px-6 pb-20 pt-28 sm:px-10">
        <section className="glass-strong liquid-border rounded-3xl p-8 sm:p-12">
          <div className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm text-secondary">
            <MapPin className="h-4 w-4" /> {city.name}, {city.canton}
          </div>
          <h1 className="mt-6 max-w-4xl font-display text-4xl font-extrabold leading-tight sm:text-6xl">
            Louer une powerbank à <span className="text-gradient">{city.name}</span>
          </h1>
          <p className="mt-6 max-w-3xl text-lg text-muted-foreground">
            Chargeurs.ch facilite la recharge de votre natel ou smartphone grâce à des bornes de batteries externes installées dans des établissements partenaires. Scannez le QR code, autorisez la caution et emportez votre batterie.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild className="rounded-full bg-gradient-primary px-7 py-6 text-base font-bold shadow-glow">
              <Link to="/?section=bornes">Voir les bornes disponibles</Link>
            </Button>
            <Button asChild variant="ghost" className="rounded-full border border-border px-7 py-6 text-base">
              <Link to="/?section=contact">Contacter Chargeurs.ch</Link>
            </Button>
          </div>
        </section>

        <section className="grid gap-4 py-10 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { icon: Zap, title: "1.50 CHF / heure", text: "Facturation par tranche de 30 minutes." },
            { icon: ShieldCheck, title: "30 CHF de caution", text: "Autorisation sécurisée avant la location." },
            { icon: BatteryCharging, title: "18 CHF maximum / jour", text: "Le tarif journalier est plafonné." },
            { icon: Smartphone, title: "Pour natels et smartphones", text: "USB-C, Lightning et principaux appareils." },
          ].map((item) => (
            <article key={item.title} className="glass rounded-2xl p-6">
              <item.icon className="h-7 w-7 text-primary" />
              <h2 className="mt-4 font-bold">{item.title}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{item.text}</p>
            </article>
          ))}
        </section>

        <section className="glass liquid-border rounded-3xl p-8">
          <h2 className="font-display text-3xl font-bold">Où recharger son téléphone à {city.name} ?</h2>
          <p className="mt-4 text-muted-foreground">
            Le réseau Chargeurs.ch vise les lieux où une batterie vide devient réellement gênante : bars, restaurants, hôtels, événements, salles de sport, centres commerciaux, gares et espaces de loisirs. La carte publique n’affiche que les bornes déclarées disponibles ou bientôt disponibles.
          </p>
          <h3 className="mt-8 text-xl font-bold">Comment fonctionne la location ?</h3>
          <ol className="mt-4 grid gap-3 text-muted-foreground sm:grid-cols-2">
            <li className="rounded-xl border border-border p-4">1. Trouvez une borne Chargeurs.ch.</li>
            <li className="rounded-xl border border-border p-4">2. Scannez le QR code avec votre natel.</li>
            <li className="rounded-xl border border-border p-4">3. Autorisez la caution de 30 CHF.</li>
            <li className="rounded-xl border border-border p-4">4. Rendez la batterie dans une borne compatible.</li>
          </ol>
        </section>

        <section className="py-10">
          <h2 className="font-display text-2xl font-bold">Autres villes couvertes dans {city.canton}</h2>
          <div className="mt-5 flex flex-wrap gap-3">
            {nearby.map((item) => (
              <Link key={item.slug} to={`/powerbank/${item.slug}`} className="glass rounded-full px-4 py-2 text-sm transition hover:text-primary">
                Powerbank {item.name}
              </Link>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
