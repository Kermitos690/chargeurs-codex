import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, RefreshCw, RotateCcw, ShieldX, Smartphone } from "lucide-react";

type WalletPass = {
  id: string;
  user_id: string;
  serial_number: string;
  status: string;
  pass_version: number;
  last_generated_at: string | null;
  last_updated_at: string;
  revoked_at: string | null;
};

type ConfigStatus = Record<string, boolean>;

export default function AdminWalletPasses() {
  const [passes, setPasses] = useState<WalletPass[]>([]);
  const [config, setConfig] = useState<ConfigStatus>({});
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const invoke = async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke("wallet-admin", { body });
    if (error) throw error;
    if (!data?.ok) throw new Error(data?.error ?? "Erreur Wallet");
    return data;
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, status] = await Promise.all([
        invoke({ action: "list", query }),
        invoke({ action: "config_status" }),
      ]);
      setPasses(list.passes ?? []);
      setConfig(status.configured ?? {});
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erreur Wallet");
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => { load(); }, [load]);

  const action = async (passId: string, actionName: "refresh" | "revoke" | "rotate_qr") => {
    setBusy(`${passId}:${actionName}`);
    try {
      await invoke({ action: actionName, passId });
      toast.success("Action Wallet terminée");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Action impossible");
    } finally {
      setBusy(null);
    }
  };

  const missing = Object.entries(config).filter(([, ok]) => !ok).map(([name]) => name);

  return (
    <div className="animate-fade-in space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div><h1 className="font-display text-3xl font-bold">Cartes Apple Wallet</h1><p className="text-sm text-muted-foreground">Cartes membres, versions, révocation et configuration des certificats.</p></div>
        <Button variant="outline" onClick={load} disabled={loading}><RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />Actualiser</Button>
      </header>

      <div className={`rounded-2xl border p-4 text-sm ${missing.length ? "border-warning/40 bg-warning/5" : "border-success/40 bg-success/5"}`}>
        <strong>{missing.length ? "Configuration incomplète" : "Configuration serveur complète"}</strong>
        <p className="mt-1 text-muted-foreground">{missing.length ? `Secrets manquants : ${missing.join(", ")}. Leur contenu n'est jamais affiché.` : "Tous les secrets requis sont présents. Leur contenu reste masqué."}</p>
      </div>

      <div className="flex gap-2"><Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Rechercher par numéro de série" /><Button onClick={load}>Rechercher</Button></div>

      {loading ? <div className="grid place-items-center py-16"><Loader2 className="h-8 w-8 animate-spin" /></div> :
        <div className="space-y-3">{passes.length === 0 ? <p className="text-sm text-muted-foreground">Aucune carte générée.</p> : passes.map((pass) => (
          <div key={pass.id} className="glass liquid-border flex flex-wrap items-center justify-between gap-4 rounded-2xl p-5">
            <div className="flex items-center gap-3"><Smartphone className="h-6 w-6 text-primary" /><div><div className="flex items-center gap-2"><span className="font-mono font-semibold">{pass.serial_number}</span><Badge variant={pass.status === "active" ? "default" : "destructive"}>{pass.status}</Badge></div><p className="text-xs text-muted-foreground">Utilisateur {pass.user_id.slice(0, 8)}… · version {pass.pass_version} · mise à jour {new Date(pass.last_updated_at).toLocaleString("fr-CH")}</p></div></div>
            <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => action(pass.id, "refresh")} disabled={Boolean(busy)}><RefreshCw className="mr-1 h-4 w-4" />Actualiser</Button><Button size="sm" variant="outline" onClick={() => action(pass.id, "rotate_qr")} disabled={Boolean(busy)}><RotateCcw className="mr-1 h-4 w-4" />Nouveau QR</Button>{pass.status === "active" && <Button size="sm" variant="destructive" onClick={() => action(pass.id, "revoke")} disabled={Boolean(busy)}><ShieldX className="mr-1 h-4 w-4" />Révoquer</Button>}</div>
          </div>
        ))}</div>}
    </div>
  );
}
