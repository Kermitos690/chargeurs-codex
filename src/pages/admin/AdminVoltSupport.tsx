import { useCallback, useEffect, useMemo, useState } from "react";
import { BellRing, CheckCircle2, Clock3, Inbox, Loader2, Mail, MapPin, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type SupportStatus = "new" | "in_progress" | "resolved" | "spam";
type FilterStatus = "all" | Exclude<SupportStatus, "spam">;
type SupportRequest = { id: string; request_type: string; name: string; email: string; phone: string | null; organization: string | null; station_id: string | null; message: string; status: SupportStatus; assigned_to: string | null; resolved_at: string | null; created_at: string; updated_at: string };
type VoltAlert = { id: string; title: string; body: string | null; data: Record<string, unknown> | null; status: string; created_at: string; read_at: string | null };

const FILTERS: Array<{ value: FilterStatus; label: string }> = [
  { value: "all", label: "Toutes" }, { value: "new", label: "Nouvelles" }, { value: "in_progress", label: "En cours" }, { value: "resolved", label: "Résolues" },
];
function formatDate(value: string) { return new Date(value).toLocaleString("fr-CH", { dateStyle: "medium", timeStyle: "short" }); }

export default function AdminVoltSupport() {
  const { user, roles } = useAuth();
  const isSuperAdmin = roles.includes("super_admin");
  const [requests, setRequests] = useState<SupportRequest[]>([]);
  const [alerts, setAlerts] = useState<VoltAlert[]>([]);
  const [filter, setFilter] = useState<FilterStatus>("all");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const supportPromise = supabase.from("public_contact_requests").select("id,request_type,name,email,phone,organization,station_id,message,status,assigned_to,resolved_at,created_at,updated_at").eq("request_type", "support").neq("status", "spam").order("created_at", { ascending: false }).limit(200);
    const alertPromise = isSuperAdmin
      ? supabase.from("notifications").select("id,title,body,data,status,created_at,read_at").eq("type", "volt_support_case").in("status", ["sent", "read"]).order("created_at", { ascending: false }).limit(50)
      : Promise.resolve({ data: [], error: null });
    const [supportResult, alertResult] = await Promise.all([supportPromise, alertPromise]);
    if (supportResult.error) { setError("Impossible de charger la file support avec votre rôle actuel."); setRequests([]); }
    else setRequests((supportResult.data ?? []) as SupportRequest[]);
    if (isSuperAdmin && alertResult.error) setError((current) => current ?? "Les alertes super-admin ne peuvent pas être chargées.");
    setAlerts(isSuperAdmin ? ((alertResult.data ?? []) as VoltAlert[]) : []);
    setLoading(false);
  }, [isSuperAdmin]);

  useEffect(() => { void load(); }, [load]);

  const visible = useMemo(() => filter === "all" ? requests : requests.filter((request) => request.status === filter), [filter, requests]);
  const counts = useMemo(() => ({ all: requests.length, new: requests.filter((r) => r.status === "new").length, in_progress: requests.filter((r) => r.status === "in_progress").length, resolved: requests.filter((r) => r.status === "resolved").length }), [requests]);
  const unreadAlerts = alerts.filter((alert) => alert.status === "sent" && !alert.read_at);

  const markAlertsRead = async () => {
    const ids = unreadAlerts.map((alert) => alert.id);
    if (!ids.length) return;
    const now = new Date().toISOString();
    const { error: markError } = await supabase.from("notifications").update({ status: "read", read_at: now }).in("id", ids);
    if (markError) { setError("Les alertes n'ont pas pu être marquées comme lues."); return; }
    setAlerts((current) => current.map((alert) => ids.includes(alert.id) ? { ...alert, status: "read", read_at: now } : alert));
  };

  const updateStatus = async (request: SupportRequest, status: Exclude<SupportStatus, "spam">) => {
    setBusyId(request.id); setError(null);
    const patch = { status, assigned_to: status === "in_progress" ? (user?.id ?? request.assigned_to) : request.assigned_to, resolved_at: status === "resolved" ? new Date().toISOString() : null };
    const { error: updateError } = await supabase.from("public_contact_requests").update(patch).eq("id", request.id);
    if (updateError) setError("La demande n'a pas pu être mise à jour.");
    else setRequests((current) => current.map((item) => item.id === request.id ? { ...item, ...patch, updated_at: new Date().toISOString() } : item));
    setBusyId(null);
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div className="flex items-center gap-3"><div className="grid h-11 w-11 place-items-center rounded-2xl bg-primary/15 text-primary"><Inbox className="h-6 w-6" /></div><div><h1 className="font-display text-3xl font-extrabold">Volt · Support</h1><p className="text-sm text-muted-foreground">Demandes structurées créées depuis l'assistance Chargeurs.ch.</p></div></div><Button variant="outline" onClick={() => void load()} disabled={loading} className="rounded-full"><RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />Actualiser</Button></header>

      {isSuperAdmin && <section className="rounded-2xl border border-primary/25 bg-primary/5 p-4"><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><div className="flex items-start gap-3"><BellRing className="mt-0.5 h-5 w-5 text-primary" /><div><h2 className="font-semibold">Alertes Volt · super-admin</h2><p className="mt-1 text-sm text-muted-foreground">{unreadAlerts.length ? `${unreadAlerts.length} nouvelle${unreadAlerts.length > 1 ? "s" : ""} alerte${unreadAlerts.length > 1 ? "s" : ""}.` : "Aucune alerte non lue."} Créées au moment du dossier, sans cron ni polling.</p></div></div>{unreadAlerts.length > 0 && <Button size="sm" variant="outline" onClick={() => void markAlertsRead()}>Marquer comme lues</Button>}</div>{unreadAlerts.slice(0, 3).map((alert) => <div key={alert.id} className="mt-3 rounded-xl border border-border bg-background/60 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-semibold">{alert.title}</span><span className="text-xs text-muted-foreground">{formatDate(alert.created_at)}</span></div>{alert.body && <p className="mt-1 text-sm text-muted-foreground">{alert.body}</p>}</div>)}</section>}

      <section className="glass rounded-2xl p-4"><div className="flex flex-wrap gap-2">{FILTERS.map((item) => <Button key={item.value} type="button" size="sm" variant={filter === item.value ? "default" : "ghost"} onClick={() => setFilter(item.value)} className="rounded-full">{item.label}<span className="ml-2 rounded-full bg-background/20 px-2 py-0.5 text-[0.7rem]">{counts[item.value]}</span></Button>)}</div><p className="mt-3 text-xs text-muted-foreground">Actualisation à l'ouverture et à la demande uniquement : aucun polling Supabase n'est ajouté par Volt.</p></section>

      {error && <p role="alert" className="rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">{error}</p>}
      {loading && <div className="glass grid min-h-48 place-items-center rounded-2xl"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>}
      {!loading && visible.length === 0 && <div className="glass rounded-2xl p-8 text-center"><CheckCircle2 className="mx-auto h-8 w-8 text-success" /><p className="mt-3 font-semibold">Aucune demande dans cette vue.</p></div>}

      <section className="space-y-4">{visible.map((request) => <article key={request.id} className="glass-strong liquid-border rounded-2xl p-5 sm:p-6"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start"><div><div className="flex flex-wrap items-center gap-2"><Badge variant={request.status === "new" ? "destructive" : request.status === "resolved" ? "secondary" : "outline"}>{request.status === "new" ? "Nouvelle" : request.status === "in_progress" ? "En cours" : "Résolue"}</Badge><span className="font-mono text-xs text-muted-foreground">#{request.id.slice(0, 8)}</span><span className="text-xs text-muted-foreground">{formatDate(request.created_at)}</span></div><h2 className="mt-3 text-lg font-bold">{request.name}</h2><div className="mt-2 flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground"><a href={`mailto:${request.email}`} className="inline-flex items-center gap-1.5 hover:text-foreground"><Mail className="h-3.5 w-3.5" />{request.email}</a>{request.station_id && <span className="inline-flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" />{request.station_id}</span>}<span className="inline-flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5" />Mis à jour {formatDate(request.updated_at)}</span></div></div><div className="flex flex-wrap gap-2">{request.status === "new" && <Button size="sm" variant="outline" disabled={busyId === request.id} onClick={() => void updateStatus(request, "in_progress")}>Prendre en charge</Button>}{request.status !== "resolved" && <Button size="sm" disabled={busyId === request.id} onClick={() => void updateStatus(request, "resolved")}>Résoudre</Button>}{request.status === "resolved" && <Button size="sm" variant="outline" disabled={busyId === request.id} onClick={() => void updateStatus(request, "in_progress")}>Rouvrir</Button>}</div></div><div className="mt-5 rounded-xl border border-border bg-background/60 p-4"><p className="whitespace-pre-wrap text-sm leading-6">{request.message}</p></div></article>)}</section>
    </div>
  );
}
