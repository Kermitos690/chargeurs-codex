import { useEffect, useState, useCallback, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { QRCodeSVG } from "qrcode.react";
import { RefreshCw, Loader2, Wifi, WifiOff, Battery, TabletSmartphone, Copy, Ban, AlertTriangle, CircleCheck, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { stationConnectionLabel, stationConnectionState } from "@/lib/stationConnection";

type KioskDevice = {
  id: string; station_id: string; label: string | null; active: boolean;
  token_revoked: boolean; last_seen_at: string | null; app_version: string | null;
  enrolled_at: string | null; device_public_id: string | null;
};

type PairingReveal = {
  pairingCodeId: string; pairingCode: string; createdAt: string; expiresAt: string;
  stationId: string; organizationName: string;
};

type SlotDiagnostic = {
  slot_num: number; battery_id: string | null; battery_present: boolean | null;
  charge_percent: number | null; temperature_c: number | null; online: boolean | null;
  health_status: string | null; self_check: string; error_code: string | null;
  fault_type: string | null; fault_cause: string | null; rentable: boolean;
  confidence: string; customer_status: string; source_timestamps: Record<string, string>;
  age_seconds: number | null; conflicts: string[]; diagnostic_flags: string[];
};

const statusLabel = (status: string) => ({
  ready: "Prête", recommended: "Recommandée", charging: "En recharge",
  checking: "Vérification", unavailable: "Indisponible",
  return_available: "Libre pour un retour", technical_issue: "Problème technique", maintenance: "Maintenance",
}[status] ?? status);

const diagnosticLabel = (flag: string) => ({
  zero_charge_reported: "charge signalée à 0 % : location bloquée",
  battery_id: "identifiants batterie contradictoires",
  charge_percent: "niveaux de charge contradictoires",
  battery_present: "présence de batterie contradictoire",
  online: "états réseau contradictoires",
}[flag] ?? flag);

const needsOperatorAlert = (slot: SlotDiagnostic) =>
  ["technical_issue", "maintenance"].includes(slot.customer_status) ||
  slot.diagnostic_flags.length > 0 || slot.conflicts.length > 0 ||
  Boolean(slot.error_code || slot.fault_type || slot.fault_cause);

export default function AdminStationDetail() {
  const { stationId } = useParams();
  const { canWrite } = useAuth();
  const [station, setStation] = useState<any>(null);
  const [slots, setSlots] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [rental, setRental] = useState<any>(null);
  const [syncing, setSyncing] = useState(false);
  const [kiosks, setKiosks] = useState<KioskDevice[]>([]);
  const [pairing, setPairing] = useState<PairingReveal | null>(null);
  const [provisioning, setProvisioning] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<SlotDiagnostic[]>([]);

  const load = useCallback(async () => {
    const [{ data: st }, { data: sl }, { data: ev }, { data: rt }, { data: kd }, { data: snapshot }] = await Promise.all([
      supabase.from("stations").select("*").eq("station_id", stationId).maybeSingle(),
      supabase.from("slots").select("*").eq("station_id", stationId).order("slot_num"),
      supabase.from("cabinet_events").select("*").eq("station_id", stationId).order("received_at", { ascending: false }).limit(8),
      supabase.from("rental_sessions").select("*").eq("station_id", stationId).in("state", ["active_rental", "battery_taken", "ejected"]).order("created_at", { ascending: false }).limit(1),
      supabase.functions.invoke("kiosk-admin", { body: { action: "list" } }),
      supabase.functions.invoke("cabinet-slot-diagnostics", { body: { stationId } }),
    ]);
    setStation(st); setSlots(sl ?? []); setEvents(ev ?? []); setRental(rt?.[0] ?? null);
    setKiosks(((kd as { devices?: KioskDevice[] } | null)?.devices ?? []).filter((device) => device.station_id === stationId));
    setDiagnostics(((snapshot as { slots?: SlotDiagnostic[] } | null)?.slots ?? []));
  }, [stationId]);
  useEffect(() => { load(); }, [load]);

  const sync = async () => {
    setSyncing(true);
    const { data } = await supabase.functions.invoke("sync-cabinet-status", { body: { stationId } });
    if ((data as any)?.configured === false) toast.error("API ChargeNow non configurée");
    else toast.success("Synchronisé");
    await load(); setSyncing(false);
  };

  const createPairing = async () => {
    if (!stationId) return;
    setProvisioning(true);
    const { data, error } = await supabase.functions.invoke("kiosk-admin", {
      body: { action: "create_pairing_code", stationId, label: `Station ${stationId}`, ttlMinutes: 10 },
    });
    setProvisioning(false);
    if (error || !data?.ok) { toast.error(data?.error ?? error?.message ?? "Création du code impossible"); return; }
    setPairing(data as PairingReveal);
    toast.success("Code temporaire généré : une seule tablette peut l’utiliser.");
    await load();
  };

  const revokeKiosk = async (deviceId: string) => {
    setRevoking(deviceId);
    const { data, error } = await supabase.functions.invoke("kiosk-admin", { body: { action: "revoke", deviceId } });
    setRevoking(null);
    if (error || !data?.ok) { toast.error(data?.error ?? error?.message ?? "Révocation impossible"); return; }
    toast.success("Kiosk révoqué — il ne peut plus demander de configuration.");
    await load();
  };

  const enrollmentUrl = pairing ? `${import.meta.env.VITE_SUPABASE_URL ?? ""}/functions/v1/kiosk-enroll` : "";

  if (!station) return <Loader2 className="h-8 w-8 animate-spin text-primary" />;
  const connection = stationConnectionState(station);
  const isOnline = connection === "online";
  const activeAlerts = diagnostics.filter(needsOperatorAlert);

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="font-mono text-sm text-muted-foreground">{station.station_id}</p>
          <h1 className="font-display text-3xl font-bold">{station.name}</h1>
          <p className="text-muted-foreground">{station.location_name}</p>
        </div>
        <Button onClick={sync} disabled={syncing} className="gap-2 rounded-full bg-gradient-primary">
          {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}Synchroniser
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <Info label="Statut fournisseur" value={stationConnectionLabel(station)} icon={isOnline ? Wifi : WifiOff} tone={isOnline ? "text-success" : connection === "unknown" ? "text-warning" : "text-muted-foreground"} />
        <Info label="Signal" value={station.signal ?? "—"} />
        <Info label="Disponibles" value={station.rentable_count} />
        <Info label="Dernière sync" value={station.last_sync_at ? new Date(station.last_sync_at).toLocaleTimeString() : "—"} />
      </div>

      <section className="glass liquid-border rounded-2xl p-6">
        <h2 className="mb-4 font-display text-xl font-bold">Carte des emplacements</h2>
        {slots.length === 0 ? (
          <p className="text-muted-foreground">Aucune donnée d'emplacement (synchronisation requise).</p>
        ) : (
          <div className="grid grid-cols-4 gap-3 sm:grid-cols-8">
            {slots.map((sl) => (
              <div key={sl.slot_num} className={cn("flex flex-col items-center gap-1 rounded-xl p-3",
                sl.battery_id ? "bg-success/15" : "bg-muted/50")}>
                <Battery className={cn("h-6 w-6", sl.battery_id ? "text-success" : "text-muted-foreground")} />
                <span className="text-xs font-bold">#{sl.slot_num}</span>
                <span className="truncate text-[10px] text-muted-foreground">{sl.battery_id ?? "vide"}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className={cn("rounded-2xl border p-5", activeAlerts.length ? "border-warning/45 bg-warning/10" : "border-success/35 bg-success/10")}>
        <div className="flex items-start gap-3">
          {activeAlerts.length ? <AlertTriangle className="mt-0.5 h-6 w-6 shrink-0 text-warning" /> : <CircleCheck className="mt-0.5 h-6 w-6 shrink-0 text-success" />}
          <div>
            <h2 className="font-display text-xl font-bold">Alertes actives de la borne</h2>
            <p className="text-sm text-muted-foreground">Vue opérateur basée sur le snapshot fournisseur le plus récent. Un slot libre pour un retour n’est pas une alerte.</p>
          </div>
        </div>
        {activeAlerts.length ? <div className="mt-4 grid gap-2 md:grid-cols-2">{activeAlerts.map((slot) => (
          <div key={slot.slot_num} className="rounded-xl border border-warning/30 bg-background/35 p-3 text-sm">
            <div className="font-bold">Slot {slot.slot_num} — {statusLabel(slot.customer_status)}</div>
            <div className="mt-1 text-muted-foreground">{[...slot.diagnostic_flags, ...slot.conflicts, slot.error_code, slot.fault_type, slot.fault_cause].filter(Boolean).map(diagnosticLabel).join(" · ") || "Contrôle opérateur requis"}</div>
            <div className="mt-1 text-xs text-muted-foreground">Âge : {slot.age_seconds == null ? "inconnu" : `${slot.age_seconds}s`} · confiance : {slot.confidence}</div>
          </div>
        ))}</div> : <p className="mt-3 text-sm text-success">Aucune anomalie active dans le dernier snapshot. Les emplacements vides sont suivis comme retours possibles.</p>}
      </section>

      <section className="glass liquid-border rounded-2xl p-6">
        <div className="mb-4"><h2 className="font-display text-xl font-bold">Diagnostic fournisseur par slot</h2><p className="text-sm text-muted-foreground">Vue technique multi-source, en lecture seule. Les données ambiguës ne rendent jamais une batterie louable.</p></div>
        {diagnostics.length === 0 ? <p className="text-muted-foreground">Aucun snapshot technique récent. Utilisez Synchroniser ou vérifiez l’accès fournisseur.</p> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[980px] text-left text-sm"><thead className="border-b border-border text-muted-foreground"><tr><th className="p-2">Slot</th><th className="p-2">Batterie</th><th className="p-2">Charge</th><th className="p-2">Temp.</th><th className="p-2">État</th><th className="p-2">Self-check</th><th className="p-2">Confiance</th><th className="p-2">Âge</th><th className="p-2">Louable</th><th className="p-2">Anomalies</th></tr></thead><tbody>
            {diagnostics.map((slot) => <tr key={slot.slot_num} className="border-b border-border/50 align-top"><td className="p-2 font-bold">{slot.slot_num}</td><td className="p-2 font-mono text-xs">{slot.battery_id ?? "—"}</td><td className="p-2">{slot.customer_status === "return_available" ? "— (retour)" : slot.charge_percent == null ? "non interprété" : `${Math.round(slot.charge_percent)} %`}</td><td className="p-2">{slot.temperature_c == null ? "—" : `${slot.temperature_c.toFixed(1)} °C`}</td><td className="p-2">{statusLabel(slot.customer_status)}</td><td className="p-2">{slot.self_check}</td><td className="p-2">{slot.confidence}</td><td className="p-2">{slot.age_seconds == null ? "—" : `${slot.age_seconds}s`}</td><td className="p-2">{slot.rentable ? "oui" : "non"}</td><td className="p-2 text-xs text-warning">{[...slot.diagnostic_flags, ...slot.conflicts, slot.error_code, slot.fault_type, slot.fault_cause].filter(Boolean).map(diagnosticLabel).join(" · ") || "—"}</td></tr>)}
          </tbody></table></div>
        )}
      </section>

      <section className="glass liquid-border rounded-2xl p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 font-display text-xl font-bold"><TabletSmartphone className="h-5 w-5" /> Kiosk attribué</h2>
            <p className="text-sm text-muted-foreground">L’attribution est initiée par cette borne. La tablette ne choisit jamais librement une station.</p>
          </div>
          {canWrite && <Button onClick={createPairing} disabled={provisioning} className="gap-2 rounded-full bg-gradient-primary">
            {provisioning ? <Loader2 className="h-4 w-4 animate-spin" /> : <TabletSmartphone className="h-4 w-4" />}Attribuer un kiosk
          </Button>}
        </div>
        {kiosks.length === 0 ? <p className="text-sm text-muted-foreground">Aucun kiosk actif n’est encore attribué à cette borne.</p> : (
          <div className="space-y-2">{kiosks.map((device) => (
            <div key={device.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-3 text-sm">
              <div><strong>{device.label ?? "Tablette sans libellé"}</strong><span className="ml-2 font-mono text-xs text-muted-foreground">{device.device_public_id ? "identité Keystore enregistrée" : "en attente d’enrôlement"}</span><div className="text-xs text-muted-foreground">APK {device.app_version ?? "—"} · dernière activité {device.last_seen_at ? new Date(device.last_seen_at).toLocaleString() : "—"}</div></div>
              {canWrite && device.active && !device.token_revoked && <Button variant="outline" size="sm" onClick={() => revokeKiosk(device.id)} disabled={revoking === device.id} className="gap-1"><Ban className="h-3.5 w-3.5" />Révoquer</Button>}
            </div>
          ))}</div>
        )}
        {pairing && (
          <div className="mt-5 grid gap-4 rounded-xl border border-primary/30 bg-primary/5 p-4 md:grid-cols-[auto_1fr]">
            <QRCodeSVG value={pairing.pairingCode} size={144} includeMargin />
            <div className="space-y-2"><p className="font-semibold">Code numérique à usage unique lié à {pairing.stationId}</p><code className="block rounded bg-background p-3 text-2xl tracking-[0.3em]">{pairing.pairingCode}</code><p className="text-xs text-muted-foreground">Expire le {new Date(pairing.expiresAt).toLocaleString()} · Organisation : {pairing.organizationName}</p><p className="text-xs text-muted-foreground">Saisissez les six chiffres sur le pavé tactile de l’APK. Le QR reste une option technique secondaire. Endpoint : {enrollmentUrl || "configuré dans l’APK"}</p><Button size="sm" variant="outline" onClick={() => navigator.clipboard.writeText(pairing.pairingCode).then(() => toast.success("Code copié"))} className="gap-1"><Copy className="h-3.5 w-3.5" />Copier le code</Button></div>
          </div>
        )}
      </section>

      {rental && (
        <section className="glass liquid-border rounded-2xl p-6">
          <h2 className="mb-2 font-display text-xl font-bold">Location active</h2>
          <p className="font-mono text-sm">{rental.id}</p>
          <p className="text-muted-foreground">État : {rental.state} · slot {rental.selected_slot_num ?? "—"}</p>
        </section>
      )}

      <section className="glass liquid-border rounded-2xl p-6">
        <h2 className="mb-4 font-display text-xl font-bold">Derniers événements</h2>
        {events.length === 0 ? <p className="text-muted-foreground">Aucun événement reçu.</p> : (
          <ul className="space-y-2">
            {events.map((e) => (
              <li key={e.id} className="flex items-center justify-between border-b border-border/50 pb-2 text-sm">
                <span className="font-medium">{e.event_type}</span>
                <span className="text-muted-foreground">{new Date(e.received_at).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Info({ label, value, icon: Icon, tone }: { label: string; value: ReactNode; icon?: LucideIcon; tone?: string }) {
  return (
    <div className="glass rounded-2xl p-5">
      {Icon && <Icon className={cn("mb-2 h-5 w-5", tone)} />}
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-sm text-muted-foreground">{label}</div>
    </div>
  );
}
