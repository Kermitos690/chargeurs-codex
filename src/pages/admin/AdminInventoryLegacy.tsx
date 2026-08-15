import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BatteryCharging, Boxes, Building2, ClipboardList, Factory, FileText, Loader2,
  Mail, PackageCheck, PackageSearch, Phone, RefreshCw, Save, Server, ShieldAlert,
  Truck, Wrench,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

type Summary = {
  assets: number;
  stations: number;
  powerbanks: number;
  quarantines: number;
  suspectedDefects: number;
  suppliers: number;
  supplierProducts: number;
  offers: number;
  openInquiries: number;
  sparePartsPending: number;
  purchaseOrders: number;
  receipts: number;
  rmaOpen: number;
};

type Asset = {
  id: string;
  asset_code: string;
  asset_type: string;
  source_external_id: string | null;
  manufacturer_serial: string | null;
  ownership_state: string;
  lifecycle_status: string;
  current_location_id: string | null;
  verification_state: string;
  last_observed_at: string | null;
};

type Location = { id: string; code: string; name: string; location_type: string };
type RuntimeBattery = { battery_id: string; station_id: string | null; slot_num: number | null; status: string; power_level: number | null; qualification_status: string | null; quarantine_reason: string | null; updated_at: string };
type RuntimeSlot = { station_id: string; slot_num: number; status: string; battery_id: string | null; updated_at: string };
type Supplier = { id: string; legal_name: string; trade_name: string | null; country_code: string | null; website: string | null; status: string; verification_state: string; notes: string | null; updated_at: string };
type Contact = { id: string; supplier_id: string; contact_role: string; name: string | null; job_title: string | null; email: string | null; phone: string | null; messaging_handle: string | null; verification_state: string; notes: string | null };
type SourceDocument = { id: string; supplier_id: string; source_type: string; title: string; verification_state: string; ingested_at: string };
type Capability = { id: string; supplier_id: string; capability_code: string; capability_name: string; value: unknown; verification_state: string };
type Venue = { id: string; supplier_id: string; venue_type: string; supplier_claim: string | null; verification_state: string };
type SupplierProduct = { id: string; supplier_id: string; supplier_sku: string | null; supplier_variant_key: string; supplier_product_name: string; catalog_section: string | null; procurement_mode: string; status: string; verification_state: string };
type Offer = { id: string; supplier_product_id: string; quantity_label: string | null; configuration_label: string | null; unit_cost: string | number | null; currency: string; verification_state: string };
type Inquiry = { id: string; supplier_id: string; subject: string; sent_to: string | null; channel: string; status: string; sent_at: string | null; answered_at: string | null; request_summary: string | null };
type InquiryItem = { id: string; inquiry_id: string; requirement_code: string; requirement_name: string; priority: string; status: string; verification_state: string };
type SparePartRequest = { id: string; supplier_id: string; component_category: string; requested_part_name: string; request_status: string; supplier_spare_sku: string | null; supplier_part_name: string | null; unit_cost: string | number | null; currency: string | null; compatibility_state: string; verification_state: string };
type PurchaseOrder = { id: string; supplier_id: string; po_number: string; status: string; currency: string; landed_cost_status: string; ordered_at: string | null; expected_at: string | null; notes: string | null };
type RmaCase = { id: string; asset_id: string; status: string; warranty_state: string; supplier_id: string | null; supplier_product_id: string | null; opened_at: string; submitted_at: string | null; notes: string | null };
type Quarantine = { id: string; asset_id: string; source_reason_code: string | null; status: string; verification_state: string; opened_at: string; released_at: string | null };
type Defect = { id: string; asset_id: string; defect_category: string; severity: string; diagnostic_status: string; source_reason_code: string | null; verification_state: string; diagnosis: string | null };

type Snapshot = {
  ok?: boolean;
  error?: string;
  generatedAt?: string;
  summary?: Summary;
  assets?: Asset[];
  locations?: Location[];
  runtimeBatteries?: RuntimeBattery[];
  runtimeSlots?: RuntimeSlot[];
  suppliers?: Supplier[];
  contacts?: Contact[];
  sourceDocuments?: SourceDocument[];
  capabilities?: Capability[];
  targetVenues?: Venue[];
  supplierProducts?: SupplierProduct[];
  offers?: Offer[];
  inquiries?: Inquiry[];
  inquiryItems?: InquiryItem[];
  sparePartRequests?: SparePartRequest[];
  purchaseOrders?: PurchaseOrder[];
  receipts?: Array<Record<string, unknown>>;
  rmaCases?: RmaCase[];
  quarantineCases?: Quarantine[];
  defectCases?: Defect[];
};

type Tab = "overview" | "assets" | "suppliers" | "catalog" | "operations";

const EMPTY_SUMMARY: Summary = {
  assets: 0, stations: 0, powerbanks: 0, quarantines: 0, suspectedDefects: 0,
  suppliers: 0, supplierProducts: 0, offers: 0, openInquiries: 0, sparePartsPending: 0,
  purchaseOrders: 0, receipts: 0, rmaOpen: 0,
};

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("fr-CH", { dateStyle: "short", timeStyle: "short" });
}

function money(value: string | number | null | undefined, currency?: string | null) {
  if (value === null || value === undefined || value === "") return "—";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  return `${amount.toFixed(2)} ${currency ?? ""}`.trim();
}

function Badge({ children, tone = "default" }: { children: React.ReactNode; tone?: "default" | "good" | "warn" | "bad" | "info" }) {
  const tones = {
    default: "border-border bg-muted/40 text-muted-foreground",
    good: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    warn: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    bad: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300",
    info: "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  } as const;
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${tones[tone]}`}>{children}</span>;
}

function statusTone(value: string): "default" | "good" | "warn" | "bad" | "info" {
  if (["active", "available", "verified", "received", "answered", "resolved", "closed"].includes(value)) return "good";
  if (["quarantined", "suspected", "eligibility_unknown", "unknown", "draft", "sent", "pending"].includes(value)) return "warn";
  if (["defective", "blocked", "irreparable", "failed"].includes(value)) return "bad";
  if (["observed", "supplier_declared", "in_station", "deployed"].includes(value)) return "info";
  return "default";
}

function StatCard({ icon: Icon, label, value, hint }: { icon: typeof Boxes; label: string; value: number; hint: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card/70 p-4 shadow-sm backdrop-blur">
      <div className="mb-3 flex items-center justify-between"><Icon className="h-5 w-5 text-primary" /><span className="text-2xl font-bold">{value}</span></div>
      <p className="font-semibold">{label}</p><p className="mt-1 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

export default function AdminInventory() {
  const [tab, setTab] = useState<Tab>("overview");
  const [data, setData] = useState<Snapshot>({});
  const [loading, setLoading] = useState(true);
  const [reconciling, setReconciling] = useState(false);
  const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(null);
  const [supplierStatus, setSupplierStatus] = useState("active");
  const [supplierNotes, setSupplierNotes] = useState("");
  const [savingSupplier, setSavingSupplier] = useState(false);

  const invoke = useCallback(async (body: Record<string, unknown>) => {
    const { data: response, error } = await supabase.functions.invoke<Snapshot>("inventory-admin", { body });
    if (error || !response?.ok) throw new Error(response?.error ?? error?.message ?? "INVENTORY_ADMIN_FAILED");
    return response;
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const snapshot = await invoke({ action: "snapshot" });
      setData(snapshot);
      setSelectedSupplierId((current) => current && snapshot.suppliers?.some((supplier) => supplier.id === current)
        ? current
        : snapshot.suppliers?.[0]?.id ?? null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Impossible de charger l’inventaire.");
    } finally {
      setLoading(false);
    }
  }, [invoke]);

  useEffect(() => { void load(); }, [load]);

  const summary = data.summary ?? EMPTY_SUMMARY;
  const assets = data.assets ?? [];
  const locations = data.locations ?? [];
  const runtimeBatteries = data.runtimeBatteries ?? [];
  const suppliers = data.suppliers ?? [];
  const products = data.supplierProducts ?? [];
  const offers = data.offers ?? [];
  const contacts = data.contacts ?? [];
  const selectedSupplier = suppliers.find((supplier) => supplier.id === selectedSupplierId) ?? null;

  useEffect(() => {
    if (!selectedSupplier) return;
    setSupplierStatus(selectedSupplier.status);
    setSupplierNotes(selectedSupplier.notes ?? "");
  }, [selectedSupplier]);

  const locationById = useMemo(() => new Map(locations.map((location) => [location.id, location])), [locations]);
  const runtimeBatteryById = useMemo(() => new Map(runtimeBatteries.map((battery) => [battery.battery_id, battery])), [runtimeBatteries]);
  const assetById = useMemo(() => new Map(assets.map((asset) => [asset.id, asset])), [assets]);

  const divergences = useMemo(() => assets.filter((asset) => {
    if (asset.asset_type !== "powerbank" || !asset.source_external_id) return false;
    const runtime = runtimeBatteryById.get(asset.source_external_id);
    const location = asset.current_location_id ? locationById.get(asset.current_location_id) : null;
    if (!runtime || !location) return false;
    if (runtime.status === "out_of_station" && location.code.startsWith("SLOT:")) return true;
    if (runtime.station_id && runtime.slot_num && location.code.startsWith("SLOT:")) {
      return location.code !== `SLOT:${runtime.station_id}:${runtime.slot_num}`;
    }
    return false;
  }), [assets, locationById, runtimeBatteryById]);

  const reconcile = async () => {
    setReconciling(true);
    try {
      await invoke({ action: "reconcile_runtime" });
      await load();
      toast.success("Réconciliation Inventory terminée à partir du runtime.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Réconciliation impossible.");
    } finally {
      setReconciling(false);
    }
  };

  const saveSupplier = async () => {
    if (!selectedSupplier) return;
    setSavingSupplier(true);
    try {
      await invoke({ action: "update_supplier", supplierId: selectedSupplier.id, status: supplierStatus, notes: supplierNotes });
      await load();
      toast.success("Fiche fournisseur mise à jour.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Mise à jour impossible.");
    } finally {
      setSavingSupplier(false);
    }
  };

  const tabs: Array<{ id: Tab; label: string; icon: typeof Boxes }> = [
    { id: "overview", label: "Vue d’ensemble", icon: Boxes },
    { id: "assets", label: "Matériel", icon: BatteryCharging },
    { id: "suppliers", label: "Fournisseurs", icon: Factory },
    { id: "catalog", label: "Catalogue", icon: PackageSearch },
    { id: "operations", label: "Achats · RMA", icon: Truck },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2"><Boxes className="h-6 w-6 text-primary" /><Badge tone="info">SUPER ADMIN</Badge></div>
          <h1 className="text-3xl font-bold tracking-tight">Inventory & Supply Chain</h1>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">Source de vérité opérationnelle pour le matériel, les fournisseurs, le catalogue, les quarantaines, les achats et les RMA. Inventory observe le runtime mais ne commande jamais le hardware.</p>
          <p className="mt-2 text-xs text-muted-foreground">Snapshot : {formatDate(data.generatedAt)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />Actualiser</Button>
          <Button onClick={() => void reconcile()} disabled={reconciling}><RefreshCw className={`mr-2 h-4 w-4 ${reconciling ? "animate-spin" : ""}`} />Réconcilier le terrain</Button>
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setTab(id)} className={`flex shrink-0 items-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold transition ${tab === id ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card/60 hover:bg-muted"}`}>
            <Icon className="h-4 w-4" />{label}
          </button>
        ))}
      </div>

      {loading && !data.summary ? <div className="grid min-h-[320px] place-items-center"><Loader2 className="h-9 w-9 animate-spin text-primary" /></div> : null}

      {tab === "overview" && (
        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard icon={Boxes} label="Actifs observés" value={summary.assets} hint={`${summary.stations} bornes · ${summary.powerbanks} powerbanks`} />
            <StatCard icon={Factory} label="Fournisseurs" value={summary.suppliers} hint={`${summary.supplierProducts} références · ${summary.offers} offres`} />
            <StatCard icon={ShieldAlert} label="Quarantaines" value={summary.quarantines} hint={`${summary.suspectedDefects} défaut(s) seulement suspecté(s)`} />
            <StatCard icon={Truck} label="Supply Chain" value={summary.purchaseOrders} hint={`${summary.receipts} réception(s) · ${summary.rmaOpen} RMA ouvert(s)`} />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <section className="rounded-2xl border border-border bg-card/70 p-5">
              <div className="mb-4 flex items-center justify-between"><div><h2 className="font-semibold">État terrain</h2><p className="text-xs text-muted-foreground">Comparaison runtime ↔ Inventory</p></div><Badge tone={divergences.length ? "warn" : "good"}>{divergences.length} divergence(s)</Badge></div>
              {divergences.length === 0 ? <p className="rounded-xl bg-muted/40 p-4 text-sm">Aucune divergence de localisation détectée dans le snapshot actuel.</p> : (
                <div className="space-y-2">{divergences.map((asset) => {
                  const runtime = asset.source_external_id ? runtimeBatteryById.get(asset.source_external_id) : null;
                  const location = asset.current_location_id ? locationById.get(asset.current_location_id) : null;
                  return <div key={asset.id} className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3"><div className="flex items-center justify-between gap-3"><strong>{asset.asset_code}</strong><Badge tone="warn">À réconcilier</Badge></div><p className="mt-1 text-xs text-muted-foreground">Inventory : {location?.code ?? "UNKNOWN"} · Runtime : {runtime?.status ?? "UNKNOWN"}{runtime?.station_id ? ` · ${runtime.station_id}/${runtime.slot_num}` : ""}</p></div>;
                })}</div>
              )}
            </section>

            <section className="rounded-2xl border border-border bg-card/70 p-5">
              <div className="mb-4 flex items-center justify-between"><div><h2 className="font-semibold">Informations fournisseur attendues</h2><p className="text-xs text-muted-foreground">Aucune donnée n’est promue sans réponse explicite.</p></div><Badge tone="info">{summary.openInquiries} demande(s)</Badge></div>
              <div className="space-y-2">{(data.inquiries ?? []).slice(0, 4).map((inquiry) => (
                <div key={inquiry.id} className="rounded-xl border border-border p-3"><div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-sm">{inquiry.subject}</strong><Badge tone={statusTone(inquiry.status)}>{inquiry.status}</Badge></div><p className="mt-1 text-xs text-muted-foreground">{inquiry.sent_to ?? "destinataire inconnu"} · {formatDate(inquiry.sent_at)}</p></div>
              ))}{!(data.inquiries ?? []).length && <p className="text-sm text-muted-foreground">Aucune demande fournisseur enregistrée.</p>}</div>
            </section>
          </div>
        </div>
      )}

      {tab === "assets" && (
        <section className="overflow-hidden rounded-2xl border border-border bg-card/70">
          <div className="border-b border-border p-5"><h2 className="font-semibold">Matériel sérialisé observé</h2><p className="text-xs text-muted-foreground">Ownership et modèle fournisseur restent UNKNOWN tant qu’ils ne sont pas prouvés.</p></div>
          <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-sm"><thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground"><tr><th className="p-3">Actif</th><th className="p-3">Type</th><th className="p-3">État</th><th className="p-3">Localisation Inventory</th><th className="p-3">Runtime</th><th className="p-3">Batterie</th><th className="p-3">Preuve</th></tr></thead><tbody>
            {assets.map((asset) => {
              const location = asset.current_location_id ? locationById.get(asset.current_location_id) : null;
              const runtime = asset.source_external_id ? runtimeBatteryById.get(asset.source_external_id) : null;
              return <tr key={asset.id} className="border-t border-border/70 align-top"><td className="p-3 font-semibold">{asset.asset_code}<div className="text-xs font-normal text-muted-foreground">{asset.source_external_id ?? "—"}</div></td><td className="p-3"><Badge>{asset.asset_type}</Badge></td><td className="p-3"><Badge tone={statusTone(asset.lifecycle_status)}>{asset.lifecycle_status}</Badge><div className="mt-1 text-xs text-muted-foreground">propriété : {asset.ownership_state}</div></td><td className="p-3">{location?.code ?? "UNLOCATED"}</td><td className="p-3">{runtime ? <><Badge tone={statusTone(runtime.status)}>{runtime.status}</Badge><div className="mt-1 text-xs text-muted-foreground">{runtime.station_id ? `${runtime.station_id} / slot ${runtime.slot_num}` : "hors station"}</div></> : "—"}</td><td className="p-3">{runtime ? <><strong>{runtime.power_level ?? "?"}%</strong><div className="text-xs text-muted-foreground">{runtime.qualification_status ?? "—"}</div></> : "—"}</td><td className="p-3"><Badge tone={statusTone(asset.verification_state)}>{asset.verification_state}</Badge><div className="mt-1 text-xs text-muted-foreground">{formatDate(asset.last_observed_at)}</div></td></tr>;
            })}
          </tbody></table></div>
        </section>
      )}

      {tab === "suppliers" && (
        <div className="grid gap-4 xl:grid-cols-[320px_1fr]">
          <aside className="rounded-2xl border border-border bg-card/70 p-3">
            <p className="px-2 pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Fournisseurs</p>
            <div className="space-y-2">{suppliers.map((supplier) => (
              <button key={supplier.id} onClick={() => setSelectedSupplierId(supplier.id)} className={`w-full rounded-xl border p-3 text-left transition ${selectedSupplierId === supplier.id ? "border-primary bg-primary/10" : "border-border hover:bg-muted/50"}`}>
                <div className="flex items-center justify-between gap-2"><strong>{supplier.trade_name ?? supplier.legal_name}</strong><Badge tone={statusTone(supplier.status)}>{supplier.status}</Badge></div><p className="mt-1 truncate text-xs text-muted-foreground">{supplier.legal_name}</p>
              </button>
            ))}</div>
          </aside>

          {selectedSupplier ? <div className="space-y-4">
            <section className="rounded-2xl border border-border bg-card/70 p-5">
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between"><div><div className="flex items-center gap-2"><Building2 className="h-5 w-5 text-primary" /><Badge tone={statusTone(selectedSupplier.verification_state)}>{selectedSupplier.verification_state}</Badge></div><h2 className="mt-2 text-xl font-bold">{selectedSupplier.trade_name ?? selectedSupplier.legal_name}</h2><p className="text-sm text-muted-foreground">{selectedSupplier.legal_name} · {selectedSupplier.country_code ?? "pays inconnu"}</p>{selectedSupplier.website && <p className="mt-1 text-xs text-muted-foreground">{selectedSupplier.website}</p>}</div><div className="flex items-center gap-2"><select value={supplierStatus} onChange={(e) => setSupplierStatus(e.target.value)} className="rounded-lg border border-border bg-background px-3 py-2 text-sm"><option value="active">Actif</option><option value="inactive">Inactif</option><option value="blocked">Bloqué</option></select><Button onClick={() => void saveSupplier()} disabled={savingSupplier}><Save className="mr-2 h-4 w-4" />Enregistrer</Button></div></div>
              <label className="mt-5 block text-xs font-semibold uppercase text-muted-foreground">Notes internes Chargeurs.ch</label><textarea value={supplierNotes} onChange={(e) => setSupplierNotes(e.target.value)} rows={4} className="mt-2 w-full rounded-xl border border-border bg-background p-3 text-sm" placeholder="Notes internes, suivi commercial, risques, points à vérifier…" />
            </section>

            <div className="grid gap-4 lg:grid-cols-2">
              <section className="rounded-2xl border border-border bg-card/70 p-5"><div className="mb-3 flex items-center gap-2"><Mail className="h-4 w-4 text-primary" /><h3 className="font-semibold">Contacts</h3></div><div className="space-y-3">{contacts.filter((contact) => contact.supplier_id === selectedSupplier.id).map((contact) => <div key={contact.id} className="rounded-xl border border-border p-3"><div className="flex items-center justify-between"><strong className="text-sm">{contact.name ?? contact.contact_role}</strong><Badge tone={statusTone(contact.verification_state)}>{contact.verification_state}</Badge></div><p className="mt-1 text-xs text-muted-foreground">{contact.job_title ?? contact.contact_role}</p>{contact.email && <p className="mt-2 flex items-center gap-2 text-sm"><Mail className="h-3.5 w-3.5" />{contact.email}</p>}{contact.phone && <p className="mt-1 flex items-center gap-2 text-sm"><Phone className="h-3.5 w-3.5" />{contact.phone}</p>}</div>)}</div></section>
              <section className="rounded-2xl border border-border bg-card/70 p-5"><div className="mb-3 flex items-center gap-2"><FileText className="h-4 w-4 text-primary" /><h3 className="font-semibold">Sources & preuves</h3></div><div className="space-y-2">{(data.sourceDocuments ?? []).filter((doc) => doc.supplier_id === selectedSupplier.id).map((doc) => <div key={doc.id} className="rounded-xl border border-border p-3"><div className="flex items-center justify-between gap-2"><strong className="text-sm">{doc.title}</strong><Badge tone={statusTone(doc.verification_state)}>{doc.verification_state}</Badge></div><p className="mt-1 text-xs text-muted-foreground">{doc.source_type} · {formatDate(doc.ingested_at)}</p></div>)}</div></section>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <section className="rounded-2xl border border-border bg-card/70 p-5"><h3 className="mb-3 font-semibold">Capacités déclarées</h3><div className="flex flex-wrap gap-2">{(data.capabilities ?? []).filter((row) => row.supplier_id === selectedSupplier.id).map((row) => <Badge key={row.id} tone={statusTone(row.verification_state)}>{row.capability_name}</Badge>)}</div></section>
              <section className="rounded-2xl border border-border bg-card/70 p-5"><h3 className="mb-3 font-semibold">Lieux ciblés par le fournisseur</h3><div className="flex flex-wrap gap-2">{(data.targetVenues ?? []).filter((row) => row.supplier_id === selectedSupplier.id).map((row) => <Badge key={row.id} tone="info">{row.venue_type}</Badge>)}</div></section>
            </div>
          </div> : <div className="rounded-2xl border border-border bg-card/70 p-8 text-muted-foreground">Aucun fournisseur sélectionné.</div>}
        </div>
      )}

      {tab === "catalog" && (
        <section className="overflow-hidden rounded-2xl border border-border bg-card/70">
          <div className="border-b border-border p-5"><h2 className="font-semibold">Catalogue fournisseur</h2><p className="text-xs text-muted-foreground">Prix fournisseur ≠ landed cost Suisse ≠ prix client.</p></div>
          <div className="max-h-[68vh] overflow-auto"><table className="w-full min-w-[900px] text-sm"><thead className="sticky top-0 bg-muted text-left text-xs uppercase text-muted-foreground"><tr><th className="p-3">SKU / variante</th><th className="p-3">Produit</th><th className="p-3">Section</th><th className="p-3">Mode</th><th className="p-3">Offres</th><th className="p-3">Preuve</th></tr></thead><tbody>{products.map((product) => {
            const productOffers = offers.filter((offer) => offer.supplier_product_id === product.id);
            return <tr key={product.id} className="border-t border-border/70 align-top"><td className="p-3 font-semibold">{product.supplier_sku ?? product.supplier_variant_key}<div className="text-xs font-normal text-muted-foreground">{product.supplier_variant_key}</div></td><td className="p-3">{product.supplier_product_name}</td><td className="p-3 text-muted-foreground">{product.catalog_section ?? "—"}</td><td className="p-3"><Badge>{product.procurement_mode}</Badge></td><td className="p-3"><div className="space-y-1">{productOffers.slice(0, 4).map((offer) => <div key={offer.id} className="text-xs"><strong>{money(offer.unit_cost, offer.currency)}</strong> <span className="text-muted-foreground">{offer.quantity_label ?? offer.configuration_label ?? ""}</span></div>)}{productOffers.length > 4 && <div className="text-xs text-muted-foreground">+{productOffers.length - 4} autres</div>}</div></td><td className="p-3"><Badge tone={statusTone(product.verification_state)}>{product.verification_state}</Badge></td></tr>;
          })}</tbody></table></div>
        </section>
      )}

      {tab === "operations" && (
        <div className="grid gap-4 xl:grid-cols-2">
          <section className="rounded-2xl border border-border bg-card/70 p-5"><div className="mb-4 flex items-center gap-2"><ClipboardList className="h-5 w-5 text-primary" /><div><h2 className="font-semibold">Demandes fournisseur</h2><p className="text-xs text-muted-foreground">Questions techniques, BOM, pièces, garantie et logistique.</p></div></div><div className="space-y-3">{(data.inquiries ?? []).map((inquiry) => <div key={inquiry.id} className="rounded-xl border border-border p-3"><div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-sm">{inquiry.subject}</strong><Badge tone={statusTone(inquiry.status)}>{inquiry.status}</Badge></div><p className="mt-1 text-xs text-muted-foreground">{inquiry.sent_to ?? "—"} · envoyé {formatDate(inquiry.sent_at)}</p><div className="mt-2 flex flex-wrap gap-1">{(data.inquiryItems ?? []).filter((item) => item.inquiry_id === inquiry.id).slice(0, 12).map((item) => <Badge key={item.id} tone={statusTone(item.status)}>{item.requirement_name}</Badge>)}</div></div>)}</div></section>

          <section className="rounded-2xl border border-border bg-card/70 p-5"><div className="mb-4 flex items-center gap-2"><Wrench className="h-5 w-5 text-primary" /><div><h2 className="font-semibold">Pièces détachées attendues</h2><p className="text-xs text-muted-foreground">Aucun SKU ni coût ne doit être inventé.</p></div></div><div className="space-y-2">{(data.sparePartRequests ?? []).map((part) => <div key={part.id} className="rounded-xl border border-border p-3"><div className="flex items-center justify-between gap-2"><strong className="text-sm">{part.requested_part_name}</strong><Badge tone={statusTone(part.request_status)}>{part.request_status}</Badge></div><p className="mt-1 text-xs text-muted-foreground">{part.component_category} · SKU : {part.supplier_spare_sku ?? "UNKNOWN"} · coût : {money(part.unit_cost, part.currency)}</p></div>)}</div></section>

          <section className="rounded-2xl border border-border bg-card/70 p-5"><div className="mb-4 flex items-center gap-2"><Truck className="h-5 w-5 text-primary" /><div><h2 className="font-semibold">Bons de commande & réceptions</h2><p className="text-xs text-muted-foreground">Aucun ordre réel n’est envoyé au fournisseur depuis cet écran.</p></div></div>{(data.purchaseOrders ?? []).length ? <div className="space-y-2">{(data.purchaseOrders ?? []).map((po) => <div key={po.id} className="rounded-xl border border-border p-3"><div className="flex items-center justify-between"><strong>{po.po_number}</strong><Badge tone={statusTone(po.status)}>{po.status}</Badge></div><p className="mt-1 text-xs text-muted-foreground">{po.currency} · landed cost : {po.landed_cost_status} · {formatDate(po.ordered_at)}</p></div>)}</div> : <div className="rounded-xl bg-muted/40 p-4 text-sm text-muted-foreground">0 bon de commande réel. C’est volontaire tant qu’aucun achat n’est explicitement autorisé.</div>}</section>

          <section className="rounded-2xl border border-border bg-card/70 p-5"><div className="mb-4 flex items-center gap-2"><PackageCheck className="h-5 w-5 text-primary" /><div><h2 className="font-semibold">Quarantaines & RMA</h2><p className="text-xs text-muted-foreground">QUARANTINED ≠ DEFECTIVE ≠ RMA.</p></div></div><div className="space-y-3">{(data.quarantineCases ?? []).map((q) => {
            const asset = assetById.get(q.asset_id);
            const defect = (data.defectCases ?? []).find((row) => row.asset_id === q.asset_id);
            const rma = (data.rmaCases ?? []).find((row) => row.asset_id === q.asset_id);
            return <div key={q.id} className="rounded-xl border border-border p-3"><div className="flex flex-wrap items-center justify-between gap-2"><strong>{asset?.asset_code ?? q.asset_id}</strong><Badge tone={statusTone(q.status)}>{q.status}</Badge></div><p className="mt-1 text-xs text-muted-foreground">{q.source_reason_code ?? "raison non documentée"}</p><div className="mt-2 flex flex-wrap gap-2">{defect && <Badge tone={statusTone(defect.diagnostic_status)}>diagnostic : {defect.diagnostic_status}</Badge>}{rma && <Badge tone={statusTone(rma.status)}>RMA : {rma.status}</Badge>}</div></div>;
          })}</div></section>
        </div>
      )}
    </div>
  );
}
