import { useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw } from "lucide-react";

export default function AdminShops() {
  const [shops, setShops] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.functions.invoke("chargenow-admin", { body: { action: "invoke", code: "S1" } });
    setLoading(false);
    setShops(data);
  };

  const records = (shops?.data?.data ?? shops?.data ?? []) as any[];

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-3xl font-bold">Boutiques</h1>
        <Button variant="ghost" onClick={load} className="gap-2">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}Charger (S1)</Button>
      </div>
      {Array.isArray(records) && records.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {records.map((s, i) => (
            <div key={i} className="glass liquid-border rounded-2xl p-4">
              <div className="font-semibold">{s.shopName ?? s.name ?? s.shopId ?? `Shop ${i}`}</div>
              <div className="font-mono text-xs text-muted-foreground">{s.shopId ?? s.id}</div>
              {s.address && <div className="mt-1 text-sm text-muted-foreground">{s.address}</div>}
            </div>
          ))}
        </div>
      ) : (
        <pre className="glass max-h-96 overflow-auto rounded-2xl p-4 text-xs">{shops ? JSON.stringify(shops, null, 2) : "Cliquez sur Charger pour interroger ChargeNow (S1 getShopList)."}</pre>
      )}
      <p className="text-xs text-muted-foreground">Vue en lecture seule (S1 getShopList). La création / modification / suppression (S3–S5) et la liaison de boutique (C9/C11) ne sont pas exposées dans cette page : elles s'exécutent via le dispatcher admin testé dans <Link to="/admin/api-coverage" className="underline">/admin/api-coverage</Link> (dry-run, confirmation, preuve enregistrée). Aucune route ChargeNow hors inventaire Apifox n'est utilisée.</p>
    </div>
  );
}
