import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { AlertTriangle, ShieldCheck, RefreshCw, Radio, Loader2, Inbox, Database, BatteryCharging } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

type ProviderSnapshot = {
  stationId: string;
  cabinetId: string;
  collectedAt: string;
  providerReachable: boolean;
  stateKnown: boolean;
  online: boolean | null;
  signal: number | null;
  totalSlots: number | null;
  rentableCount: number;
  returnableCount: number | null;
  shop: { id: string | null; name: string | null; address: string | null };
  pricing: {
    currency: string | null; depositAmount: number | null; price: number | null;
    priceMinute: number | null; dailyMaxPrice: number | null; timeoutAmount: number | null;
  };
  batteries: Array<{ batteryId: string; slotNum: number | null; powerLevel: number | null }>;
  slots: Array<{ slotNum: number; status: string | null; batteryId: string | null }>;
  attempts: Array<{ source: string; status: number; ok: boolean; error: string | null }>;
};

export default function AdminMaintenance() {
  const [stationId, setStationId] = useState("DTA21269");
  const [slotNum, setSlotNum] = useState("1");
  const [pushUrl, setPushUrl] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [providerSnapshot, setProviderSnapshot] = useState<ProviderSnapshot | null>(null);
  const [requests, setRequests] = useState<Array<{
    id: string; request_type: string; name: string; email: string; station_id: string | null;
    organization: string | null; message: string; status: string; created_at: string;
  }>>([]);

  const loadRequests = useCallback(async () => {
    const db = supabase as any;
    const { data, error } = await db.from("public_contact_requests")
      .select("id,request_type,name,email,station_id,organization,message,status,created_at")
      .in("status", ["new", "in_progress"])
      .order("created_at", { ascending: false })
      .limit(100);
    if (!error) setRequests(data ?? []);
  }, []);

  useEffect(() => { loadRequests(); }, [loadRequests]);

  const setRequestStatus = async (id: string, status: "in_progress" | "resolved") => {
    const db = supabase as any;
    const { error } = await db.from("public_contact_requests").update({
      status,
      resolved_at: status === "resolved" ? new Date().toISOString() : null,
    }).eq("id", id);
    if (error) toast.error("La demande n'a pas pu être mise à jour.");
    else { toast.success("Demande mise à jour"); loadRequests(); }
  };

  const runReadonlyAudit = async () => {
    setBusy("readonly_audit");
    try {
      const { data, error } = await supabase.functions.invoke("chargenow-readonly-audit", {
        body: { stationId: stationId.trim() || "DTA21269" },
      });
      if (error) throw error;
      const payload = data as { ok?: boolean; error?: string; snapshot?: ProviderSnapshot };
      if (!payload.ok || !payload.snapshot) {
        setProviderSnapshot(payload.snapshot ?? null);
        toast.error(payload.error ?? "Snapshot fournisseur indisponible");
        return;
      }
      setProviderSnapshot(payload.snapshot);
      toast.success("Snapshot ChargeNow reçu en lecture seule");
    } catch (error) {
      toast.error((error as Error).message ?? "Erreur de lecture fournisseur");
    } finally {
      setBusy(null);
    }
  };

  const call = async (actionType: string, extra: Record<string, unknown> = {}) => {
    setBusy(actionType);
    try {
      const { data, error } = await supabase.functions.invoke("admin-maintenance-action", {
        body: { actionType, stationId, slotNum: Number(slotNum), ...extra },
      });
      if (error) throw error;
      if ((data as any)?.ok) toast.success(`Action « ${actionType} » exécutée`);
      else toast.error((data as any)?.error ?? "Échec");
    } catch (e) { toast.error((e as Error).message ?? "Erreur"); }
    finally { setBusy(null); }
  };

  return (
    <div className="animate-fade-in max-w-4xl space-y-6">
      <h1 className="font-display text-3xl font-bold">Maintenance</h1>
      <p className="text-muted-foreground">Audit fournisseur en lecture seule et actions administrateur exécutées côté serveur.</p>

      <section className="glass liquid-border space-y-4 rounded-2xl p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-bold"><Database className="mr-2 inline h-5 w-5" />Snapshot ChargeNow → Chargeurs.ch</h2>
            <p className="mt-1 text-sm text-muted-foreground">Lecture seule : aucune location, aucun paiement et aucune commande matérielle.</p>
          </div>
          <Button onClick={runReadonlyAudit} disabled={!!busy} className="gap-2">
            {busy === "readonly_audit" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Auditer DTA21269
          </Button>
        </div>

        {providerSnapshot ? (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <SnapshotCard label="Fournisseur" value={providerSnapshot.providerReachable ? "joignable" : "injoignable"} />
              <SnapshotCard label="Borne" value={providerSnapshot.online === true ? "en ligne" : providerSnapshot.online === false ? "hors ligne" : "inconnue"} />
              <SnapshotCard label="Batteries louables" value={String(providerSnapshot.rentableCount)} />
              <SnapshotCard label="Retours possibles" value={providerSnapshot.returnableCount == null ? "inconnu" : String(providerSnapshot.returnableCount)} />
            </div>

            <div className="grid gap-4 rounded-xl border border-border p-4 md:grid-cols-2">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Borne et lieu</p>
                <p className="mt-2 font-semibold">{providerSnapshot.stationId} · {providerSnapshot.cabinetId}</p>
                <p className="text-sm text-muted-foreground">{providerSnapshot.shop.name ?? "Magasin non fourni"}</p>
                <p className="text-sm text-muted-foreground">{providerSnapshot.shop.address ?? "Adresse non fournie"}</p>
                <p className="mt-2 text-xs text-muted-foreground">Collecté le {new Date(providerSnapshot.collectedAt).toLocaleString("fr-CH")}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Tarif observé chez le fournisseur</p>
                <p className="mt-2 text-sm">Caution : {formatMoney(providerSnapshot.pricing.depositAmount, providerSnapshot.pricing.currency)}</p>
                <p className="text-sm">Prix : {formatMoney(providerSnapshot.pricing.price, providerSnapshot.pricing.currency)} / {providerSnapshot.pricing.priceMinute ?? "?"} min</p>
                <p className="text-sm">Plafond : {formatMoney(providerSnapshot.pricing.dailyMaxPrice, providerSnapshot.pricing.currency)}</p>
                <p className="text-sm">Non-retour : {formatMoney(providerSnapshot.pricing.timeoutAmount, providerSnapshot.pricing.currency)}</p>
              </div>
            </div>

            <div>
              <p className="mb-2 flex items-center text-sm font-semibold"><BatteryCharging className="mr-2 h-4 w-4" />Batteries observées ({providerSnapshot.batteries.length})</p>
              {providerSnapshot.batteries.length === 0 ? (
                <p className="text-sm text-muted-foreground">Aucune batterie identifiable dans les réponses fournisseur.</p>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {providerSnapshot.batteries.map((battery) => (
                    <div key={battery.batteryId} className="rounded-lg border border-border px-3 py-2 text-sm">
                      <span className="font-medium">{battery.batteryId}</span>
                      <span className="ml-2 text-muted-foreground">slot {battery.slotNum ?? "?"} · {battery.powerLevel ?? "?"}%</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <details className="rounded-xl border border-border p-4">
              <summary className="cursor-pointer text-sm font-semibold">Détail des routes fournisseur</summary>
              <pre className="mt-3 overflow-auto text-xs text-muted-foreground">{JSON.stringify(providerSnapshot.attempts, null, 2)}</pre>
            </details>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Aucun snapshot chargé.</p>
        )}
      </section>

      <section className="glass liquid-border space-y-4 rounded-2xl p-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display text-lg font-bold"><Inbox className="mr-2 inline h-5 w-5" />Demandes support et partenaires</h2>
          <Button variant="ghost" size="sm" onClick={loadRequests}><RefreshCw className="mr-2 h-4 w-4" />Actualiser</Button>
        </div>
        {requests.length === 0 ? <p className="text-sm text-muted-foreground">Aucune demande ouverte.</p> : requests.map((request) => (
          <article key={request.id} className="rounded-xl border border-border p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-semibold">{request.name} · {request.request_type === "support" ? "Support" : "Installation partenaire"}</p>
                <p className="text-sm text-muted-foreground">{request.email} · {new Date(request.created_at).toLocaleString("fr-CH")}</p>
                {(request.station_id || request.organization) && <p className="mt-1 text-sm">{request.station_id ?? request.organization}</p>}
              </div>
              <span className="rounded-full bg-muted px-2.5 py-1 text-xs">{request.status}</span>
            </div>
            <p className="mt-3 whitespace-pre-wrap text-sm">{request.message}</p>
            <div className="mt-4 flex gap-2">
              {request.status === "new" && <Button size="sm" variant="outline" onClick={() => setRequestStatus(request.id, "in_progress")}>Prendre en charge</Button>}
              <Button size="sm" onClick={() => setRequestStatus(request.id, "resolved")}>Marquer résolue</Button>
            </div>
          </article>
        ))}
      </section>

      <section className="glass liquid-border grid gap-3 rounded-2xl p-6 sm:grid-cols-2">
        <div>
          <label className="text-sm text-muted-foreground">Borne (stationId / cabinetId)</label>
          <Input value={stationId} onChange={(e) => setStationId(e.target.value)} />
        </div>
        <div>
          <label className="text-sm text-muted-foreground">Slot</label>
          <Input value={slotNum} onChange={(e) => setSlotNum(e.target.value)} />
        </div>
      </section>

      <section className="glass liquid-border space-y-3 rounded-2xl p-6">
        <h2 className="font-display text-lg font-bold text-success"><ShieldCheck className="mr-2 inline h-5 w-5" />Actions sûres</h2>
        <div className="flex flex-wrap gap-3">
          <Button onClick={() => call("test_auth")} disabled={!!busy} variant="ghost" className="gap-2 border border-border">
            {busy === "test_auth" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}Tester l'authentification API
          </Button>
          <Button onClick={() => call("sync_status")} disabled={!!busy} variant="ghost" className="gap-2 border border-border">
            <RefreshCw className="h-4 w-4" />Synchroniser cette borne
          </Button>
        </div>
        <div className="flex items-end gap-2 pt-2">
          <div className="flex-1">
            <label className="text-sm text-muted-foreground">URL Event Push</label>
            <Input value={pushUrl} onChange={(e) => setPushUrl(e.target.value)} />
          </div>
          <Button onClick={() => call("config_event_push", { eventPushUrl: pushUrl })} disabled={!!busy} variant="ghost" className="gap-2 border border-border">
            <Radio className="h-4 w-4" />Configurer
          </Button>
        </div>
      </section>

      <section className="rounded-2xl border-2 border-destructive/50 bg-destructive/5 p-6">
        <h2 className="mb-1 font-display text-lg font-bold text-destructive"><AlertTriangle className="mr-2 inline h-5 w-5" />Zone dangereuse</h2>
        <p className="mb-4 text-sm text-muted-foreground">Ces actions éjectent une batterie sans location payée. À utiliser uniquement pour la maintenance physique.</p>
        <div className="flex flex-wrap gap-3">
          <DangerButton label="Éjection maintenance (ejectByRepair)" busy={busy === "eject_by_repair"} onConfirm={() => call("eject_by_repair")} stationId={stationId} slotNum={slotNum} />
          <DangerButton label="Opération POP" busy={busy === "operation_pop"} onConfirm={() => call("operation_pop")} stationId={stationId} slotNum={slotNum} />
        </div>
      </section>
    </div>
  );
}

function SnapshotCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-background/40 p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </div>
  );
}

function formatMoney(value: number | null, currency: string | null) {
  if (value == null) return "inconnu";
  return `${value.toLocaleString("fr-CH", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ${currency ?? "CHF"}`;
}

function DangerButton({ label, onConfirm, busy, stationId, slotNum }: { label: string; onConfirm: () => void; busy: boolean; stationId: string; slotNum: string }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="destructive" disabled={busy} className="gap-2">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <AlertTriangle className="h-4 w-4" />}{label}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="glass-strong">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-destructive">Confirmer l'action dangereuse</AlertDialogTitle>
          <AlertDialogDescription>
            Vous allez exécuter « {label} » sur la borne <b>{stationId}</b>, slot <b>{slotNum}</b>. Cette action affecte le matériel physique.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Annuler</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Confirmer</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
