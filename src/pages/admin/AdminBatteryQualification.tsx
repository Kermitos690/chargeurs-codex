import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  AlertTriangle,
  BatteryCharging,
  CheckCircle2,
  Gauge,
  Loader2,
  RefreshCw,
  ShieldCheck,
  TestTube2,
  XCircle,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

type BatteryRow = {
  battery_id: string;
  station_id: string | null;
  slot_num: number | null;
  status: string | null;
  power_level: number | null;
  model_code: string | null;
  rated_capacity_mah: number | null;
  measured_capacity_mah: number | null;
  measured_energy_wh: number | null;
  qualification_status: string;
  capacity_confidence: string;
  commercial_tier: string;
  pricing_eligible: boolean;
  qualified_at: string | null;
  quarantine_reason: string | null;
};

type RunRow = {
  id: string;
  state: string;
  requested_slot_num: number | null;
  expected_battery_id: string | null;
  observed_slot_num: number | null;
  observed_battery_id: string | null;
  provider_trade_no: string | null;
  failure_code: string | null;
  failure_message: string | null;
  created_at: string;
  completed_at: string | null;
};

type Dashboard = {
  station: {
    station_id: string;
    status: string;
    online: boolean;
    rentable_count: number;
    returnable_count: number;
    total_count: number;
    last_sync_at: string | null;
    qualification_mode: string;
  } | null;
  batteries: BatteryRow[];
  runs: RunRow[];
  campaign: {
    inventoryCount: number;
    physicallyCycledCount: number;
    externallyVerifiedCount: number;
    labelVerifiedCount: number;
    pricingEligibleCount: number;
    quarantinedCount: number;
  };
  guards: {
    fixedStationId: string;
    providerConfigured: boolean;
    providerMode: string;
    providerMutationsEnabled: boolean;
    freePayEnvironmentEnabled: boolean;
    stripeUsed: boolean;
  };
};

const activeStates = new Set([
  "created",
  "inventory_confirmed",
  "order_created",
  "ejection_requested",
  "ejection_confirmed",
  "battery_taken",
  "needs_reconciliation",
]);

function formatDate(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString("fr-CH") : "—";
}

function statusVariant(status: string) {
  if (["completed", "verified"].includes(status)) return "default" as const;
  if (["failed", "quarantined", "needs_reconciliation"].includes(status)) return "destructive" as const;
  return "secondary" as const;
}

function Guard({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-border p-3 text-sm">
      {ok ? <CheckCircle2 className="h-4 w-4 text-success" /> : <XCircle className="h-4 w-4 text-destructive" />}
      <span>{label}</span>
    </div>
  );
}

export default function AdminBatteryQualification() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [selectedBatteryId, setSelectedBatteryId] = useState("");
  const [method, setMethod] = useState("label_verification");
  const [modelCode, setModelCode] = useState("");
  const [ratedCapacityMah, setRatedCapacityMah] = useState("");
  const [measuredCapacityMah, setMeasuredCapacityMah] = useState("");
  const [measuredEnergyWh, setMeasuredEnergyWh] = useState("");
  const [meterReference, setMeterReference] = useState("");
  const [notes, setNotes] = useState("");
  const [quarantineReason, setQuarantineReason] = useState("");

  const invoke = useCallback(async (action: string, extra: Record<string, unknown> = {}, quiet = false) => {
    setBusy(action);
    try {
      const { data, error } = await supabase.functions.invoke("dta-pilot-qualification", {
        body: { action, ...extra },
      });
      if (error || !data?.ok) {
        const code = data?.error ?? error?.message ?? "DTA_QUALIFICATION_FAILED";
        if (!quiet) toast.error(code);
        return data ?? null;
      }
      if (data.station || data.campaign) setDashboard(data as Dashboard);
      if (!quiet) toast.success(action === "sync" ? "Inventaire DTA21269 synchronisé" : "Action enregistrée");
      return data;
    } finally {
      setBusy(null);
    }
  }, []);

  const load = useCallback(async () => {
    const data = await invoke("status", {}, true);
    if (data?.ok) setDashboard(data as Dashboard);
  }, [invoke]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!selectedBatteryId && dashboard?.batteries[0]?.battery_id) {
      setSelectedBatteryId(dashboard.batteries[0].battery_id);
    }
  }, [dashboard, selectedBatteryId]);

  const activeRun = useMemo(
    () => dashboard?.runs.find((run) => activeStates.has(run.state)) ?? null,
    [dashboard],
  );

  const guardsReady = Boolean(
    dashboard?.guards.providerConfigured
      && dashboard.guards.providerMode === "test"
      && dashboard.guards.providerMutationsEnabled
      && dashboard.guards.freePayEnvironmentEnabled
      && dashboard.station?.qualification_mode === "freepay_test",
  );

  const recordMeasurement = async () => {
    if (!selectedBatteryId) return toast.error("Sélectionnez une batterie.");
    const external = ["usb_load_meter", "bench_discharge"].includes(method);
    if (external && !measuredCapacityMah && !measuredEnergyWh) {
      return toast.error("Une mesure externe en mAh ou Wh est obligatoire.");
    }
    const data = await invoke("record_measurement", {
      batteryId: selectedBatteryId,
      method,
      modelCode: modelCode || null,
      ratedCapacityMah: ratedCapacityMah ? Number(ratedCapacityMah) : null,
      measuredCapacityMah: measuredCapacityMah ? Number(measuredCapacityMah) : null,
      measuredEnergyWh: measuredEnergyWh ? Number(measuredEnergyWh) : null,
      meterReference: meterReference || null,
      notes: notes || null,
    });
    if (data?.ok) {
      setModelCode("");
      setRatedCapacityMah("");
      setMeasuredCapacityMah("");
      setMeasuredEnergyWh("");
      setMeterReference("");
      setNotes("");
    }
  };

  const quarantine = async () => {
    if (!selectedBatteryId || !quarantineReason.trim()) return toast.error("La batterie et le motif sont obligatoires.");
    const data = await invoke("quarantine", {
      batteryId: selectedBatteryId,
      reason: quarantineReason.trim(),
    });
    if (data?.ok) setQuarantineReason("");
  };

  if (!dashboard) {
    return <div className="grid min-h-64 place-items-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  const { station, campaign, guards, batteries, runs } = dashboard;

  return (
    <div className="animate-fade-in space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold">Qualification batteries DTA21269</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Campagne FreePay sans Stripe : inventaire, éjection, retour, mesure de capacité et quarantaine batterie par batterie.
          </p>
        </div>
        <Button variant="outline" onClick={() => invoke("sync")} disabled={busy !== null}>
          {busy === "sync" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Synchroniser
        </Button>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="glass rounded-2xl p-5"><p className="text-sm text-muted-foreground">Inventoriées</p><p className="mt-2 text-3xl font-bold">{campaign.inventoryCount}</p></div>
        <div className="glass rounded-2xl p-5"><p className="text-sm text-muted-foreground">Cycles physiques terminés</p><p className="mt-2 text-3xl font-bold">{campaign.physicallyCycledCount}</p></div>
        <div className="glass rounded-2xl p-5"><p className="text-sm text-muted-foreground">Capacités externes vérifiées</p><p className="mt-2 text-3xl font-bold">{campaign.externallyVerifiedCount}</p></div>
        <div className="glass rounded-2xl p-5"><p className="text-sm text-muted-foreground">Quarantaine</p><p className="mt-2 text-3xl font-bold">{campaign.quarantinedCount}</p></div>
      </section>

      <section className="glass liquid-border space-y-4 rounded-2xl p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-xl font-bold">Garde-fous FreePay</h2>
            <p className="text-sm text-muted-foreground">Trois verrous indépendants doivent être ouverts. Stripe reste absent de ce parcours.</p>
          </div>
          <Badge variant={station?.qualification_mode === "freepay_test" ? "default" : "secondary"}>
            Mode {station?.qualification_mode ?? "inconnu"}
          </Badge>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Guard ok={guards.providerConfigured} label="Identifiants ChargeNow configurés" />
          <Guard ok={guards.providerMode === "test"} label="CHARGENOW_MODE=test" />
          <Guard ok={guards.providerMutationsEnabled} label="Mutations ChargeNow autorisées" />
          <Guard ok={guards.freePayEnvironmentEnabled} label="DTA21269_FREEPAY_ENABLED=true" />
          <Guard ok={station?.qualification_mode === "freepay_test"} label="Borne placée en freepay_test" />
          <Guard ok={!guards.stripeUsed} label="Aucun paiement Stripe" />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => invoke("set_mode", { mode: "read_only" })} disabled={busy !== null}>
            <ShieldCheck className="mr-2 h-4 w-4" />Lecture seule
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="secondary" disabled={busy !== null || !guards.freePayEnvironmentEnabled || guards.providerMode !== "test"}>
                <TestTube2 className="mr-2 h-4 w-4" />Activer FreePay pilote
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Activer les commandes matérielles gratuites ?</AlertDialogTitle>
                <AlertDialogDescription>
                  Ce mode est limité à DTA21269, ne crée aucun paiement et permet une éjection réelle. Une seule batterie sera testée à la fois.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Annuler</AlertDialogCancel>
                <AlertDialogAction onClick={() => invoke("set_mode", { mode: "freepay_test" })}>Activer</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </section>

      <section className="glass liquid-border space-y-4 rounded-2xl p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-xl font-bold">Cycle physique</h2>
            <p className="text-sm text-muted-foreground">
              La prochaine batterie non encore cyclée est sélectionnée automatiquement. Elle doit être rendue à DTA21269.
            </p>
          </div>
          <Badge variant={station?.online ? "default" : "destructive"}>{station?.online ? "Borne en ligne" : "Borne hors ligne"}</Badge>
        </div>

        {activeRun ? (
          <div className="rounded-2xl border border-warning/40 bg-warning/10 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-semibold">Cycle actif · {activeRun.state}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Batterie {activeRun.observed_battery_id ?? activeRun.expected_battery_id ?? "—"} · slot {activeRun.observed_slot_num ?? activeRun.requested_slot_num ?? "—"}
                </p>
                {activeRun.failure_code && <p className="mt-2 text-sm text-destructive">{activeRun.failure_code} — {activeRun.failure_message}</p>}
              </div>
              <Button onClick={() => invoke("reconcile", { runId: activeRun.id })} disabled={busy !== null}>
                <RefreshCw className="mr-2 h-4 w-4" />Réconcilier après retrait/retour
              </Button>
            </div>
          </div>
        ) : (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button className="w-full sm:w-auto" disabled={!guardsReady || busy !== null || !station?.online}>
                <BatteryCharging className="mr-2 h-4 w-4" />Éjecter la prochaine batterie non testée
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Lancer une éjection FreePay réelle ?</AlertDialogTitle>
                <AlertDialogDescription>
                  Vérifiez que vous êtes devant la borne. Retirez uniquement la batterie indiquée, notez son étiquette, puis rendez-la à DTA21269 avant de poursuivre.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Annuler</AlertDialogCancel>
                <AlertDialogAction onClick={() => invoke("start_freepay")}>Éjecter une batterie</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
        <p className="text-xs text-muted-foreground">
          Dernière synchronisation : {formatDate(station?.last_sync_at)} · disponibles {station?.rentable_count ?? "—"}/{station?.total_count ?? "—"} · retours libres {station?.returnable_count ?? "—"}
        </p>
      </section>

      <section className="glass liquid-border space-y-4 rounded-2xl p-6">
        <div>
          <h2 className="font-display text-xl font-bold">Inventaire et capacité</h2>
          <p className="text-sm text-muted-foreground">
            Le champ fournisseur est conservé comme télémétrie inconnue. Seules une étiquette vérifiée ou une mesure externe établissent la capacité.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px] text-left text-sm">
            <thead className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="p-3">Batterie</th><th className="p-3">Slot</th><th className="p-3">Mesure fournisseur</th>
                <th className="p-3">Capacité annoncée</th><th className="p-3">Capacité mesurée</th><th className="p-3">Confiance</th>
                <th className="p-3">Qualification</th><th className="p-3">Tarif</th>
              </tr>
            </thead>
            <tbody>
              {batteries.map((battery) => (
                <tr key={battery.battery_id} className="border-b border-border/60">
                  <td className="p-3 font-mono text-xs">{battery.battery_id}</td>
                  <td className="p-3">{battery.slot_num ?? "hors borne"}</td>
                  <td className="p-3">{battery.power_level ?? "—"} <span className="text-xs text-muted-foreground">(unité non prouvée)</span></td>
                  <td className="p-3">{battery.rated_capacity_mah ? `${battery.rated_capacity_mah} mAh` : "—"}</td>
                  <td className="p-3">{battery.measured_capacity_mah ? `${battery.measured_capacity_mah} mAh` : battery.measured_energy_wh ? `${battery.measured_energy_wh} Wh` : "—"}</td>
                  <td className="p-3">{battery.capacity_confidence}</td>
                  <td className="p-3"><Badge variant={statusVariant(battery.qualification_status)}>{battery.qualification_status}</Badge></td>
                  <td className="p-3">{battery.pricing_eligible ? battery.commercial_tier : "désactivé"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="glass liquid-border space-y-4 rounded-2xl p-6">
        <div>
          <h2 className="font-display text-xl font-bold"><Gauge className="mr-2 inline h-5 w-5" />Enregistrer une capacité</h2>
          <p className="text-sm text-muted-foreground">Cette opération documente la batterie, mais n'active aucun prix différent.</p>
        </div>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          <label className="space-y-1 text-sm"><span>Batterie</span><select className="h-10 w-full rounded-md border border-input bg-background px-3" value={selectedBatteryId} onChange={(event) => setSelectedBatteryId(event.target.value)}>{batteries.map((battery) => <option key={battery.battery_id} value={battery.battery_id}>{battery.battery_id} · slot {battery.slot_num ?? "—"}</option>)}</select></label>
          <label className="space-y-1 text-sm"><span>Méthode</span><select className="h-10 w-full rounded-md border border-input bg-background px-3" value={method} onChange={(event) => setMethod(event.target.value)}><option value="label_verification">Étiquette constructeur</option><option value="usb_load_meter">Testeur USB</option><option value="bench_discharge">Décharge sur banc</option><option value="provider_cycle">Cycle fournisseur uniquement</option></select></label>
          <label className="space-y-1 text-sm"><span>Modèle</span><Input value={modelCode} onChange={(event) => setModelCode(event.target.value)} placeholder="Référence inscrite" /></label>
          <label className="space-y-1 text-sm"><span>Capacité annoncée (mAh)</span><Input inputMode="numeric" value={ratedCapacityMah} onChange={(event) => setRatedCapacityMah(event.target.value)} /></label>
          <label className="space-y-1 text-sm"><span>Capacité délivrée (mAh)</span><Input inputMode="numeric" value={measuredCapacityMah} onChange={(event) => setMeasuredCapacityMah(event.target.value)} /></label>
          <label className="space-y-1 text-sm"><span>Énergie délivrée (Wh)</span><Input inputMode="decimal" value={measuredEnergyWh} onChange={(event) => setMeasuredEnergyWh(event.target.value)} /></label>
          <label className="space-y-1 text-sm"><span>Référence du testeur</span><Input value={meterReference} onChange={(event) => setMeterReference(event.target.value)} /></label>
          <label className="space-y-1 text-sm md:col-span-2"><span>Notes</span><Input value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
        </div>
        <Button onClick={recordMeasurement} disabled={busy !== null || !selectedBatteryId}>
          <Gauge className="mr-2 h-4 w-4" />Enregistrer la mesure
        </Button>
      </section>

      <section className="rounded-2xl border border-destructive/30 bg-destructive/5 p-6">
        <h2 className="font-display text-xl font-bold"><AlertTriangle className="mr-2 inline h-5 w-5 text-destructive" />Mettre une batterie en quarantaine</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-[1fr_2fr_auto]">
          <select className="h-10 rounded-md border border-input bg-background px-3 text-sm" value={selectedBatteryId} onChange={(event) => setSelectedBatteryId(event.target.value)}>{batteries.map((battery) => <option key={battery.battery_id} value={battery.battery_id}>{battery.battery_id}</option>)}</select>
          <Input value={quarantineReason} onChange={(event) => setQuarantineReason(event.target.value)} placeholder="Motif technique précis" />
          <AlertDialog>
            <AlertDialogTrigger asChild><Button variant="destructive" disabled={!selectedBatteryId || !quarantineReason.trim()}>Quarantaine</Button></AlertDialogTrigger>
            <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Retirer cette batterie du parc commercial ?</AlertDialogTitle><AlertDialogDescription>Elle restera identifiable dans l'inventaire mais ne pourra jamais recevoir un tarif ni être considérée comme qualifiée.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Annuler</AlertDialogCancel><AlertDialogAction onClick={quarantine}>Confirmer</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
          </AlertDialog>
        </div>
      </section>

      <section className="glass liquid-border space-y-3 rounded-2xl p-6">
        <h2 className="font-display text-xl font-bold">Historique des cycles</h2>
        {runs.length === 0 ? <p className="text-sm text-muted-foreground">Aucun cycle.</p> : runs.map((run) => (
          <div key={run.id} className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-border p-4">
            <div>
              <div className="flex items-center gap-2"><Badge variant={statusVariant(run.state)}>{run.state}</Badge><span className="font-mono text-xs">{run.id.slice(0, 8)}</span></div>
              <p className="mt-2 text-sm">Batterie {run.observed_battery_id ?? run.expected_battery_id ?? "—"} · slot {run.observed_slot_num ?? run.requested_slot_num ?? "—"}</p>
              <p className="text-xs text-muted-foreground">{formatDate(run.created_at)} → {formatDate(run.completed_at)}</p>
              {run.failure_code && <p className="mt-1 text-xs text-destructive">{run.failure_code} · {run.failure_message}</p>}
            </div>
            {activeStates.has(run.state) && <Button size="sm" variant="outline" onClick={() => invoke("reconcile", { runId: run.id })}><RefreshCw className="mr-2 h-4 w-4" />Réconcilier</Button>}
          </div>
        ))}
      </section>
    </div>
  );
}
