import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { ShieldCheck, RefreshCw, Loader2, Inbox, LockKeyhole, Radio } from "lucide-react";

const REQUEST_ROLES = new Set(["super_admin", "admin", "operations_admin", "support_agent"]);

export default function AdminMaintenance() {
  const { roles, canWrite } = useAuth();
  const canHandleRequests = roles.some((role) => REQUEST_ROLES.has(role));
  const [stationId, setStationId] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
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

  useEffect(() => { void loadRequests(); }, [loadRequests]);

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
    if (!stationId.trim()) { toast.error("Saisissez l’identifiant de la borne."); return; }
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
            <label className="text-sm text-muted-foreground">Borne (cabinetId)</label>
            <Input value={stationId} onChange={(e) => setStationId(e.target.value)} placeholder="DTA21269" />
          </section>

          <section className="glass liquid-border space-y-3 rounded-2xl p-6">
            <h2 className="font-display text-lg font-bold text-success"><ShieldCheck className="mr-2 inline h-5 w-5" />Diagnostics sûrs</h2>
            <div className="flex flex-wrap gap-3">
              <Button onClick={() => void call("test_auth")} disabled={!!busy} variant="ghost" className="gap-2 border border-border">{busy === "test_auth" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}Tester l'authentification API</Button>
              <Button onClick={() => void call("sync_status")} disabled={!!busy} variant="ghost" className="gap-2 border border-border">{busy === "sync_status" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}Lire l’état fournisseur</Button>
            </div>
          </section>
        </>
      )}

      <section className="rounded-2xl border border-primary/25 bg-primary/5 p-6">
        <h2 className="font-display text-lg font-bold"><Radio className="mr-2 inline h-5 w-5" />Event Push ChargeNow</h2>
        <p className="mt-2 text-sm text-muted-foreground">Le webhook global est géré centralement et n’est plus modifiable depuis cette page. Consultez <Link className="text-primary underline" to="/admin/api-health">Santé API</Link> pour son état réel.</p>
      </section>

      <section className="rounded-2xl border border-warning/35 bg-warning/5 p-6">
        <h2 className="font-display text-lg font-bold"><LockKeyhole className="mr-2 inline h-5 w-5" />Actions physiques verrouillées</h2>
        <p className="mt-2 text-sm text-muted-foreground">POP et configuration fournisseur générique sont bloqués par design. Une éjection de maintenance n’est possible qu’avec un permis serveur explicite, limité à une borne et un slot, et n’est donc pas présentée comme un bouton permanent.</p>
      </section>
    </div>
  );
}
