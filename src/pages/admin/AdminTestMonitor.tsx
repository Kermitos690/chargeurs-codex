import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RefreshCw, FileJson, FileText, Search, Loader2 } from "lucide-react";
import MutationTestMonitor from "@/components/admin/MutationTestMonitor";
import { toast } from "sonner";

type Session = Record<string, any> & {
  id: string; public_session_code: string | null; station_id: string | null; cabinet_id: string | null;
  selected_slot_num: number | null; battery_id: string | null; state: string | null; currency: string | null;
};
type Report = {
  session: Session; payments: unknown[]; refunds: unknown[]; rental_events: unknown[];
  chargenow_api_logs: unknown[]; stripe_api_logs: unknown[]; chargenow_callbacks: unknown[];
  cabinet_events: unknown[]; generated_at: string;
};
type Recent = Pick<Session, "id" | "public_session_code" | "station_id" | "state"> & { created_at: string | null };

const fmt = (value: string | null | undefined) => value ? new Date(value).toLocaleString("fr-CH") : "—";
const money = (value: number | null | undefined, currency: string | null | undefined, cents = false) => value == null ? "—" : `${(cents ? value / 100 : value).toFixed(2)} ${currency ?? "CHF"}`;

function Field({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return <div className="rounded-xl bg-muted/30 p-3"><div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div><div className={`mt-1 break-all text-sm ${mono ? "font-mono" : ""}`}>{value ?? "—"}</div></div>;
}
function JsonBlock({ label, data }: { label: string; data: unknown }) {
  const arr = Array.isArray(data) ? data : data ? [data] : [];
  return <div className="glass liquid-border rounded-2xl p-5"><h3 className="mb-3 font-semibold">{label} <span className="text-sm text-muted-foreground">({arr.length})</span></h3>{arr.length === 0 ? <p className="text-sm text-muted-foreground">Aucune donnée.</p> : <pre className="max-h-80 overflow-auto rounded-lg bg-background/60 p-3 text-xs">{JSON.stringify(arr, null, 2)}</pre>}</div>;
}

async function invoke(action: string, extra: Record<string, unknown> = {}) {
  const { data, error } = await supabase.functions.invoke("admin-test-monitor-read", { body: { action, ...extra } });
  if (error) throw new Error(error.message);
  if (!data?.ok) throw new Error(data?.error ?? "TEST_MONITOR_READ_FAILED");
  return data;
}

export default function AdminTestMonitor() {
  const [recent, setRecent] = useState<Recent[]>([]);
  const [query, setQuery] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [auto, setAuto] = useState(true);

  const loadRecent = useCallback(async () => {
    try { const data = await invoke("recent"); setRecent((data.sessions ?? []) as Recent[]); }
    catch (error) { toast.error((error as Error).message); setRecent([]); }
  }, []);

  const loadReport = useCallback(async (id: string, quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const data = await invoke("report", { rentalId: id });
      setReport(data.report as Report);
    } catch (error) {
      if (!quiet) toast.error((error as Error).message === "SESSION_NOT_FOUND" ? "Session introuvable." : (error as Error).message);
    } finally { if (!quiet) setLoading(false); }
  }, []);

  useEffect(() => { void loadRecent(); }, [loadRecent]);
  useEffect(() => {
    if (!auto || !report) return;
    const timer = window.setInterval(() => void loadReport(report.session.id, true), 5000);
    return () => window.clearInterval(timer);
  }, [auto, report?.session.id, loadReport]);

  const handleSearch = async () => {
    const q = query.trim();
    if (!q) return;
    setLoading(true);
    try {
      const resolved = await invoke("resolve", { query: q });
      await loadReport(String(resolved.id));
    } catch (error) {
      toast.error((error as Error).message === "SESSION_NOT_FOUND" ? "Aucune session pour cet identifiant ou code." : (error as Error).message);
    } finally { setLoading(false); }
  };

  const download = (kind: "json" | "txt") => {
    if (!report) return;
    const s = report.session;
    const content = kind === "json" ? JSON.stringify(report, null, 2) : [
      "RAPPORT DE TEST DE LOCATION — Chargeurs.ch", `Généré: ${report.generated_at}`, "",
      `Session: ${s.id}`, `Code: ${s.public_session_code ?? "—"}`, `État: ${s.state ?? "—"}`,
      `Borne: ${s.station_id ?? "—"}`, `Slot: ${s.selected_slot_num ?? "—"}`, `Batterie: ${s.battery_id ?? "—"}`,
      `Prix final: ${money(s.final_amount_cents, s.currency, true)}`, `Attendu: ${money(s.amount_expected, s.currency)}`, `Payé: ${money(s.amount_paid, s.currency)}`,
      `Settlement: ${s.settlement_status ?? "—"}`, `Erreur: ${s.settlement_error ?? s.failure_code ?? "—"}`, "",
      "--- ÉVÉNEMENTS LOCATION ---", JSON.stringify(report.rental_events, null, 2), "",
      "--- CHARGENOW ---", JSON.stringify(report.chargenow_api_logs, null, 2), "",
      "--- CALLBACKS ---", JSON.stringify(report.chargenow_callbacks, null, 2),
    ].join("\n");
    const blob = new Blob([content], { type: kind === "json" ? "application/json" : "text/plain" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url;
    a.download = `test-location-${s.public_session_code ?? s.id}.${kind}`; a.click(); URL.revokeObjectURL(url);
  };

  const s = report?.session;
  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="font-display text-3xl font-bold">Contrôle de test (staging)</h1><p className="text-sm text-muted-foreground">Lecture seule. Corrélation et expurgation sont réalisées côté serveur avant l'envoi au navigateur.</p></div>
        <div className="flex gap-2"><Button variant="ghost" size="sm" onClick={() => setAuto((value) => !value)} className="gap-2"><RefreshCw className={`h-4 w-4 ${auto ? "animate-spin" : ""}`} />{auto ? "Auto 5s" : "Manuel"}</Button><Button variant="ghost" size="sm" disabled={!report || loading} onClick={() => report && void loadReport(report.session.id)} className="gap-2">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}Rafraîchir</Button></div>
      </div>

      <MutationTestMonitor />

      <section className="glass liquid-border rounded-2xl p-5">
        <div className="flex flex-wrap items-center gap-2"><Input placeholder="UUID ou code public…" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void handleSearch()} className="max-w-md" /><Button onClick={() => void handleSearch()} disabled={loading} className="gap-2">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}Suivre</Button></div>
        {recent.length > 0 && <div className="mt-4"><div className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">Sessions récentes</div><div className="flex flex-wrap gap-2">{recent.map((r) => <button key={r.id} onClick={() => void loadReport(r.id)} className="rounded-lg border border-border px-3 py-2 text-left text-xs hover:bg-muted/40"><b>{r.public_session_code ?? r.id.slice(0, 8)}</b><span className="ml-2 text-muted-foreground">{r.station_id ?? "—"} · {r.state ?? "—"}</span></button>)}</div></div>}
      </section>

      {s && <>
        <section className="glass liquid-border rounded-2xl p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-display text-2xl font-bold">{s.public_session_code ?? s.id}</h2><p className="font-mono text-xs text-muted-foreground">{s.id}</p></div><div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => download("json")}><FileJson className="mr-2 h-4 w-4" />JSON</Button><Button size="sm" variant="outline" onClick={() => download("txt")}><FileText className="mr-2 h-4 w-4" />TXT</Button></div></div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Field label="État" value={s.state} /><Field label="Borne" value={s.station_id} mono /><Field label="Slot" value={s.selected_slot_num} /><Field label="Batterie" value={s.battery_id} mono /><Field label="Prix final" value={money(s.final_amount_cents, s.currency, true)} /><Field label="Attendu / payé" value={`${money(s.amount_expected, s.currency)} / ${money(s.amount_paid, s.currency)}`} /><Field label="Settlement" value={s.settlement_status} /><Field label="Erreur" value={s.settlement_error ?? s.failure_code ?? "—"} mono /><Field label="Créée" value={fmt(s.created_at)} /><Field label="Éjectée" value={fmt(s.ejected_at)} /><Field label="Retournée" value={fmt(s.returned_at)} /><Field label="Complétée" value={fmt(s.completed_at)} /></div>
        </section>
        <div className="grid gap-4 xl:grid-cols-2"><JsonBlock label="Paiements" data={report.payments} /><JsonBlock label="Remboursements" data={report.refunds} /><JsonBlock label="Événements location" data={report.rental_events} /><JsonBlock label="Callbacks ChargeNow" data={report.chargenow_callbacks} /><JsonBlock label="Logs ChargeNow expurgés" data={report.chargenow_api_logs} /><JsonBlock label="Logs Stripe expurgés" data={report.stripe_api_logs} /><JsonBlock label="Événements borne" data={report.cabinet_events} /></div>
      </>}
      {!s && <div className="rounded-2xl border border-dashed border-border p-10 text-center text-muted-foreground">Sélectionnez une session pour construire un rapport.</div>}
    </div>
  );
}
