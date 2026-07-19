import { useEffect, useState } from "react";
import { supabase as typedSupabase } from "@/integrations/supabase/client";
// The api_* tables are provisioned by docs/platform-api/staging-bootstrap.sql
// and are not yet in the generated Database types. Cast through unknown so
// the UI can address them without weakening types elsewhere.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const supabase = typedSupabase as unknown as any;
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Copy, KeyRound, Trash2 } from "lucide-react";

// Super-admin only UI to manage Platform API clients and their keys.
// Backend enforcement lives in RLS (super_admin only). The UI mirrors that
// and refuses to render anything if the caller is not super_admin.

type Environment = "test" | "live";

interface ApiClient {
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
}

interface ApiKey {
  id: string;
  client_id: string;
  key_prefix: string;
  key_public_id: string;
  label: string | null;
  last_used_at: string | null;
  created_at: string;
  revoked_at: string | null;
}

const AVAILABLE_SCOPES = [
  "health:read", "stations:read", "inventory:read", "pricing:read", "rentals:read",
] as const;

async function sha256Hex(input: string): Promise<string> {
  const enc = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function generateRawKey(env: Environment): { raw: string; prefix: string; publicId: string } {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const suffix = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
  const prefix = env === "live" ? "chg_live_" : "chg_test_";
  return { raw: `${prefix}${suffix}`, prefix, publicId: suffix.slice(0, 12) };
}

export default function AdminApiClients() {
  const [clients, setClients] = useState<ApiClient[]>([]);
  const [keys, setKeys] = useState<Record<string, ApiKey[]>>({});
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [env, setEnv] = useState<Environment>("test");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [selectedScopes, setSelectedScopes] = useState<string[]>(["health:read", "stations:read"]);
  const [revealed, setRevealed] = useState<{ raw: string; label: string } | null>(null);

  async function load() {
    setLoading(true);
    const [{ data: cs, error: ce }, { data: ks }] = await Promise.all([
      supabase.from("api_clients").select("*").order("created_at", { ascending: false }),
      supabase.from("api_keys").select("*").order("created_at", { ascending: false }),
    ]);
    if (ce) {
      // A non-super-admin session will hit RLS here.
      toast.error("Accès refusé — réservé aux super-administrateurs.");
      setClients([]); setKeys({}); setLoading(false); return;
    }
    setClients((cs ?? []) as ApiClient[]);
    const grouped: Record<string, ApiKey[]> = {};
    for (const k of (ks ?? []) as ApiKey[]) (grouped[k.client_id] ??= []).push(k);
    setKeys(grouped);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function createClient() {
    if (!name.trim() || selectedScopes.length === 0) {
      toast.error("Renseigne un nom et au moins un scope.");
      return;
    }
    const { error } = await supabase.from("api_clients").insert({
      name: name.trim(),
      environment: env,
      owner_email: ownerEmail.trim() || null,
      scopes: selectedScopes,
    });
    if (error) { toast.error(error.message); return; }
    setName(""); setOwnerEmail(""); setSelectedScopes(["health:read", "stations:read"]);
    await load();
    toast.success("Client API créé");
  }

  async function toggleActive(c: ApiClient) {
    const { error } = await supabase.from("api_clients")
      .update({ active: !c.active }).eq("id", c.id);
    if (error) toast.error(error.message);
    else load();
  }

  async function createKey(c: ApiClient) {
    const { raw, prefix, publicId } = generateRawKey(c.environment);
    const key_hash = await sha256Hex(raw);
    const { error } = await supabase.from("api_keys").insert({
      client_id: c.id,
      key_prefix: prefix,
      key_public_id: publicId,
      key_hash,
      label: `Créée le ${new Date().toLocaleDateString("fr-CH")}`,
    });
    if (error) { toast.error(error.message); return; }
    setRevealed({ raw, label: `${c.name} · ${c.environment}` });
    await load();
  }

  async function revokeKey(k: ApiKey) {
    if (!confirm("Révoquer cette clé ? Cette action est immédiate.")) return;
    const { error } = await supabase.from("api_keys")
      .update({ revoked_at: new Date().toISOString() }).eq("id", k.id);
    if (error) toast.error(error.message);
    else load();
  }

  return (
    <div className="space-y-6 p-6">
      <header className="flex items-center gap-3">
        <KeyRound className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Clients API</h1>
          <p className="text-sm text-muted-foreground">
            Platform API v1 — lecture seule. Réservé aux super-administrateurs.
          </p>
        </div>
      </header>

      <Card className="space-y-3 p-4">
        <h2 className="font-semibold">Nouveau client</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <Label>Nom</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Partenaire X" />
          </div>
          <div>
            <Label>Email propriétaire</Label>
            <Input value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} placeholder="contact@partenaire.tld" />
          </div>
          <div>
            <Label>Environnement</Label>
            <div className="flex gap-2">
              {(["test", "live"] as Environment[]).map((e) => (
                <Button key={e} type="button" variant={env === e ? "default" : "outline"} onClick={() => setEnv(e)}>
                  {e}
                </Button>
              ))}
            </div>
          </div>
          <div>
            <Label>Scopes</Label>
            <div className="flex flex-wrap gap-2">
              {AVAILABLE_SCOPES.map((s) => {
                const on = selectedScopes.includes(s);
                return (
                  <Button
                    key={s} type="button" size="sm"
                    variant={on ? "default" : "outline"}
                    onClick={() =>
                      setSelectedScopes((cur) =>
                        cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]
                      )}
                  >
                    {s}
                  </Button>
                );
              })}
            </div>
          </div>
        </div>
        <Button onClick={createClient}>Créer le client</Button>
      </Card>

      {revealed && (
        <Card className="space-y-2 border-warning p-4">
          <h3 className="font-semibold text-warning">Nouvelle clé — {revealed.label}</h3>
          <p className="text-sm">Cette valeur n'est affichée qu'une seule fois. Copie-la maintenant.</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 break-all rounded bg-muted p-2 font-mono text-sm">{revealed.raw}</code>
            <Button size="sm" onClick={() => { navigator.clipboard.writeText(revealed.raw); toast.success("Copié"); }}>
              <Copy className="h-4 w-4" />
            </Button>
          </div>
          <Button variant="outline" size="sm" onClick={() => setRevealed(null)}>J'ai copié</Button>
        </Card>
      )}

      {loading ? (
        <p className="text-muted-foreground">Chargement…</p>
      ) : clients.length === 0 ? (
        <p className="text-muted-foreground">Aucun client API pour le moment.</p>
      ) : (
        <div className="space-y-4">
          {clients.map((c) => (
            <Card key={c.id} className="space-y-3 p-4">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold">{c.name}</h3>
                    <Badge variant={c.environment === "live" ? "destructive" : "secondary"}>{c.environment}</Badge>
                    {!c.active && <Badge variant="outline">inactif</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground">{c.owner_email ?? "—"} · {c.scopes.join(", ")}</p>
                  <p className="text-xs text-muted-foreground">
                    Quota : {c.quota_per_minute}/min · {c.quota_per_day}/jour
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={() => toggleActive(c)}>
                  {c.active ? "Désactiver" : "Réactiver"}
                </Button>
                <Button size="sm" onClick={() => createKey(c)}>Créer une clé</Button>
              </div>
              <div className="space-y-1">
                {(keys[c.id] ?? []).map((k) => (
                  <div key={k.id} className="flex items-center justify-between rounded border p-2 text-sm">
                    <div>
                      <code className="font-mono">{k.key_prefix}{k.key_public_id}…</code>
                      {k.revoked_at && <Badge variant="destructive" className="ml-2">révoquée</Badge>}
                      <span className="ml-2 text-xs text-muted-foreground">
                        {k.last_used_at ? `utilisée ${new Date(k.last_used_at).toLocaleString("fr-CH")}` : "jamais utilisée"}
                      </span>
                    </div>
                    {!k.revoked_at && (
                      <Button variant="ghost" size="sm" onClick={() => revokeKey(k)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))}
                {(keys[c.id] ?? []).length === 0 && (
                  <p className="text-xs text-muted-foreground">Aucune clé émise pour ce client.</p>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
