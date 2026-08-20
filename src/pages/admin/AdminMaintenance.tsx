import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { ShieldCheck, RefreshCw, Loader2, Inbox, LockKeyhole, Radio, TriangleAlert } from "lucide-react";

const REQUEST_ROLES = new Set(["super_admin", "admin", "operations_admin", "support_agent"]);

type StationOption = {
  station_id: string;
  name: string | null;
  location_name: string | null;
  online: boolean | null;
  status: string | null;
};

type PreparedEjection = {
  permitId: string;
  batteryId: string;
  expiresAt: string;
};

export default function AdminMaintenance() {
  const { roles, canWrite } = useAuth();
  const canHandleRequests = roles.some((role) => REQUEST_ROLES.has(role));
  const [stationId, setStationId] = useState("");
  const [stations, setStations] = useState<StationOption[]>([]);
  const [stationsLoading, setStationsLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [requests, setRequests] = useState<Array<{
    id: string; request_type: string; name: string; email: string; station_id: string | null;
    organization: string | null; message: string; status: string; created_at: string;
  }>>([]);
  const [requestsLoading, setRequestsLoading] = useState(false);
  const [ejectionSlot, setEjectionSlot] = useState("1");
  const [ejectionBatteryId, setEjectionBatteryId] = useState("");
  const [ejectionConfirmation, setEjectionConfirmation] = useState("");
  const [preparedEjection, setPreparedEjection] = useState<PreparedEjection | null>(null);

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

  const selectedStation = stations.find((station) => station.station_id === stationId) ?? null;
  const maintenancePhrase = stationId && ejectionSlot ? `EJECTER ${stationId} SLOT ${ejectionSlot}` : "";

  const prepareEjection = async () => {
    if (!canWrite || !stationId || !ejectionSlot || !ejectionBatteryId.trim()) return;
    setBusy("prepare_eject_by_repair");
    setPreparedEjection(null);
    try {
      const { data, error } = await supabase.functions.invoke("admin-maintenance-action", {
        body: {
          actionType: "prepare_eject_by_repair", stationId,
          slotNum: Number(ejectionSlot), batteryId: ejectionBatteryId.trim().toUpperCase(),
        },
      });
      if (error || !data?.ok) {
        const detected = data?.detectedBatteryId ? ` La borne lit actuellement ${data.detectedBatteryId}.` : "";
        toast.error(`${data?.error ?? error?.message ?? "Préparation impossible"}.${detected}`);
        return;
      }
      setPreparedEjection({ permitId: data.permitId, batteryId: data.batteryId, expiresAt: data.expiresAt });
      toast.success("Batterie vérifiée. L’autorisation unique est prête pendant cinq minutes.");
    } finally {
      setBusy(null);
    }
  };

  const executeEjection = async () => {
    if (!canWrite || !preparedEjection || ejectionConfirmation !== maintenancePhrase) return;
    setBusy("eject_by_repair");
    try {
      const { data, error } = await supabase.functions.invoke("admin-maintenance-action", {
        body: {
          actionType: "eject_by_repair", stationId, slotNum: Number(ejectionSlot), permitId: preparedEjection.permitId,
        },
      });
      if (error || !data?.ok) {
        toast.error(data?.error ?? error?.message ?? "La commande n’a pas été envoyée.");
        return;
      }
      toast.success("Commande envoyée à ChargeNow. Vérifiez que la batterie est physiquement sortie avant toute autre action.");
      setPreparedEjection(null);
      setEjectionConfirmation("");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="animate-fade-in max-w-3xl space-y-6">
      <h1 className="font-display text-3xl font-bold">Maintenance</h1>
      <p className="text-muted-foreground">Support et diagnostics non destructifs. Les mutations physiques génériques ne sont pas exposées comme boutons ordinaires.</p>

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

          <section className="space-y-4 rounded-2xl border border-warning/40 bg-warning/5 p-6">
            <h2 className="font-display text-lg font-bold"><TriangleAlert className="mr-2 inline h-5 w-5 text-warning" />Éjection de maintenance ponctuelle</h2>
            <p className="text-sm text-muted-foreground">Réservée à une batterie bloquée. Cette action ne crée aucune location, ne touche aucun paiement, et ne peut viser qu’une batterie détectée dans un slot précis.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm text-muted-foreground">Emplacement
                <input value={ejectionSlot} onChange={(event) => { setEjectionSlot(event.target.value); setPreparedEjection(null); }} inputMode="numeric" min="1" max="128" type="number" className="mt-1 h-11 w-full rounded-md border border-input bg-background px-3 text-foreground" />
              </label>
              <label className="text-sm text-muted-foreground">Identifiant batterie détecté
                <input value={ejectionBatteryId} onChange={(event) => { setEjectionBatteryId(event.target.value.toUpperCase()); setPreparedEjection(null); }} placeholder="ex. F0F0004944" className="mt-1 h-11 w-full rounded-md border border-input bg-background px-3 text-foreground" />
              </label>
            </div>
            {!preparedEjection ? (
              <Button onClick={() => void prepareEjection()} disabled={!!busy || !stationId || !ejectionBatteryId.trim() || !ejectionSlot} variant="outline" className="gap-2 border-warning/50">
                {busy === "prepare_eject_by_repair" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}Vérifier puis préparer l’éjection
              </Button>
            ) : (
              <div className="space-y-3 rounded-xl border border-warning/40 bg-background/60 p-4">
                <p className="text-sm">Vérifié : <strong>{preparedEjection.batteryId}</strong> · slot {ejectionSlot}. L’autorisation expire à {new Date(preparedEjection.expiresAt).toLocaleTimeString("fr-CH", { hour: "2-digit", minute: "2-digit" })}.</p>
                <label className="block text-sm text-muted-foreground">Pour envoyer l’unique commande, saisissez exactement <code className="select-all">{maintenancePhrase}</code>.
                  <input value={ejectionConfirmation} onChange={(event) => setEjectionConfirmation(event.target.value)} className="mt-1 h-11 w-full rounded-md border border-input bg-background px-3 text-foreground" />
                </label>
                <Button onClick={() => void executeEjection()} disabled={!!busy || ejectionConfirmation !== maintenancePhrase} className="gap-2 bg-warning text-warning-foreground hover:bg-warning/90">
                  {busy === "eject_by_repair" ? <Loader2 className="h-4 w-4 animate-spin" /> : <TriangleAlert className="h-4 w-4" />}Éjecter uniquement cette batterie
                </Button>
              </div>
            )}
          </section>
        </>
      )}

      <section className="rounded-2xl border border-primary/25 bg-primary/5 p-6">
        <h2 className="font-display text-lg font-bold"><Radio className="mr-2 inline h-5 w-5" />Event Push ChargeNow</h2>
        <p className="mt-2 text-sm text-muted-foreground">Le webhook global est géré centralement et n’est plus modifiable depuis cette page. Consultez <Link className="text-primary underline" to="/admin/api-health">Santé API</Link> pour son état réel.</p>
      </section>

      <section className="rounded-2xl border border-warning/35 bg-warning/5 p-6">
        <h2 className="font-display text-lg font-bold"><LockKeyhole className="mr-2 inline h-5 w-5" />Actions physiques verrouillées</h2>
        <p className="mt-2 text-sm text-muted-foreground">POP et configuration fournisseur générique sont bloqués par design. L’éjection de maintenance ci-dessus impose une vérification fournisseur, une autorisation de cinq minutes, une confirmation écrite et une cible unique.</p>
      </section>
    </div>
  );
}
