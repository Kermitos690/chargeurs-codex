import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Ban, Copy, KeyRound, Loader2, Plus, RefreshCw, ShieldCheck } from "lucide-react";

type ApiKey = {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  rate_limit_per_minute: number;
  active: boolean;
  expires_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
};

type ApiClient = {
  id: string;
  name: string;
  environment: "test" | "live";
  active: boolean;
  description: string | null;
  created_at: string;
  api_keys: ApiKey[];
};

const DEFAULT_SCOPES = ["health:read", "stations:read", "inventory:read", "pricing:read", "rentals:read"];

export default function AdminApiClients() {
  const { isSuperAdmin } = useAuth();
  const [clients, setClients] = useState<ApiClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [environment, setEnvironment] = useState<"test" | "live">("test");
  const [oneTimeSecret, setOneTimeSecret] = useState<string | null>(null);

  const invoke = async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke("api-key-admin", { body });
    if (error) throw error;
    if (!(data as { ok?: boolean })?.ok) throw new Error(String((data as { error?: string })?.error ?? "API_ADMIN_ERROR"));
    return data as Record<string, any>;
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await invoke({ action: "list" });
      setClients((data.clients ?? []) as ApiClient[]);
    } catch (error) {
      toast.error(`Impossible de charger les clients API : ${String((error as Error).message ?? error)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (isSuperAdmin) void load(); }, [isSuperAdmin, load]);

  const createClient = async () => {
    if (name.trim().length < 2) return toast.error("Le nom du client API est requis.");
    setWorking("create-client");
    try {
      await invoke({ action: "create_client", name: name.trim(), environment });
      setName("");
      toast.success("Client API créé.");
      await load();
    } catch (error) {
      toast.error(String((error as Error).message ?? error));
    } finally {
      setWorking(null);
    }
  };

  const createKey = async (client: ApiClient) => {
    setWorking(`key-${client.id}`);
    setOneTimeSecret(null);
    try {
      const data = await invoke({
        action: "create_key",
        clientId: client.id,
        name: `${client.name} — clé principale`,
        scopes: DEFAULT_SCOPES,
        rateLimitPerMinute: 120,
      });
      setOneTimeSecret(String(data.secret));
      toast.success("Clé créée. Copiez-la maintenant : elle ne sera plus affichée.");
      await load();
    } catch (error) {
      toast.error(String((error as Error).message ?? error));
    } finally {
      setWorking(null);
    }
  };

  const revokeKey = async (key: ApiKey) => {
    setWorking(`revoke-${key.id}`);
    try {
      await invoke({ action: "revoke_key", keyId: key.id });
      toast.success("Clé révoquée.");
      await load();
    } catch (error) {
      toast.error(String((error as Error).message ?? error));
    } finally {
      setWorking(null);
    }
  };

  const copySecret = async () => {
    if (!oneTimeSecret) return;
    await navigator.clipboard.writeText(oneTimeSecret);
    toast.success("Clé copiée. Stockez-la dans le gestionnaire de secrets du service concerné.");
  };

  if (!isSuperAdmin) {
    return (
      <div className="glass liquid-border max-w-2xl rounded-2xl p-8">
        <ShieldCheck className="mb-4 h-8 w-8 text-warning" />
        <h1 className="font-display text-2xl font-bold">API personnelle Chargeurs.ch</h1>
        <p className="mt-2 text-muted-foreground">Cette page est réservée au rôle super_admin.</p>
      </div>
    );
  }

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold">API personnelle Chargeurs.ch</h1>
          <p className="text-muted-foreground">Clients, clés hachées, périmètres et révocation.</p>
        </div>
        <Button variant="ghost" onClick={load} disabled={loading} className="gap-2">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}Actualiser
        </Button>
      </div>

      {oneTimeSecret && (
        <section className="rounded-2xl border border-warning/50 bg-warning/10 p-5">
          <h2 className="font-semibold">Clé affichée une seule fois</h2>
          <p className="mt-1 text-sm text-muted-foreground">Ne la collez jamais dans GitHub, une URL, un QR code ou une capture.</p>
          <div className="mt-3 flex gap-2">
            <Input readOnly value={oneTimeSecret} className="font-mono" />
            <Button onClick={copySecret} className="gap-2"><Copy className="h-4 w-4" />Copier</Button>
          </div>
        </section>
      )}

      <section className="glass liquid-border rounded-2xl p-6">
        <h2 className="mb-4 font-display text-xl font-bold">Nouveau client API</h2>
        <div className="grid gap-4 md:grid-cols-[1fr_180px_auto] md:items-end">
          <div className="space-y-2">
            <Label htmlFor="api-client-name">Nom</Label>
            <Input id="api-client-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Kiosk staging, partenaire, application mobile…" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="api-client-env">Environnement</Label>
            <select id="api-client-env" value={environment} onChange={(event) => setEnvironment(event.target.value as "test" | "live")}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
              <option value="test">Test</option>
              <option value="live">Live</option>
            </select>
          </div>
          <Button onClick={createClient} disabled={working === "create-client"} className="gap-2">
            {working === "create-client" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}Créer
          </Button>
        </div>
      </section>

      <div className="space-y-4">
        {clients.map((client) => (
          <section key={client.id} className="glass liquid-border rounded-2xl p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="font-display text-xl font-bold">{client.name}</h2>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${client.environment === "live" ? "bg-destructive/15 text-destructive" : "bg-primary/15 text-primary"}`}>
                    {client.environment.toUpperCase()}
                  </span>
                </div>
                <p className="font-mono text-xs text-muted-foreground">{client.id}</p>
              </div>
              <Button variant="ghost" onClick={() => createKey(client)} disabled={working === `key-${client.id}`} className="gap-2 border border-border">
                {working === `key-${client.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}Créer une clé lecture
              </Button>
            </div>

            <div className="mt-5 space-y-2">
              {(client.api_keys ?? []).map((key) => (
                <div key={key.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-muted/30 p-4">
                  <div>
                    <div className="font-medium">{key.name}</div>
                    <div className="font-mono text-xs text-muted-foreground">{key.key_prefix}… · {key.rate_limit_per_minute}/min</div>
                    <div className="mt-1 text-xs text-muted-foreground">{key.scopes.join(", ")}</div>
                    <div className="mt-1 text-xs text-muted-foreground">Dernière utilisation : {key.last_used_at ? new Date(key.last_used_at).toLocaleString() : "jamais"}</div>
                  </div>
                  {key.active && !key.revoked_at ? (
                    <Button variant="ghost" onClick={() => revokeKey(key)} disabled={working === `revoke-${key.id}`} className="gap-2 text-destructive">
                      {working === `revoke-${key.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />}Révoquer
                    </Button>
                  ) : <span className="text-sm font-semibold text-muted-foreground">Révoquée</span>}
                </div>
              ))}
              {(client.api_keys ?? []).length === 0 && <p className="text-sm text-muted-foreground">Aucune clé.</p>}
            </div>
          </section>
        ))}
        {!loading && clients.length === 0 && <p className="text-muted-foreground">Aucun client API.</p>}
      </div>
    </div>
  );
}
