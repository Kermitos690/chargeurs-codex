export const SITE_NAME = "Chargeurs.ch";
export const SITE_ORIGIN = "https://chargeurs.ch";

export const ROMAND_CITIES = [
  { slug: "lausanne", name: "Lausanne", canton: "Vaud", priority: 1 },
  { slug: "epalinges", name: "Épalinges", canton: "Vaud", priority: 1 },
  { slug: "renens", name: "Renens", canton: "Vaud", priority: 1 },
  { slug: "prilly", name: "Prilly", canton: "Vaud", priority: 1 },
  { slug: "pully", name: "Pully", canton: "Vaud", priority: 1 },
  { slug: "morges", name: "Morges", canton: "Vaud", priority: 1 },
  { slug: "nyon", name: "Nyon", canton: "Vaud", priority: 1 },
  { slug: "vevey", name: "Vevey", canton: "Vaud", priority: 1 },
  { slug: "montreux", name: "Montreux", canton: "Vaud", priority: 1 },
  { slug: "yverdon-les-bains", name: "Yverdon-les-Bains", canton: "Vaud", priority: 1 },
  { slug: "aigle", name: "Aigle", canton: "Vaud", priority: 2 },
  { slug: "gland", name: "Gland", canton: "Vaud", priority: 2 },
  { slug: "rolle", name: "Rolle", canton: "Vaud", priority: 2 },
  { slug: "lutry", name: "Lutry", canton: "Vaud", priority: 2 },
  { slug: "bussigny", name: "Bussigny", canton: "Vaud", priority: 2 },
  { slug: "crissier", name: "Crissier", canton: "Vaud", priority: 2 },
  { slug: "ecublens", name: "Ecublens", canton: "Vaud", priority: 2 },
  { slug: "geneve", name: "Genève", canton: "Genève", priority: 2 },
  { slug: "carouge", name: "Carouge", canton: "Genève", priority: 3 },
  { slug: "fribourg", name: "Fribourg", canton: "Fribourg", priority: 2 },
  { slug: "bulle", name: "Bulle", canton: "Fribourg", priority: 3 },
  { slug: "neuchatel", name: "Neuchâtel", canton: "Neuchâtel", priority: 2 },
  { slug: "la-chaux-de-fonds", name: "La Chaux-de-Fonds", canton: "Neuchâtel", priority: 3 },
  { slug: "sion", name: "Sion", canton: "Valais", priority: 2 },
  { slug: "martigny", name: "Martigny", canton: "Valais", priority: 3 },
  { slug: "monthey", name: "Monthey", canton: "Valais", priority: 3 },
  { slug: "sierre", name: "Sierre", canton: "Valais", priority: 3 },
] as const;

export const SEO_TERMS = [
  "location powerbank", "louer une powerbank", "batterie externe", "location batterie externe",
  "recharge natel", "chargeur natel", "recharge smartphone", "chargeur smartphone",
  "recharge téléphone", "borne de recharge téléphone", "batterie iPhone", "batterie Samsung",
  "power bank", "powerbank bar", "powerbank restaurant", "powerbank hôtel", "powerbank festival",
  "téléphone déchargé", "plus de batterie", "urgence batterie téléphone", "USB-C", "Lightning",
] as const;

export function cityBySlug(slug?: string) {
  return ROMAND_CITIES.find((city) => city.slug === slug);
}

export function setPageSeo(input: {
  title: string;
  description: string;
  path: string;
  keywords?: string[];
  jsonLd?: Record<string, unknown> | Record<string, unknown>[];
}) {
  document.title = input.title;
  const canonical = `${SITE_ORIGIN}${input.path}`;
  const upsert = (selector: string, attr: string, value: string, create: () => HTMLElement) => {
    let element = document.head.querySelector(selector) as HTMLElement | null;
    if (!element) {
      element = create();
      document.head.appendChild(element);
    }
    element.setAttribute(attr, value);
  };

  upsert('meta[name="description"]', "content", input.description, () => {
    const tag = document.createElement("meta"); tag.setAttribute("name", "description"); return tag;
  });
  upsert('meta[name="keywords"]', "content", (input.keywords ?? SEO_TERMS).join(", "), () => {
    const tag = document.createElement("meta"); tag.setAttribute("name", "keywords"); return tag;
  });
  upsert('link[rel="canonical"]', "href", canonical, () => {
    const tag = document.createElement("link"); tag.setAttribute("rel", "canonical"); return tag;
  });
  upsert('meta[property="og:title"]', "content", input.title, () => {
    const tag = document.createElement("meta"); tag.setAttribute("property", "og:title"); return tag;
  });
  upsert('meta[property="og:description"]', "content", input.description, () => {
    const tag = document.createElement("meta"); tag.setAttribute("property", "og:description"); return tag;
  });
  upsert('meta[property="og:url"]', "content", canonical, () => {
    const tag = document.createElement("meta"); tag.setAttribute("property", "og:url"); return tag;
  });

  document.querySelectorAll('script[data-chargeurs-seo="jsonld"]').forEach((node) => node.remove());
  if (input.jsonLd) {
    const script = document.createElement("script");
    script.type = "application/ld+json";
    script.dataset.chargeursSeo = "jsonld";
    script.textContent = JSON.stringify(input.jsonLd);
    document.head.appendChild(script);
  }
}

export function cityJsonLd(city: { slug: string; name: string; canton: string }) {
  return [
    {
      "@context": "https://schema.org",
      "@type": "Service",
      name: `Location de powerbanks à ${city.name}`,
      provider: { "@type": "Organization", name: SITE_NAME, url: SITE_ORIGIN },
      areaServed: { "@type": "City", name: city.name, containedInPlace: { "@type": "AdministrativeArea", name: city.canton } },
      serviceType: "Location de batteries externes pour natels et smartphones",
      offers: {
        "@type": "Offer",
        priceCurrency: "CHF",
        description: "1.90 CHF jusqu'à 30 minutes, 3.90 CHF jusqu'à 2 heures, 5.90 CHF jusqu'à 6 heures et 7.90 CHF jusqu'à 24 heures.",
      },
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: [
        { "@type": "Question", name: `Où louer une powerbank à ${city.name} ?`, acceptedAnswer: { "@type": "Answer", text: `Chargeurs.ch déploie des bornes de location de batteries externes dans les établissements partenaires de ${city.name}. La disponibilité réelle est affichée sur la carte.` } },
        { "@type": "Question", name: "Combien coûte la location ?", acceptedAnswer: { "@type": "Answer", text: "Le tarif est de 1.90 CHF jusqu'à 30 minutes, 3.90 CHF jusqu'à 2 heures, 5.90 CHF jusqu'à 6 heures et 7.90 CHF jusqu'à 24 heures." } },
      ],
    },
  ];
}
