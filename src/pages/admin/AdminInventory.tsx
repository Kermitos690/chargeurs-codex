import { useCallback, useEffect, useState } from "react";
import { Boxes, Loader2, PackageSearch, RefreshCw, Warehouse } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import BajieCatalog from "./inventory/BajieCatalog";
import AdminInventoryLegacy from "./AdminInventoryLegacy";

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

type Snapshot = {
  ok?: boolean;
  error?: string;
  generatedAt?: string;
  supplierProducts?: SupplierProduct[];
  offers?: Offer[];
};

type Mode = "catalog" | "operations";

export default function AdminInventory() {
  const [mode, setMode] = useState<Mode>("catalog");
  const [data, setData] = useState<Snapshot>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: response, error } = await supabase.functions.invoke<Snapshot>("inventory-admin", { body: { action: "snapshot" } });
      if (error || !response?.ok) throw new Error(response?.error ?? error?.message ?? "INVENTORY_ADMIN_FAILED");
      setData(response);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Impossible de charger le catalogue matériel.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-5 overflow-x-hidden">
      <header className="rounded-2xl border border-border bg-card/70 p-4 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-primary"><Boxes className="h-5 w-5" /><span className="text-xs font-semibold uppercase tracking-[0.16em]">Inventory & Supply Chain</span></div>
            <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">Matériel Chargeurs.ch</h1>
            <p className="mt-2 max-w-3xl text-sm text-muted-foreground">Le catalogue sert à choisir et préparer du matériel à acheter. La gestion opérationnelle conserve les actifs, fournisseurs, quarantaines, achats et RMA déjà suivis par Inventory.</p>
          </div>
          {mode === "catalog" ? <Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />Actualiser</Button> : null}
        </div>

        <div className="mt-5 grid grid-cols-2 gap-2 sm:inline-grid sm:w-auto">
          <button onClick={() => setMode("catalog")} className={`min-w-0 rounded-xl border px-3 py-3 text-left transition sm:min-w-[220px] ${mode === "catalog" ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:bg-muted"}`}>
            <span className="flex items-center gap-2 text-sm font-semibold"><PackageSearch className="h-4 w-4 shrink-0" />Catalogue visuel</span>
            <span className={`mt-1 block text-[11px] ${mode === "catalog" ? "text-primary-foreground/75" : "text-muted-foreground"}`}>Produits, photos, prix et pré-devis</span>
          </button>
          <button onClick={() => setMode("operations")} className={`min-w-0 rounded-xl border px-3 py-3 text-left transition sm:min-w-[220px] ${mode === "operations" ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:bg-muted"}`}>
            <span className="flex items-center gap-2 text-sm font-semibold"><Warehouse className="h-4 w-4 shrink-0" />Gestion Inventory</span>
            <span className={`mt-1 block text-[11px] ${mode === "operations" ? "text-primary-foreground/75" : "text-muted-foreground"}`}>Stock, fournisseurs, maintenance et RMA</span>
          </button>
        </div>
      </header>

      {mode === "catalog" ? (
        loading && !data.supplierProducts ? <div className="grid min-h-[360px] place-items-center rounded-2xl border border-border bg-card/50"><Loader2 className="h-9 w-9 animate-spin text-primary" /></div> : <BajieCatalog products={data.supplierProducts ?? []} offers={data.offers ?? []} />
      ) : <AdminInventoryLegacy />}
    </div>
  );
}
