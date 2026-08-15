import { useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ImageOff,
  Minus,
  PackagePlus,
  Plus,
  Search,
  ShoppingCart,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";

type SupplierProduct = {
  id: string;
  supplier_id: string;
  supplier_sku: string | null;
  supplier_variant_key: string;
  supplier_product_name: string;
  catalog_section: string | null;
  source_page?: number | null;
  procurement_mode: string;
  status: string;
  verification_state: string;
  supplier_specifications?: Record<string, unknown> | null;
  notes?: string | null;
};

type Offer = {
  id: string;
  supplier_product_id: string;
  quantity_label: string | null;
  quantity_min?: number | null;
  quantity_max?: number | null;
  configuration_label: string | null;
  unit_cost: string | number | null;
  currency: string;
  verification_state: string;
};

type FreightMode = "ddp" | "express";
type CategoryKey = "all" | "desktop" | "screen" | "floor" | "outdoor" | "powerbank" | "accessory" | "pos";

const IMAGE_KEYS = new Set([
  "BJD001", "BJD003", "PS886", "R-SP-1", "R-SP-2", "R-SP-3",
  "ZBJ-166-1", "ZBJ-166-2", "ZBJ-166-3", "ZBJ-166-4", "ZBJ-166-6", "ZBJ-166",
  "ZBJ-886-1", "ZBJ-886-2", "ZBJ-886-3", "ZBJ-886", "ZBJ-889", "ZBJ-S05",
  "ZBJ-SP-M", "ZBJ-SP-MSP-T", "ZBJ-SP-MSP", "ZBJ-SP-S",
  "ZBJ-SP04-SP-T", "ZBJ-SP04-SP", "ZBJ-SP04",
  "ZBJ-SP08-PS", "ZBJ-SP08-SP-T", "ZBJ-SP08-SP", "ZBJ-SP08",
  "ZBJ-SP12-PS", "ZBJ-SP12-SP-T", "ZBJ-SP12-SP", "ZBJ-SP12",
  "ZBJ-SPL-72", "ZBJ115", "ZBJ601",
]);

const CATEGORY_OPTIONS: Array<{ key: CategoryKey; label: string }> = [
  { key: "all", label: "Tous" },
  { key: "desktop", label: "Bornes compactes" },
  { key: "screen", label: "Avec écran" },
  { key: "floor", label: "Bornes au sol" },
  { key: "outdoor", label: "Extérieur / IP" },
  { key: "powerbank", label: "Powerbanks" },
  { key: "accessory", label: "Modules & supports" },
  { key: "pos", label: "Paiement / POS" },
];

const SLOT_OPTIONS = [0, 4, 6, 8, 12, 24, 32, 48, 72, 96];

const FREIGHT: Record<FreightMode, { label: string; rate: number; fixed: number }> = {
  ddp: { label: "Aérien DDP DG", rate: 8, fixed: 75 },
  express: { label: "Express aérien DG", rate: 12.5, fixed: 95 },
};

function spec(product: SupplierProduct, key: string): string {
  const value = product.supplier_specifications?.[key];
  if (value === null || value === undefined) return "";
  return typeof value === "string" ? value : String(value);
}

function parseFirstNumber(value: string): number | null {
  const match = value.replace(",", ".").match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function slotCount(product: SupplierProduct): number | null {
  return parseFirstNumber(spec(product, "slots"));
}

function grossWeightKg(product: SupplierProduct): number | null {
  const gross = spec(product, "single_gross_weight");
  if (gross && gross !== "/") {
    if (/Main:/i.test(gross) && /Sub:/i.test(gross)) {
      const matches = [...gross.replace(/,/g, ".").matchAll(/(\d+(?:\.\d+)?)\s*kg/gi)].map((m) => Number(m[1])).filter(Number.isFinite);
      return matches.length ? matches.reduce((a, b) => a + b, 0) : null;
    }
    return parseFirstNumber(gross);
  }
  const weight = spec(product, "weight");
  return weight ? parseFirstNumber(weight) : null;
}

function hasTouch(product: SupplierProduct): boolean {
  return /touch/i.test(`${product.supplier_variant_key} ${spec(product, "supplier_notes")} ${spec(product, "functional_characteristics")}`);
}

function screenLabel(product: SupplierProduct): string | null {
  const screen = spec(product, "ads_size_resolution") || spec(product, "screen");
  return screen && screen !== "/" ? screen : null;
}

function isOutdoor(product: SupplierProduct): boolean {
  return /waterproof|outdoor|IP54/i.test(`${product.catalog_section ?? ""} ${spec(product, "material")} ${spec(product, "certification")}`);
}

function productType(product: SupplierProduct): CategoryKey {
  const section = (product.catalog_section ?? "").toLowerCase();
  const name = `${product.supplier_product_name} ${product.supplier_variant_key}`.toLowerCase();
  if (section.includes("shared power bank") || name.includes("power bank")) return "powerbank";
  if (section.includes("pos") || product.procurement_mode === "local_purchase") return "pos";
  if (isOutdoor(product)) return "outdoor";
  if (section.includes("floor-standing")) return "floor";
  if (section.includes("with ads") || screenLabel(product)) return "screen";
  if (section.includes("desktop")) return "desktop";
  return "accessory";
}

function categoryLabel(product: SupplierProduct): string {
  const type = productType(product);
  return CATEGORY_OPTIONS.find((option) => option.key === type)?.label ?? "Matériel";
}

function humanName(product: SupplierProduct): string {
  const slots = slotCount(product);
  const screen = screenLabel(product);
  const touch = hasTouch(product);
  const type = productType(product);
  const sku = product.supplier_sku ?? product.supplier_variant_key;
  if (type === "powerbank") {
    const capacity = spec(product, "capacity");
    const power = /22\.5W/i.test(spec(product, "input_output")) ? " · 22,5 W" : "";
    return `Powerbank ${capacity || "partagée"}${power}`;
  }
  if (["desktop", "screen", "floor", "outdoor"].includes(type)) {
    const form = type === "floor" ? "Borne au sol" : type === "outdoor" ? "Borne extérieure" : "Borne";
    const capacity = slots ? ` ${slots} slots` : "";
    const display = screen ? ` · écran ${screen.split("/")[0]}` : " · sans écran";
    const tactile = touch ? " · tactile" : "";
    return `${form}${capacity}${display}${tactile}`;
  }
  if (/stand/i.test(product.supplier_product_name)) return `Support de borne ${sku}`;
  if (/modular/i.test(product.supplier_product_name)) return `Module de station ${touch ? "tactile " : ""}${screen ? "avec écran" : "sans écran"}`;
  return product.supplier_product_name || sku;
}

function imageKey(product: SupplierProduct): string | null {
  const candidates = [product.supplier_sku, product.supplier_variant_key];
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (IMAGE_KEYS.has(candidate)) return candidate;
    const normalized = candidate
      .replace(/-(?:24|48)-(?:standard|touch-projector)$/i, "")
      .replace(/-(?:standard|touch)$/i, "");
    if (IMAGE_KEYS.has(normalized)) return normalized;
  }
  return null;
}

function productImage(product: SupplierProduct): string | null {
  const key = imageKey(product);
  return key ? `/inventory/bajie/${encodeURIComponent(key)}.webp` : null;
}

function venueRecommendations(product: SupplierProduct): string[] {
  const type = productType(product);
  const slots = slotCount(product) ?? 0;
  if (type === "powerbank") return ["Tous lieux équipés d’une station", "Stock de rotation"];
  if (type === "pos") return ["Borne avec paiement local compatible"];
  if (type === "accessory") return ["Configuration et adaptation de borne"];
  const venues = new Set<string>();
  if (slots <= 4) ["Café", "Petit commerce", "Barber / coiffeur", "Réception"].forEach((v) => venues.add(v));
  else if (slots <= 8) ["Bar", "Restaurant", "Hôtel", "Coworking"].forEach((v) => venues.add(v));
  else if (slots <= 12) ["Grand restaurant", "Hôtel", "Salle de sport", "Événement"].forEach((v) => venues.add(v));
  else ["Centre commercial", "Grand événement", "Festival", "Lieu à fort trafic"].forEach((v) => venues.add(v));
  if (isOutdoor(product)) venues.add("Extérieur");
  return [...venues];
}

function recommendationWhy(product: SupplierProduct): string {
  const slots = slotCount(product);
  const screen = screenLabel(product);
  if (productType(product) === "powerbank") return "Batterie destinée à la location et à la rotation entre stations. La compatibilité physique et protocolaire doit rester validée par modèle.";
  if (productType(product) === "pos") return "Élément de paiement ou support associé. Sa présence dans le catalogue fournisseur ne prouve pas à elle seule sa compatibilité avec l’architecture Stripe de Chargeurs.ch.";
  if (productType(product) === "accessory") return "Accessoire de configuration. Il faut confirmer la combinaison exacte avec le modèle de station retenu avant commande.";
  if ((slots ?? 0) <= 8) return `Format compact adapté aux lieux où l’encombrement compte${screen ? ", avec un écran utile pour guider et afficher du contenu" : ", sans surcoût d’écran"}.`;
  if ((slots ?? 0) <= 12) return "Capacité intermédiaire intéressante pour augmenter la rotation sans passer à une grande borne au sol.";
  return `Grande capacité pensée pour un trafic élevé${screen ? " et une forte visibilité grâce à l’écran" : ""}. L’implantation, l’alimentation et la fixation doivent être préparées.`;
}

function offerMatchesQty(offer: Offer, qty: number): boolean {
  const min = offer.quantity_min ?? null;
  const max = offer.quantity_max ?? null;
  if (min !== null && qty < min) return false;
  if (max !== null && qty > max) return false;
  return true;
}

function chosenOffer(offers: Offer[], productId: string, qty: number): Offer | null {
  const candidates = offers
    .filter((offer) => offer.supplier_product_id === productId && offer.unit_cost !== null)
    .filter((offer) => offerMatchesQty(offer, qty))
    .sort((a, b) => (b.quantity_min ?? 0) - (a.quantity_min ?? 0));
  if (candidates.length) return candidates[0];
  return offers.find((offer) => offer.supplier_product_id === productId && offer.unit_cost !== null) ?? null;
}

function formatMoney(value: number, currency: string) {
  return `${value.toLocaleString("fr-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

function ProductImage({ product, className = "" }: { product: SupplierProduct; className?: string }) {
  const src = productImage(product);
  if (!src) {
    return <div className={`grid place-items-center bg-muted/50 text-muted-foreground ${className}`}><div className="text-center"><ImageOff className="mx-auto h-7 w-7" /><p className="mt-2 text-xs">Image fournisseur non disponible</p></div></div>;
  }
  return <img src={src} alt={`${humanName(product)} — ${product.supplier_sku ?? product.supplier_variant_key}`} className={`bg-white object-contain ${className}`} loading="lazy" />;
}

export default function BajieCatalog({ products, offers }: { products: SupplierProduct[]; offers: Offer[] }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<CategoryKey>("all");
  const [slots, setSlots] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [quoteItems, setQuoteItems] = useState<Record<string, number>>({});
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [freightMode, setFreightMode] = useState<FreightMode>("ddp");
  const [fullscreenImage, setFullscreenImage] = useState(false);

  const filtered = useMemo(() => products.filter((product) => {
    const haystack = `${humanName(product)} ${product.supplier_sku ?? ""} ${product.supplier_variant_key} ${product.catalog_section ?? ""}`.toLowerCase();
    if (query.trim() && !haystack.includes(query.trim().toLowerCase())) return false;
    const type = productType(product);
    if (category !== "all") {
      if (category === "screen") {
        if (!screenLabel(product)) return false;
      } else if (type !== category) return false;
    }
    if (slots && slotCount(product) !== slots) return false;
    return true;
  }), [products, query, category, slots]);

  const selected = products.find((product) => product.id === selectedId) ?? null;
  const quoteRows = Object.entries(quoteItems)
    .filter(([, qty]) => qty > 0)
    .map(([id, qty]) => ({ product: products.find((product) => product.id === id), qty }))
    .filter((row): row is { product: SupplierProduct; qty: number } => Boolean(row.product));

  const freight = FREIGHT[freightMode];
  let knownWeight = 0;
  let unknownWeightLines = 0;
  const hardwareByCurrency = new Map<string, number>();
  for (const row of quoteRows) {
    const weight = grossWeightKg(row.product);
    if (weight === null) unknownWeightLines += 1;
    else knownWeight += weight * row.qty;
    const offer = chosenOffer(offers, row.product.id, row.qty);
    if (offer?.unit_cost !== null && offer?.unit_cost !== undefined) {
      const amount = Number(offer.unit_cost);
      if (Number.isFinite(amount)) hardwareByCurrency.set(offer.currency, (hardwareByCurrency.get(offer.currency) ?? 0) + amount * row.qty);
    }
  }
  const variableFreight = knownWeight * freight.rate;
  const fixedFreight = quoteRows.length ? freight.fixed : 0;

  const adjustQuote = (productId: string, delta: number) => {
    setQuoteItems((current) => {
      const next = Math.max(0, (current[productId] ?? 0) + delta);
      return { ...current, [productId]: next };
    });
  };

  return (
    <div className="space-y-5 overflow-x-hidden">
      <section className="rounded-2xl border border-border bg-card/70 p-4 sm:p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Catalogue fournisseur</p>
            <h2 className="mt-1 text-2xl font-bold tracking-tight">Choisir le matériel par produit, pas par code</h2>
            <p className="mt-2 max-w-3xl text-sm text-muted-foreground">Photos issues du document fournisseur quand elles existent. Prix, caractéristiques et images sont SUPPLIER_DECLARED jusqu’à validation physique ou documentaire.</p>
          </div>
          <Button onClick={() => setQuoteOpen(true)} className="shrink-0"><ShoppingCart className="mr-2 h-4 w-4" />Pré-devis ({quoteRows.length})</Button>
        </div>

        <div className="mt-5 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
          <label className="relative block min-w-0">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Rechercher une borne, un SKU, un nombre de slots…" className="h-11 w-full rounded-xl border border-border bg-background pl-10 pr-4 text-sm outline-none focus:border-primary" />
          </label>
          <div className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-sm text-muted-foreground"><SlidersHorizontal className="h-4 w-4" />{filtered.length} produit(s)</div>
        </div>

        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {CATEGORY_OPTIONS.map((option) => <button key={option.key} onClick={() => setCategory(option.key)} className={`shrink-0 rounded-full border px-3 py-2 text-xs font-semibold ${category === option.key ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background"}`}>{option.label}</button>)}
        </div>
        <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
          {SLOT_OPTIONS.map((value) => <button key={value} onClick={() => setSlots(value)} className={`shrink-0 rounded-full border px-3 py-1.5 text-xs ${slots === value ? "border-primary bg-primary/10 font-semibold text-primary" : "border-border bg-background text-muted-foreground"}`}>{value === 0 ? "Tous les slots" : `${value} slots`}</button>)}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {filtered.map((product) => {
          const productOffers = offers.filter((offer) => offer.supplier_product_id === product.id && offer.unit_cost !== null);
          const initial = productOffers[0] ?? null;
          const weight = grossWeightKg(product);
          const variable = weight === null ? null : weight * freight.rate;
          return (
            <article key={product.id} className="min-w-0 overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
              <button className="block w-full" onClick={() => { setSelectedId(product.id); setFullscreenImage(false); }}>
                <ProductImage product={product} className="h-52 w-full border-b border-border" />
              </button>
              <div className="min-w-0 p-4">
                <div className="flex min-w-0 items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wide text-primary">{categoryLabel(product)}</p>
                    <button className="mt-1 block max-w-full text-left" onClick={() => setSelectedId(product.id)}><h3 className="break-words text-base font-bold leading-snug">{humanName(product)}</h3></button>
                    <p className="mt-1 break-all text-xs text-muted-foreground">{product.supplier_sku ?? product.supplier_variant_key}</p>
                  </div>
                  <span className="shrink-0 rounded-full border border-blue-500/30 bg-blue-500/10 px-2 py-1 text-[10px] font-semibold text-blue-700 dark:text-blue-300">{product.verification_state.toUpperCase()}</span>
                </div>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  {slotCount(product) ? <span className="rounded-full bg-muted px-2 py-1 text-xs font-semibold">{slotCount(product)} slots</span> : null}
                  {screenLabel(product) ? <span className="rounded-full bg-muted px-2 py-1 text-xs">Écran</span> : null}
                  {hasTouch(product) ? <span className="rounded-full bg-muted px-2 py-1 text-xs">Tactile</span> : null}
                  {isOutdoor(product) ? <span className="rounded-full bg-muted px-2 py-1 text-xs">Outdoor</span> : null}
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2 rounded-xl bg-muted/35 p-3 text-xs">
                  <div><p className="text-muted-foreground">Prix fournisseur</p><strong className="mt-1 block">{initial ? `${Number(initial.unit_cost).toFixed(2)} ${initial.currency}` : "À confirmer"}</strong></div>
                  <div><p className="text-muted-foreground">Poids expédition</p><strong className="mt-1 block">{weight !== null ? `${weight.toFixed(2)} kg` : "Inconnu"}</strong></div>
                  <div className="col-span-2"><p className="text-muted-foreground">Fret variable indicatif · {freight.label}</p><strong className="mt-1 block">{variable !== null ? `${variable.toFixed(2)} CHF / unité` : "Non calculable"}</strong><p className="mt-1 text-[10px] text-muted-foreground">Hors frais fixe de dossier, appliqué une seule fois par expédition.</p></div>
                </div>

                <div className="mt-4 flex gap-2">
                  <Button variant="outline" className="min-w-0 flex-1" onClick={() => setSelectedId(product.id)}>Voir la fiche</Button>
                  <Button size="icon" aria-label="Ajouter au pré-devis" onClick={() => adjustQuote(product.id, 1)}><PackagePlus className="h-4 w-4" /></Button>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {!filtered.length ? <div className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">Aucun produit ne correspond à ces filtres.</div> : null}

      {selected ? (
        <div className="fixed inset-0 z-[90] bg-background/90 backdrop-blur-sm" role="dialog" aria-modal="true">
          <div className="mx-auto flex h-full max-w-5xl flex-col bg-background shadow-2xl sm:my-4 sm:h-[calc(100%-2rem)] sm:rounded-2xl sm:border sm:border-border">
            <div className="flex items-center justify-between border-b border-border p-3 sm:p-4">
              <button onClick={() => setSelectedId(null)} className="flex items-center gap-2 text-sm font-semibold"><ChevronLeft className="h-4 w-4" />Catalogue</button>
              <Button size="icon" variant="ghost" onClick={() => setSelectedId(null)}><X className="h-5 w-5" /></Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
              <div className="grid gap-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,.95fr)]">
                <button onClick={() => productImage(selected) && setFullscreenImage(true)} className="min-w-0 overflow-hidden rounded-2xl border border-border bg-white">
                  <ProductImage product={selected} className="h-[330px] w-full sm:h-[480px]" />
                  {productImage(selected) ? <p className="border-t border-border bg-background px-3 py-2 text-center text-xs text-muted-foreground">Toucher l’image pour l’agrandir</p> : null}
                </button>
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">{categoryLabel(selected)}</p>
                  <h2 className="mt-2 break-words text-2xl font-bold">{humanName(selected)}</h2>
                  <p className="mt-1 break-all text-sm text-muted-foreground">Réf. {selected.supplier_sku ?? selected.supplier_variant_key}</p>
                  <div className="mt-3 flex flex-wrap gap-2"><span className="rounded-full border border-blue-500/30 bg-blue-500/10 px-2.5 py-1 text-xs font-semibold text-blue-700 dark:text-blue-300">{selected.verification_state.toUpperCase()}</span>{selected.source_page ? <span className="rounded-full border border-border px-2.5 py-1 text-xs">Source fournisseur · p. {selected.source_page}</span> : null}</div>

                  <div className="mt-5 rounded-2xl border border-border bg-card p-4">
                    <h3 className="font-semibold">Pourquoi ce modèle ?</h3>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{recommendationWhy(selected)}</p>
                    <p className="mt-3 text-[11px] font-semibold uppercase text-amber-600">Recommandation Chargeurs.ch · INFERRED</p>
                  </div>

                  <div className="mt-4">
                    <h3 className="text-sm font-semibold">Idéal pour</h3>
                    <div className="mt-2 flex flex-wrap gap-2">{venueRecommendations(selected).map((venue) => <span key={venue} className="rounded-full bg-muted px-2.5 py-1 text-xs">{venue}</span>)}</div>
                  </div>

                  <div className="mt-5 flex gap-2">
                    <Button className="flex-1" onClick={() => adjustQuote(selected.id, 1)}><Plus className="mr-2 h-4 w-4" />Ajouter au pré-devis</Button>
                    <Button variant="outline" onClick={() => setQuoteOpen(true)}><ShoppingCart className="h-4 w-4" /></Button>
                  </div>
                </div>
              </div>

              <div className="mt-7 grid gap-5 lg:grid-cols-2">
                <section className="rounded-2xl border border-border bg-card/70 p-4 sm:p-5">
                  <h3 className="font-semibold">Caractéristiques fournisseur</h3>
                  <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {[
                      ["Slots", spec(selected, "slots")], ["Écran", screenLabel(selected) ?? "Sans écran déclaré"],
                      ["Tactile", hasTouch(selected) ? "Oui, déclaré" : "Non déclaré"], ["Réseau", spec(selected, "network_support")],
                      ["Puissance max", spec(selected, "max_power")], ["Alimentation", spec(selected, "power_input")],
                      ["Dimensions colis", spec(selected, "package_size")], ["Poids brut", spec(selected, "single_gross_weight") || spec(selected, "weight")],
                      ["Couleurs", spec(selected, "station_colors") || spec(selected, "colors")], ["Certifications", spec(selected, "certification")],
                    ].filter(([, value]) => Boolean(value)).map(([label, value]) => <div key={label} className="min-w-0 rounded-xl bg-muted/35 p-3"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 break-words text-sm font-semibold">{value}</dd></div>)}
                  </dl>
                </section>

                <section className="rounded-2xl border border-border bg-card/70 p-4 sm:p-5">
                  <h3 className="font-semibold">Prix & logistique</h3>
                  <div className="mt-4 space-y-2">{offers.filter((offer) => offer.supplier_product_id === selected.id && offer.unit_cost !== null).map((offer) => <div key={offer.id} className="flex items-start justify-between gap-3 rounded-xl bg-muted/35 p-3 text-sm"><div className="min-w-0"><p className="break-words text-xs text-muted-foreground">{offer.quantity_label || offer.configuration_label || "Offre fournisseur"}</p><p className="mt-1 text-[10px] text-muted-foreground">{offer.verification_state}</p></div><strong className="shrink-0">{Number(offer.unit_cost).toFixed(2)} {offer.currency}</strong></div>)}</div>
                  {(() => { const weight = grossWeightKg(selected); return <div className="mt-4 rounded-xl border border-border p-3"><p className="text-xs text-muted-foreground">Transport variable indicatif</p><strong className="mt-1 block">{weight !== null ? `${(weight * freight.rate).toFixed(2)} CHF / unité` : "Poids insuffisant pour calculer"}</strong><p className="mt-1 text-[11px] text-muted-foreground">Hypothèse {freight.label}: {freight.rate.toFixed(2)} CHF/kg. Le frais fixe de {freight.fixed.toFixed(2)} CHF n’est pas ajouté ici : il ne s’applique qu’une fois par expédition.</p></div>; })()}
                </section>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {fullscreenImage && selected && productImage(selected) ? (
        <div className="fixed inset-0 z-[110] grid place-items-center bg-black/90 p-3" onClick={() => setFullscreenImage(false)}>
          <button className="absolute right-4 top-4 rounded-full bg-white/10 p-3 text-white" onClick={() => setFullscreenImage(false)}><X className="h-6 w-6" /></button>
          <img src={productImage(selected)!} alt={humanName(selected)} className="max-h-[92vh] max-w-[96vw] object-contain" />
        </div>
      ) : null}

      {quoteOpen ? (
        <div className="fixed inset-0 z-[100] bg-background/90 backdrop-blur-sm" role="dialog" aria-modal="true">
          <div className="ml-auto flex h-full w-full max-w-2xl flex-col border-l border-border bg-background shadow-2xl">
            <div className="flex items-center justify-between border-b border-border p-4 sm:p-5"><div><p className="text-xs font-semibold uppercase tracking-wide text-primary">Projet non engageant</p><h2 className="text-xl font-bold">Pré-bon de commande</h2></div><Button size="icon" variant="ghost" onClick={() => setQuoteOpen(false)}><X className="h-5 w-5" /></Button></div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
              {!quoteRows.length ? <div className="rounded-2xl border border-dashed border-border p-10 text-center"><ShoppingCart className="mx-auto h-8 w-8 text-muted-foreground" /><p className="mt-3 text-sm text-muted-foreground">Ajoute des produits depuis le catalogue pour préparer un scénario de commande.</p></div> : <div className="space-y-3">{quoteRows.map(({ product, qty }) => {
                const offer = chosenOffer(offers, product.id, qty);
                const weight = grossWeightKg(product);
                return <div key={product.id} className="grid grid-cols-[72px_minmax(0,1fr)] gap-3 rounded-2xl border border-border p-3"><ProductImage product={product} className="h-[72px] w-[72px] rounded-xl border border-border" /><div className="min-w-0"><p className="break-words text-sm font-semibold">{humanName(product)}</p><p className="mt-0.5 break-all text-[11px] text-muted-foreground">{product.supplier_sku ?? product.supplier_variant_key}</p><div className="mt-2 flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-1"><Button size="icon" variant="outline" className="h-8 w-8" onClick={() => adjustQuote(product.id, -1)}><Minus className="h-3.5 w-3.5" /></Button><span className="min-w-8 text-center text-sm font-bold">{qty}</span><Button size="icon" variant="outline" className="h-8 w-8" onClick={() => adjustQuote(product.id, 1)}><Plus className="h-3.5 w-3.5" /></Button></div><div className="text-right text-xs"><strong>{offer ? `${Number(offer.unit_cost).toFixed(2)} ${offer.currency} / u.` : "Prix à confirmer"}</strong><p className="text-muted-foreground">{weight !== null ? `${(weight * qty).toFixed(2)} kg estimés` : "poids incomplet"}</p></div></div></div></div>;
              })}</div>}

              <section className="mt-6 rounded-2xl border border-border bg-card p-4">
                <h3 className="font-semibold">Mode de transport estimatif</h3>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">{(Object.keys(FREIGHT) as FreightMode[]).map((mode) => <button key={mode} onClick={() => setFreightMode(mode)} className={`rounded-xl border p-3 text-left text-sm ${freightMode === mode ? "border-primary bg-primary/10" : "border-border"}`}><strong>{FREIGHT[mode].label}</strong><p className="mt-1 text-xs text-muted-foreground">{FREIGHT[mode].rate.toFixed(2)} CHF/kg + {FREIGHT[mode].fixed.toFixed(2)} CHF / expédition</p></button>)}</div>
              </section>

              <section className="mt-4 rounded-2xl border border-border bg-card p-4">
                <h3 className="font-semibold">Synthèse indicative</h3>
                <div className="mt-3 space-y-2 text-sm">{[...hardwareByCurrency.entries()].map(([currency, total]) => <div key={currency} className="flex justify-between gap-3"><span className="text-muted-foreground">Matériel fournisseur</span><strong>{formatMoney(total, currency)}</strong></div>)}<div className="flex justify-between gap-3"><span className="text-muted-foreground">Poids connu</span><strong>{knownWeight.toFixed(2)} kg</strong></div><div className="flex justify-between gap-3"><span className="text-muted-foreground">Fret variable</span><strong>{variableFreight.toFixed(2)} CHF</strong></div><div className="flex justify-between gap-3"><span className="text-muted-foreground">Frais fixe expédition × 1</span><strong>{fixedFreight.toFixed(2)} CHF</strong></div><div className="border-t border-border pt-2"><div className="flex justify-between gap-3"><span className="font-semibold">Transport estimé</span><strong>{(variableFreight + fixedFreight).toFixed(2)} CHF</strong></div></div>{unknownWeightLines ? <p className="rounded-lg bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300">{unknownWeightLines} ligne(s) ont un poids inexploitable : le fret reste incomplet.</p> : null}</div>
              </section>

              <div className="mt-4 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm"><strong>PRÉ-COMMANDE — AUCUN ENGAGEMENT FOURNISSEUR</strong><p className="mt-1 text-xs text-muted-foreground">Cette vue prépare et contrôle un scénario. Elle n’envoie aucune commande, n’accepte aucune offre et ne déclenche aucun paiement.</p></div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
