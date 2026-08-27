import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { BatteryCharging, Inbox, Loader2, LockKeyhole, Radio, RefreshCw, ShieldCheck } from "lucide-react";

const REQUEST_ROLES = new Set(["super_admin", "admin", "operations_admin", "support_agent"]);

type StationOption = {
  station_id: string;
  name: string | null;
  location_name: string | null;
  online: boolean | null;
  status: string | null;
};

type MaintenancePermit = {
  permitId: string;
  stationId: string;
  slotNum: number;
  batteryId: string;
  slotUpdatedAt: string | null;
  expiresAt: string;
  confirmation: string;
};

export default function AdminMaintenance() {
  const { roles, canWrite, isSuperAdmin } = useAuth();
  const canHandleRequests = roles.some((role) => REQUEST_ROLES.has(role));
  const [stationId, setStationId] = useState("");
  const [stations, setStations] = useState<StationOption[]>([]);
  const [stationsLoading, setStationsLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [slotNum, setSlotNum] = useState("1");
  const [permit, setPermit] = useState<MaintenancePermit | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [requests, setRequests] = useState<Array<{
    id: string; request_type: string; name: string; email: string; station_id: string | null;
    organization: string | null; message: string; status: string; created_at: string;
  }>>([]);
  const [requestsLoading, setRequestsLoading] = useState(false);

  const loadRequests = useCallback(async () => {
    if (!canHandleRequests) { setRequests([]); return; }
    setRequestsLoading(true);
    try {
      const db = supabase as any;
      const { data, error } = await db.from("public_contact_requests")
        .select("id,request_type,name,email,station_id,organization,message,status,created_at")
        .in("status", ["new", "in_progress"])
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) { toast.error("Les demandes support ne sont pas disponibles pour ce rôle."); setRequests([]); }
      else setRequests(data ?? []);
    } finally {
      setRequestsLoading(false);
    }
  }, [canHandleRequests]);

  const loadStations = useCallback(async () => {
    if (!canWrite) { setStations([]); setStationId(""); return; }
    setStationsLoading(true);
    try {
      const { data, error } = await supabase.from("stations")
        .select("station_id,name,location_name,online,status")
        .order("station_id");
      if (error) {
        toast.error("Impossible de charger la liste des bornes.");
        return;
      }
      const next = (data ?? []) as StationOption[];
      setStations(next);
      setStationId((current) => {
        if (current && next.some((station) => station.station_id === current)) return current;
        return next.find((station) => station.online === true)?.station_id ?? next[0]?.station_id ?? "";
      });
    } finally {
      setStationsLoading(false);
    }
  }, [canWrite]);

  useEffect(() => { void loadRequests(); }, [loadRequests]);
  useEffect(() => { void loadStations(); }, [loadStations]);
  useEffect(() => { setPermit(null); setConfirmation(""); }, [stationId, slotNum]);

  const setRequestStatus = async (id: string, status: "in_progress" | "resolved") => {
    if (!canHandleRequests) return;
    const db = supabase as any;
    const { error } = await db.from("public_contact_requests").update({
      status,
      resolved_at: status === "resolved" ? new Date().toISOString() : null,
    }).eq("id", id);
    if (error) toast.error("La demande n'a pas pu être mise à jour.");
    else { toast.success("Demande mise à jour"); await loadRequests(); }
  };

  const call = async (actionType: "test_auth" | "sync_status") => {
    if (!canWrite) return;
    if (!stationId.trim()) { toast.error("Sélectionnez une borne."); return; }
    setBusy(actionType);
    try {
      const { data, error } = await supabase.functions.invoke("admin-maintenance-action", {
        body: { actionType, stationId: stationId.trim() },
      });
      if (error || !data?.ok) {
        const code = data?.error ?? error?.message ?? "Échec";
        toast.error(code === "CHARGENOW_NOT_CONFIGURED" ? "ChargeNow n’est pas configuré." : code);
      } else {
        toast.success(actionType === "test_auth" ? "Authentification ChargeNow validée" : "État fournisseur lu avec succès");
      }
    } finally {
      setBusy(null);
    }
  };

  const prepareMaintenanceEjection = async () => {
    if (!isSuperAdmin || !stationId) return;
    const slot = Number(slotNum);
    if (!Number.isInteger(slot) || slot < 1 || slot > 128) {
      toast.error("Choisissez un slot entre 1 et 128. Le slot 0 est interdit.");
      return;
    }
    setBusy("prepare_eject_by_repair");
    setPermit(null);
    setConfirmation("");
    try {
      const { data, error } = await supabase.functions.invoke("admin-maintenance-action", {
        body: { actionType: "prepare_eject_by_repair", stationId, slotNum: slot },
      });
      if (error || !data?.ok) {
        toast.error(data?.error ?? error?.message ?? "Préparation de l’éjection impossible");
        return;
      }
      setPermit(data as MaintenancePermit);
      toast.success(`Permis créé pour ${data.batteryId} — valable 5 minutes.`);
    } finally {
      setBusy(null);
    }
  };

  const executeMaintenanceEjection = async () => {
    if (!isSuperAdmin || !permit) return;
    if (confirmation.trim().toUpperCase() !== permit.confirmation) {
      toast.error("La phrase de confirmation ne correspond pas exactement.");
      return;
    }
    setBusy("execute_eject_by_repair");
    try {
      const { data, error } = await supabase.functions.invoke("admin-maintenance-action", {
        body: {
          actionType: "execute_eject_by_repair",
          permitId: permit.permitId,
          confirmation: confirmation.trim(),
        },
      });
      if (error || !data?.ok) {
        toast.error(data?.error ?? error?.message ?? "Éjection maintenance refusée");
        return;
      }
      toast.success(`Commande C2 envoyée pour ${permit.batteryId}. Vérifiez la sortie physique avant toute autre action.`);
      setPermit(null);
      setConfirmation("");
    } finally {
      setBusy(null);
    }
  };

  const selectedStation = stations.find((station) => station.station_id === stationId) ?? null;

  return (
    <div className="animate-fade-in max-w-3xl space-y-6">
      <h1 className="font-display text-3xl font-bold">Maintenance</h1>
      <p className="text-muted-foreground">Support, diagnostics et atelier matériel. Les commandes physiques restent ciblées, super-admin et auditées.</p>

      {canHandleRequests ? (
        <section className="glass liquid-border space-y-4 rounded-2xl p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-display text-lg font-bold"><Inbox className="mr-2 inline h-5 w-5" />Demandes support et partenaires</h2>
            <Button variant="ghost" size="sm" onClick={() => void loadRequests()} disabled={requestsLoading}><RefreshCw className={`mr-2 h-4 w-4 ${requestsLoading ? "animate-spin" : ""}`} />Actualiser</Button>
          </div>
          {requestsLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : requests.length === 0 ? <p className="text-sm text-muted-foreground">Aucune demande ouverte.</p> : requests.map((request) => (
            <article key={request.id} className="rounded-xl border border-border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><p className="font-semibold">{request.name} · {request.request_type === "support" ? "Support" : "Installation partenaire"}</p><p className="text-sm text-muted-foreground">{request.email} · {new Date(request.created_at).toLocaleString("fr-CH")}</p>{(request.station_id || request.organization) && <p className="mt-1 text-sm">{request.station_id ?? request.organization}</p>}</div>
                <span className="rounded-full bg-muted px-2.5 py-1 text-xs">{request.status}</span>
              </div>
              <p className="mt-3 whitespace-pre-wrap text-sm">{request.message}</p>
              <div className="mt-4 flex gap-2">{request.status === "new" && <Button size="sm" variant="outline" onClick={() => void setRequestStatus(request.id, "in_progress")}>Prendre en charge</Button>}<Button size="sm" onClick={() => void setRequestStatus(request.id, "resolved")}>Marquer résolue</Button></div>
            </article>
          ))}
        </section>
      ) : (
        <section className="glass rounded-2xl p-5 text-sm text-muted-foreground">Votre rôle n’a pas accès aux demandes support. Aucun bouton de modification n’est affiché.</section>
      )}

      {canWrite && (
        <>
          <section className="glass liquid-border rounded-2xl p-6">
            <label htmlFor="maintenance-station" className="text-sm text-muted-foreground">Borne</label>
            <div className="mt-2 flex gap-2">
              <select
                id="maintenance-station"
                value={stationId}
                onChange={(event) => setStationId(event.target.value)}
                disabled={stationsLoading || stations.length === 0}
                className="h-11 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-sm outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              >
                {stations.length === 0 && <option value="">Aucune borne disponible</option>}
                {stations.map((station) => (
                  <option key={station.station_id} value={station.station_id}>
                    {station.station_id} — {station.name ?? station.location_name ?? "Borne Chargeurs.ch"}
                  </option>
                ))}
              </select>
              <Button type="button" variant="outline" onClick={() => void loadStations()} disabled={stationsLoading} className="gap-2">
                {stationsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}Actualiser
              </Button>
            </div>
            {selectedStation && (
              <p className="mt-3 text-xs text-muted-foreground">
                {selectedStation.location_name ?? "Emplacement non renseigné"} · {selectedStation.online ? "en ligne" : "hors ligne"} · état {selectedStation.status ?? "inconnu"}
              </p>
            )}
          </section>

          <section className="glass liquid-border space-y-3 rounded-2xl p-6">
            <h2 className="font-display text-lg font-bold text-success"><ShieldCheck className="mr-2 inline h-5 w-5" />Diagnostics sûrs</h2>
            <div className="flex flex-wrap gap-3">
              <Button onClick={() => void call("test_auth")} disabled={!!busy || !stationId} variant="ghost" className="gap-2 border border-border">{busy === "test_auth" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}Tester l'authentification API</Button>
              <Button onClick={() => void call("sync_status")} disabled={!!busy || !stationId} variant="ghost" className="gap-2 border border-border">{busy === "sync_status" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}Lire l’état fournisseur</Button>
            </div>
          </section>
        </>
      )}

      {isSuperAdmin && (
        <section className="rounded-2xl border border-warning/40 bg-warning/5 p-6">
          <h2 className="font-display text-lg font-bold"><BatteryCharging className="mr-2 inline h-5 w-5" />Atelier — éjection maintenance C2</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Une seule batterie par commande. Aucun paiement et aucune location ne sont créés. Le backend vérifie la batterie présente, interdit le slot 0 et consomme le permis avant l’appel fournisseur.
          </p>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="w-full sm:w-32">
              <label htmlFor="maintenance-slot" className="text-sm text-muted-foreground">Slot</label>
              <Input id="maintenance-slot" type="number" min={1} max={128} step={1} value={slotNum} onChange={(event) => setSlotNum(event.target.value)} />
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={!!busy || !stationId}
              onClick={() => void prepareMaintenanceEjection()}
              className="gap-2"
            >
              {busy === "prepare_eject_by_repair" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              Préparer l’éjection
            </Button>
          </div>

          {permit && (
            <div className="mt-5 space-y-4 rounded-xl border border-warning/35 bg-background/60 p-4">
              <div className="text-sm">
                <p><strong>Borne :</strong> {permit.stationId} · <strong>slot :</strong> {permit.slotNum}</p>
                <p><strong>Batterie verrouillée :</strong> <span className="font-mono">{permit.batteryId}</span></p>
                <p className="text-xs text-muted-foreground">Permis valable jusqu’à {new Date(permit.expiresAt).toLocaleTimeString("fr-CH")}.</p>
              </div>
              <div>
                <label htmlFor="maintenance-confirmation" className="text-sm text-muted-foreground">Recopiez exactement pour confirmer</label>
                <p className="mt-1 select-all font-mono text-sm font-semibold">{permit.confirmation}</p>
                <Input
                  id="maintenance-confirmation"
                  className="mt-2 font-mono"
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  autoComplete="off"
                />
              </div>
              <Button
                type="button"
                disabled={!!busy || confirmation.trim().toUpperCase() !== permit.confirmation}
                onClick={() => void executeMaintenanceEjection()}
                className="gap-2"
              >
                {busy === "execute_eject_by_repair" ? <Loader2 className="h-4 w-4 animate-spin" /> : <BatteryCharging className="h-4 w-4" />}
                Éjecter cette batterie — maintenance
              </Button>
            </div>
          )}
        </section>
      )}

      <section className="rounded-2xl border border-primary/25 bg-primary/5 p-6">
        <h2 className="font-display text-lg font-bold"><Radio className="mr-2 inline h-5 w-5" />Event Push ChargeNow</h2>
        <p className="mt-2 text-sm text-muted-foreground">Le webhook global est géré centralement et n’est plus modifiable depuis cette page. Consultez <Link className="text-primary underline" to="/admin/api-health">Santé API</Link> pour son état réel.</p>
      </section>

      <section className="rounded-2xl border border-warning/35 bg-warning/5 p-6">
        <h2 className="font-display text-lg font-bold"><LockKeyhole className="mr-2 inline h-5 w-5" />Actions physiques protégées</h2>
        <p className="mt-2 text-sm text-muted-foreground">POP, éjection multiple et configuration fournisseur générique restent bloqués. Seul C2 maintenance peut être exécuté par un super-admin avec un permis court, ciblé sur une borne, un slot et la batterie réellement observée.</p>
      </section>
    </div>
  );
}
