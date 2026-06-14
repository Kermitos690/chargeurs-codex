import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, TabletSmartphone, RefreshCw, Plus, Copy, Check, KeyRound, Ban } from "lucide-react";

type Device = {
  id: string;
  station_id: string;
  label: string | null;
  active: boolean;
  token_revoked: boolean;
  token_expires_at: string | null;
  token_rotated_at: string | null;
  last_seen_at: string | null;
};

function statusBadge(d: Device) {
  if (d.token_revoked || !d.active) return <Badge variant="destructive">Révoqué</Badge>;
  if (d.token_expires_at && new Date(d.token_expires_at) < new Date())
    return <Badge variant="outline" className="text-warning">Expiré</Badge>;
  return <Badge className="bg-success/15 text-success hover:bg-success/15">Actif</Badge>;
}

export default function AdminKioskDevices() {
  const { canWrite } = useAuth();
  const [devices, setDevices] = useState<Device[]>([]);
  const [stations, setStations] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const [stationId, setStationId] = useState("");
  const [label, setLabel] = useState("");
  const [ttlDays, setTtlDays] = useState("");

  const [revealedToken, setRevealedToken] = useState<{ id: string; token: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: dRes }, { data: sRes }] = await Promise.all([
      supabase.functions.invoke("kiosk-admin", { body: { action: "list" } }),
      supabase.from("stations").select("station_id").order("station_id"),
    ]);
    if (dRes?.ok) setDevices(dRes.devices as Device[]);
    else toast.error(dRes?.error ?? "Erreur de chargement des tablettes");
    setStations((sRes ?? []).map((s) => s.station_id));
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const mutate = async (action: string, body: Record<string, unknown>, key: string) => {
    setBusy(key);
    const { data, error } = await supabase.functions.invoke("kiosk-admin", { body: { action, ...body } });
    setBusy(null);
    if (error || !data?.ok) {
      toast.error(data?.error ?? error?.message ?? "Erreur");
      return null;
    }
    return data;
  };

  const provision = async () => {
    if (!stationId) { toast.error("Choisissez une borne"); return; }
    const data = await mutate("provision", {
      stationId, label: label || null, ttlDays: ttlDays ? Number(ttlDays) : null,
    }, "provision");
    if (data?.token) {
      setRevealedToken({ id: data.device.id, token: data.token });
      setLabel(""); setTtlDays("");
      toast.success("Token créé — copiez-le maintenant, il ne sera plus affiché.");
      await load();
    }
  };

  const rotate = async (id: string) => {
    const data = await mutate("rotate", { deviceId: id, ttlDays: ttlDays ? Number(ttlDays) : null }, `rotate-${id}`);
    if (data?.token) {
      setRevealedToken({ id, token: data.token });
      toast.success("Token régénéré — l'ancien est invalidé.");
      await load();
    }
  };

  const revoke = async (id: string) => {
    const data = await mutate("revoke", { deviceId: id }, `revoke-${id}`);
    if (data) { toast.success("Tablette révoquée"); await load(); }
  };

  const copyToken = async (t: string) => {
    await navigator.clipboard.writeText(t);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold">Tablettes kiosque</h1>
          <p className="text-muted-foreground">Provisionnez le token d'authentification de chaque borne.</p>
        </div>
        <Button variant="outline" onClick={load} disabled={loading} className="gap-2 rounded-full">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}Actualiser
        </Button>
      </header>

      {canWrite && (
        <div className="glass liquid-border rounded-2xl p-6">
          <h2 className="mb-4 flex items-center gap-2 font-display text-lg font-bold">
            <Plus className="h-5 w-5" />Provisionner une tablette
          </h2>
          <div className="grid gap-3 md:grid-cols-[1fr_1fr_140px_auto]">
            <Select value={stationId} onValueChange={setStationId}>
              <SelectTrigger><SelectValue placeholder="Borne (cabinet)" /></SelectTrigger>
              <SelectContent>
                {stations.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input placeholder="Libellé (ex. Tablette entrée)" value={label} onChange={(e) => setLabel(e.target.value)} />
            <Input type="number" min={1} placeholder="Expire (jours)" value={ttlDays} onChange={(e) => setTtlDays(e.target.value)} />
            <Button onClick={provision} disabled={busy === "provision"} className="gap-2 rounded-full bg-gradient-primary">
              {busy === "provision" ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}Créer le token
            </Button>
          </div>
        </div>
      )}

      {revealedToken && (
        <div className="glass-strong liquid-border rounded-2xl border-success/40 p-6">
          <p className="mb-2 text-sm font-medium text-success">Token affiché une seule fois — copiez-le puis collez-le dans le Diagnostic borne de la tablette.</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 overflow-x-auto rounded-lg bg-background/60 p-3 font-mono text-sm">{revealedToken.token}</code>
            <Button onClick={() => copyToken(revealedToken.token)} variant="outline" className="gap-2 rounded-full">
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}{copied ? "Copié" : "Copier"}
            </Button>
          </div>
          <button onClick={() => setRevealedToken(null)} className="mt-3 text-xs text-muted-foreground hover:text-foreground">
            J'ai copié le token, masquer
          </button>
        </div>
      )}

      <div className="grid gap-4">
        {loading ? (
          <div className="grid place-items-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
        ) : devices.length === 0 ? (
          <div className="glass liquid-border grid place-items-center gap-2 rounded-2xl py-16 text-center">
            <TabletSmartphone className="h-10 w-10 text-muted-foreground" />
            <p className="text-muted-foreground">Aucune tablette provisionnée.</p>
          </div>
        ) : devices.map((d) => (
          <div key={d.id} className="glass liquid-border flex flex-wrap items-center justify-between gap-4 rounded-2xl p-5">
            <div className="flex items-center gap-3">
              <TabletSmartphone className="h-6 w-6 text-primary" />
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono font-semibold">{d.station_id}</span>
                  {statusBadge(d)}
                </div>
                <p className="text-sm text-muted-foreground">
                  {d.label ?? "—"} · vue {d.last_seen_at ? new Date(d.last_seen_at).toLocaleString("fr-CH") : "jamais"}
                  {d.token_expires_at ? ` · expire ${new Date(d.token_expires_at).toLocaleDateString("fr-CH")}` : ""}
                </p>
              </div>
            </div>
            {canWrite && (
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => rotate(d.id)} disabled={busy === `rotate-${d.id}`} className="gap-1 rounded-full">
                  {busy === `rotate-${d.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}Régénérer
                </Button>
                {!d.token_revoked && (
                  <Button variant="ghost" size="sm" onClick={() => revoke(d.id)} disabled={busy === `revoke-${d.id}`} className="gap-1 rounded-full text-destructive">
                    {busy === `revoke-${d.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ban className="h-3.5 w-3.5" />}Révoquer
                  </Button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
