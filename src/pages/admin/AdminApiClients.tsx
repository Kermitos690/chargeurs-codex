import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Copy, ExternalLink, KeyRound, Loader2, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";

type Environment = "test" | "live";

type ApiClient = {
  id: string;
  name: string;
  environment: Environment;
  owner_email: string | null;
  scopes: string[];
  quota_per_minute: number;
  quota_per_day: number;
  active: boolean;
  created_at: string;
  revoked_at: string | null;
};

type ApiKey = {
  id: string;
  client_id: string;
  key_prefix: string;
  key_public_id: string;
  label: string | null;
  last_used_at: string | null;
  created_at: string;
  revoked_at: string | null;
};

type AdminResponse = {
  ok?: boolean;
  error?: string;
  clients?: ApiClient[];
  keys?: ApiKey[];
  secret?: string;
  key?: ApiKey;
};

const AVAILABLE_SCOPES = [
  "health:read",
  "stations:read",
  "inventory:read",
  "pricing:read",
  "rentals:read",
] as const;

const DOC_URL = "https://github.com/Kermitos690/chargeurs-codex/blob/agent/platform-api-readonly-v1/docs/API_V1.md";
const OPENAPI_URL = "https://github.com/Kermitos690/chargeurs-codex/blob/agent/platform-api-readonly-v1/docs/openapi/chargeurs-api-v1.yaml";

export default function AdminApiClients() {
  const [clients, setClients] = useState<ApiClient[]>([]);
  const [keys, setKeys] = useState<Record<string, ApiKey[]>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [environment, setEnvironment] = useState<Environment>("test");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [quotaPerMinute, setQuotaPerMinute] = useState("60");
  const [quotaPerDay, setQuotaPerDay] = useState("10000");
  const [selectedScopes, setSelectedScopes] = useState<string[]>([...AVAILABLE_SCOPES]);
  const [revealed, setRevealed] = useState<{ raw: string; label: string } | null>(null);

  const invokeAdmin = useCallback(async (body: Record<string, unknown>): Promise<AdminResponse | null> => {
    const { data, error } = await supabase.functions.invoke("api-key-admin", { body });
    if (error) {
      toast.error(error.message || "La fonction d’administration API est indisponible.");
      return null;
    }
    const response = (data ?? {}) as AdminResponse;
    if (!response.ok) {
      toast.error(response.error ?? "Action API refusée");
      return null;
    }
    return response;
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const response = await invokeAdmin({ action: "list" });
    if (response) {
      setClients(response.clients ?? []);
      const grouped: Record<string, ApiKey[]> = {};
      for (const key of response.keys ?? []) (grouped[key.client_id] ??= []).push(key);
      setKeys(grouped);
    }
    setLoading(false);
  }, [invokeAdmin]);

  useEffect(() => { void load(); }, [load]);

  async function createClient() {
    if (!name.trim() || selectedScopes.length === 0) {
      toast.error("Renseigne un nom et au moins un scope de lecture.");
      return;
    }
    if (environment === "live" && !window.confirm("Créer directement un client LIVE ? Pour les premiers essais, TEST est recommandé.")) return;

    setBusy("create-client");
    const response = await invokeAdmin({
      action: "create_client",
      name: name.trim(),
      environment,
      ownerEmail: ownerEmail.trim() || null,
      scopes: selectedScopes,
      quotaPerMinute: Number(quotaPerMinute),
      quotaPerDay: Number(quotaPerDay),
    });
    setBusy(null);
    if (!response) return;

    setName("");
    setOwnerEmail("");
    setEnvironment("test");
    setSelectedScopes([...AVAILABLE_SCOPES]);
    setQuotaPerMinute("60");
    setQuotaPerDay("10000");
    toast.success("Client API créé");
    await load();
  }

  async function toggleActive(client: ApiClient) {
    setBusy(`client-${client.id}`);
    const response = await invokeAdmin({
      action: "set_client_active",
      clientId: client.id,
      active: !client.active,
    });
    setBusy(null);
    if (response) await load();
  }

  async function createKey(client: ApiClient) {
    if (client.environment === "live" && !window.confirm("Créer une clé LIVE ? Elle donnera accès aux données réelles autorisées par les scopes du client.")) return;
    setBusy(`key-${client.id}`);
    const response = await invokeAdmin({
      action: "create_key",
      clientId: client.id,
      label: `Clé ${client.environment.toUpperCase()} · ${new Date().toLocaleDateString("fr-CH")}`,
    });
    setBusy(null);
    if (!response?.secret) return;
    setRevealed({ raw: response.secret, label: `${client.name} · ${client.environment}` });
    toast.success("Clé générée côté serveur — copie-la maintenant.");
    await load();
  }

  async function revokeKey(key: ApiKey) {
    if (!window.confirm("Révoquer cette clé ? L’effet est immédiat et irréversible.")) return;
    setBusy(`revoke-${key.id}`);
    const response = await invokeAdmin({ action: "revoke_key", keyId: key.id });
    setBusy(null);
    if (response) {
      toast.success("Clé révoquée");
      await load();
    }
  }

  async function copySecret() {
    if (!revealed) return;
    await navigator.clipboard.writeText(revealed.raw);
    toast.success("Clé copiée");
  }

  return (
    <div className="space-y-6 p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <KeyRound className="mt-1 h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Clients API</h1>
            <p className="text-sm text-muted-foreground">Platform API v1 en lecture seule · réservé aux super-administrateurs.</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" asChild><a href={DOC_URL} target="_blank" rel="noreferrer"><ExternalLink className="mr-2 h-4 w-4" />Documentation</a></Button>
          <Button variant="outline" size="sm" asChild><a href={OPENAPI_URL} target="_blank" rel="noreferrer"><ExternalLink className="mr-2 h-4 w-4" />OpenAPI</a></Button>
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}><RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />Actualiser</Button>
        </div>
      </header>

      <Card className="border-success/30 bg-success/5 p-4">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-5 w-5 text-success" />
          <div className="text-sm">
            <p className="font-medium">Les secrets sont générés exclusivement côté serveur.</p>
            <p className="text-muted-foreground">La base ne conserve que leur empreinte SHA-256. La valeur complète n’est affichée qu’une seule fois.</p>
          </div>
        </div>
      </Card>

      <Card className="space-y-4 p-4">
        <h2 className="font-semibold">Nouveau client</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1"><Label>Nom</Label><Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Chargeurs.ch Apifox" /></div>
          <div className="space-y-1"><Label>Email propriétaire</Label><Input type="email" value={ownerEmail} onChange={(event) => setOwnerEmail(event.target.value)} placeholder="contact@chargeurs.ch" /></div>
          <div className="space-y-1">
            <Label>Environnement</Label>
            <div className="flex gap-2">
              {(["test", "live"] as Environment[]).map((value) => <Button key={value} type="button" variant={environment === value ? "default" : "outline"} onClick={() => setEnvironment(value)}>{value.toUpperCase()}</Button>)}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label>Quota / minute</Label><Input type="number" min={1} max={10000} value={quotaPerMinute} onChange={(event) => setQuotaPerMinute(event.target.value)} /></div>
            <div className="space-y-1"><Label>Quota / jour</Label><Input type="number" min={1} max={1000000} value={quotaPerDay} onChange={(event) => setQuotaPerDay(event.target.value)} /></div>
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label>Scopes de lecture</Label>
            <div className="flex flex-wrap gap-2">
              {AVAILABLE_SCOPES.map((scope) => {
                const selected = selectedScopes.includes(scope);
                return <Button key={scope} type="button" size="sm" variant={selected ? "default" : "outline"} onClick={() => setSelectedScopes((current) => current.includes(scope) ? current.filter((item) => item !== scope) : [...current, scope])}>{scope}</Button>;
              })}
            </div>
          </div>
        </div>
        <Button onClick={() => void createClient()} disabled={busy === "create-client"}>{busy === "create-client" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Créer le client</Button>
      </Card>

      {revealed && (
        <Card className="space-y-3 border-warning p-4">
          <h3 className="font-semibold text-warning">Nouvelle clé — {revealed.label}</h3>
          <p className="text-sm">Copie-la maintenant. Après fermeture de cet encadré, elle ne pourra plus être récupérée.</p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <code className="flex-1 break-all rounded bg-muted p-3 font-mono text-sm">{revealed.raw}</code>
            <Button onClick={() => void copySecret()}><Copy className="mr-2 h-4 w-4" />Copier</Button>
          </div>
          <Button variant="outline" size="sm" onClick={() => setRevealed(null)}>J’ai sauvegardé la clé</Button>
        </Card>
      )}

      {loading ? <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Chargement…</div> : clients.length === 0 ? <p className="text-muted-foreground">Aucun client API.</p> : (
        <div className="space-y-4">
          {clients.map((client) => (
            <Card key={client.id} className="space-y-3 p-4">
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{client.name}</h3><Badge variant={client.environment === "live" ? "destructive" : "secondary"}>{client.environment}</Badge>{!client.active && <Badge variant="outline">inactif</Badge>}</div>
                  <p className="text-xs text-muted-foreground">{client.owner_email ?? "—"} · {client.scopes.join(", ")}</p>
                  <p className="text-xs text-muted-foreground">Quota : {client.quota_per_minute}/min · {client.quota_per_day}/jour</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => void toggleActive(client)} disabled={busy === `client-${client.id}`}>{busy === `client-${client.id}` && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{client.active ? "Désactiver" : "Réactiver"}</Button>
                <Button size="sm" onClick={() => void createKey(client)} disabled={!client.active || busy === `key-${client.id}`}>{busy === `key-${client.id}` && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Créer une clé</Button>
              </div>
              <div className="space-y-2">
                {(keys[client.id] ?? []).map((key) => (
                  <div key={key.id} className="flex flex-wrap items-center justify-between gap-3 rounded border p-2 text-sm">
                    <div><code className="font-mono">{key.key_prefix}{key.key_public_id}…</code>{key.revoked_at && <Badge variant="destructive" className="ml-2">révoquée</Badge>}<div className="text-xs text-muted-foreground">{key.label ?? "Sans libellé"} · {key.last_used_at ? `utilisée ${new Date(key.last_used_at).toLocaleString("fr-CH")}` : "jamais utilisée"}</div></div>
                    {!key.revoked_at && <Button variant="ghost" size="sm" onClick={() => void revokeKey(key)} disabled={busy === `revoke-${key.id}`}><Trash2 className="h-4 w-4" /></Button>}
                  </div>
                ))}
                {(keys[client.id] ?? []).length === 0 && <p className="text-xs text-muted-foreground">Aucune clé émise.</p>}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
