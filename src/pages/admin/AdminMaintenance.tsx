import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { AlertTriangle, ShieldCheck, RefreshCw, Radio, Loader2, Inbox } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export default function AdminMaintenance() {
  const [stationId, setStationId] = useState("");
  const [slotNum, setSlotNum] = useState("1");
  const [pushUrl, setPushUrl] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
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
    <div className="animate-fade-in max-w-3xl space-y-6">
      <h1 className="font-display text-3xl font-bold">Maintenance</h1>
      <p className="text-muted-foreground">Actions administrateur exécutées côté serveur uniquement. Les actions dangereuses agissent sur le matériel.</p>

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
          <label className="text-sm text-muted-foreground">Borne (cabinetId)</label>
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
