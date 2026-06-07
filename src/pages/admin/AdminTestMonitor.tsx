import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RefreshCw, Download, FileJson, FileText, Search } from "lucide-react";

// ---------------------------------------------------------------------------
// Staging manual-validation monitor.
// READ-ONLY: this page only SELECTs existing rows. It never writes, never
// triggers a payment, and never calls an external provider. Use it to follow a
// real test rental end-to-end on a staging/test environment.
// ---------------------------------------------------------------------------

type Json = Record<string, unknown> | null;

interface Session {
  id: string;
  public_session_code: string | null;
  station_id: string | null;
  cabinet_id: string | null;
  selected_slot_num: number | null;
  state: string | null;
  amount: number | null;
  amount_expected: number | null;
  amount_paid: number | null;
  currency: string | null;
  price_profile_id: string | null;
  price_profile_version: number | null;
  pricing_snapshot: Json;
  pricing_snapshot_hash: string | null;
  stripe_checkout_session_id: string | null;
  stripe_payment_intent_id: string | null;
  stripe_payment_method_type: string | null;
  apifox_trade_no: string | null;
  chargenow_order_id: string | null;
  chargenow_status: string | null;
  error_code: string | null;
  error_message: string | null;
  failure_code: string | null;
  failure_message: string | null;
  retry_count: number | null;
  created_at: string | null;
  paid_at: string | null;
  started_at: string | null;
  ejected_at: string | null;
  returned_at: string | null;
  completed_at: string | null;
  closed_at: string | null;
  cancelled_at: string | null;
  updated_at: string | null;
}

interface Report {
  session: Session;
  battery_id: string | null;
  payments: unknown[];
  refunds: unknown[];
  rental_events: unknown[];
  chargenow_api_logs: unknown[];
  stripe_api_logs: unknown[];
  chargenow_callbacks: unknown[];
  cabinet_events: unknown[];
  generated_at: string;
}

const fmt = (d: string | null | undefined) => (d ? new Date(d).toLocaleString() : "—");
const money = (a: number | null, c: string | null) =>
  a == null ? "—" : `${Number(a).toFixed(2)} ${c ?? ""}`.trim();

function Field({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="rounded-xl bg-muted/30 p-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-1 break-all text-sm ${mono ? "font-mono" : ""}`}>{value ?? "—"}</div>
    </div>
  );
}

function JsonBlock({ label, data }: { label: string; data: unknown }) {
  const arr = Array.isArray(data) ? data : data ? [data] : [];
  return (
    <div className="glass liquid-border rounded-2xl p-5">
      <h3 className="mb-3 font-semibold">
        {label} <span className="text-sm text-muted-foreground">({arr.length})</span>
      </h3>
      {arr.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucune donnée.</p>
      ) : (
        <pre className="max-h-80 overflow-auto rounded-lg bg-background/60 p-3 text-xs">
          {JSON.stringify(arr, null, 2)}
        </pre>
      )}
    </div>
  );
}

export default function AdminTestMonitor() {
  const [recent, setRecent] = useState<Pick<Session, "id" | "public_session_code" | "station_id" | "state" | "created_at">[]>([]);
  const [query, setQuery] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [auto, setAuto] = useState(true);

  const loadRecent = useCallback(async () => {
    const { data } = await supabase
      .from("rental_sessions")
      .select("id, public_session_code, station_id, state, created_at")
      .order("created_at", { ascending: false })
      .limit(15);
    setRecent((data ?? []) as typeof recent);
  }, []);

  const loadReport = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const { data: session, error: sErr } = await supabase
        .from("rental_sessions")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (sErr) throw sErr;
      if (!session) {
        setError("Session introuvable.");
        setReport(null);
        return;
      }
      const s = session as Session;

      const [payments, refunds, events, cnLogs, stripeLogs, callbacks, cabEvents] = await Promise.all([
        supabase.from("payments").select("*").eq("rental_session_id", id).order("created_at", { ascending: true }),
        supabase.from("refunds").select("*").eq("rental_session_id", id).order("created_at", { ascending: true }),
        supabase.from("rental_events").select("*").eq("rental_session_id", id).order("created_at", { ascending: true }),
        supabase.from("api_logs").select("*").eq("service", "chargenow").order("created_at", { ascending: true }).limit(50),
        supabase.from("api_logs").select("*").eq("service", "stripe").order("created_at", { ascending: true }).limit(50),
        s.apifox_trade_no
          ? supabase.from("chargenow_callbacks").select("*").eq("trade_no", s.apifox_trade_no).order("created_at", { ascending: true })
          : Promise.resolve({ data: [] }),
        s.station_id
          ? supabase.from("cabinet_events").select("*").eq("station_id", s.station_id).order("received_at", { ascending: false }).limit(20)
          : Promise.resolve({ data: [] }),
      ]);

      // Try to surface a battery id from any event/callback payload.
      let battery: string | null = null;
      const scan = (obj: unknown): void => {
        if (battery || !obj || typeof obj !== "object") return;
        for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
          if (battery) break;
          if (/batter|cBattery|power|pBattery/i.test(k) && (typeof v === "string" || typeof v === "number")) {
            battery = String(v);
          } else if (v && typeof v === "object") scan(v);
        }
      };
      [...(events.data ?? []), ...(callbacks.data ?? []), ...(cnLogs.data ?? [])].forEach(scan);

      setReport({
        session: s,
        battery_id: battery,
        payments: payments.data ?? [],
        refunds: refunds.data ?? [],
        rental_events: events.data ?? [],
        chargenow_api_logs: cnLogs.data ?? [],
        stripe_api_logs: stripeLogs.data ?? [],
        chargenow_callbacks: callbacks.data ?? [],
        cabinet_events: cabEvents.data ?? [],
        generated_at: new Date().toISOString(),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadRecent(); }, [loadRecent]);

  // Auto-refresh the currently selected report.
  useEffect(() => {
    if (!auto || !report) return;
    const i = setInterval(() => loadReport(report.session.id), 5000);
    return () => clearInterval(i);
  }, [auto, report, loadReport]);

  const handleSearch = async () => {
    const q = query.trim();
    if (!q) return;
    // Allow lookup by UUID, or by public session code.
    if (/^[0-9a-f-]{36}$/i.test(q)) { loadReport(q); return; }
    const { data } = await supabase
      .from("rental_sessions")
      .select("id")
      .eq("public_session_code", q)
      .maybeSingle();
    if (data?.id) loadReport(data.id);
    else setError("Aucune session pour cet identifiant / code.");
  };

  const download = (kind: "json" | "txt") => {
    if (!report) return;
    let content: string;
    let mime: string;
    if (kind === "json") {
      content = JSON.stringify(report, null, 2);
      mime = "application/json";
    } else {
      const s = report.session;
      content = [
        `RAPPORT DE TEST DE LOCATION — Chargeurs.ch`,
        `Généré: ${report.generated_at}`,
        ``,
        `Session ID:           ${s.id}`,
        `Code session public:  ${s.public_session_code ?? "—"}`,
        `État actuel:          ${s.state ?? "—"}`,
        `Borne (station):      ${s.station_id ?? "—"}  (cabinet ${s.cabinet_id ?? "—"})`,
        `Slot demandé:         ${s.selected_slot_num ?? "—"}`,
        `Batterie:             ${report.battery_id ?? "—"}`,
        ``,
        `--- TARIF ---`,
        `Prix calculé:         ${money(s.amount, s.currency)}`,
        `Attendu / payé:       ${money(s.amount_expected, s.currency)} / ${money(s.amount_paid, s.currency)}`,
        `Profil tarifaire:     ${s.price_profile_id ?? "—"} (v${s.price_profile_version ?? "—"})`,
        `Hash snapshot:        ${s.pricing_snapshot_hash ?? "—"}`,
        ``,
        `--- STRIPE ---`,
        `Statut paiement:      ${s.state ?? "—"}`,
        `Checkout Session:     ${s.stripe_checkout_session_id ?? "—"}`,
        `PaymentIntent:        ${s.stripe_payment_intent_id ?? "—"}`,
        `Moyen de paiement:    ${s.stripe_payment_method_type ?? "—"}`,
        ``,
        `--- CHARGENOW ---`,
        `Trade No:             ${s.apifox_trade_no ?? "—"}`,
        `Order ID:             ${s.chargenow_order_id ?? "—"}`,
        `Statut ChargeNow:     ${s.chargenow_status ?? "—"}`,
        ``,
        `--- ERREURS ---`,
        `Code erreur:          ${s.error_code ?? s.failure_code ?? "—"}`,
        `Message erreur:       ${s.error_message ?? s.failure_message ?? "—"}`,
        `Tentatives:           ${s.retry_count ?? 0}`,
        ``,
        `--- TIMESTAMPS ---`,
        `Créée:                ${fmt(s.created_at)}`,
        `Payée:                ${fmt(s.paid_at)}`,
        `Démarrée:             ${fmt(s.started_at)}`,
        `Éjectée:              ${fmt(s.ejected_at)}`,
        `Retournée:            ${fmt(s.returned_at)}`,
        `Complétée:            ${fmt(s.completed_at)}`,
        `Clôturée:             ${fmt(s.closed_at)}`,
        `Annulée:              ${fmt(s.cancelled_at)}`,
        `Mise à jour:          ${fmt(s.updated_at)}`,
        ``,
        `--- COMMANDES / RÉPONSES CHARGENOW (api_logs) ---`,
        JSON.stringify(report.chargenow_api_logs, null, 2),
        ``,
        `--- CALLBACKS CHARGENOW ---`,
        JSON.stringify(report.chargenow_callbacks, null, 2),
        ``,
        `--- ÉVÉNEMENTS DE LOCATION ---`,
        JSON.stringify(report.rental_events, null, 2),
      ].join("\n");
      mime = "text/plain";
    }
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `test-location-${report.session.public_session_code ?? report.session.id}.${kind}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const s = report?.session;

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold">Contrôle de test (staging)</h1>
          <p className="text-sm text-muted-foreground">
            Suivi en lecture seule d'une location de test réelle. Aucune écriture, aucun paiement déclenché.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setAuto((a) => !a)} className="gap-2">
            <RefreshCw className={`h-4 w-4 ${auto ? "animate-spin" : ""}`} />
            {auto ? "Auto 5s" : "Manuel"}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => report && loadReport(report.session.id)} className="gap-2">
            <RefreshCw className="h-4 w-4" />Rafraîchir
          </Button>
        </div>
      </div>

      <div className="glass liquid-border rounded-2xl p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            placeholder="ID de session (UUID) ou code public…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            className="max-w-md"
          />
          <Button onClick={handleSearch} className="gap-2"><Search className="h-4 w-4" />Suivre</Button>
        </div>
        {recent.length > 0 && (
          <div className="mt-4">
            <div className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">Sessions récentes</div>
            <div className="flex flex-wrap gap-2">
              {recent.map((r) => (
                <button
                  key={r.id}
                  onClick={() => loadReport(r.id)}
                  className="rounded-lg bg-muted/40 px-3 py-1.5 text-xs hover:bg-muted"
                >
                  <span className="font-mono">{r.public_session_code ?? r.id.slice(0, 8)}</span>
                  {" · "}{r.station_id ?? "—"}{" · "}<b>{r.state}</b>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {error && <div className="rounded-2xl bg-destructive/15 p-4 text-sm text-destructive">{error}</div>}
      {loading && !report && <p className="text-muted-foreground">Chargement…</p>}

      {s && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display text-xl font-bold">
              Session <span className="font-mono text-base">{s.public_session_code ?? s.id}</span>
            </h2>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => download("json")} className="gap-2">
                <FileJson className="h-4 w-4" />Export JSON
              </Button>
              <Button variant="secondary" size="sm" onClick={() => download("txt")} className="gap-2">
                <FileText className="h-4 w-4" />Export texte
              </Button>
              <Download className="hidden" />
            </div>
          </div>

          <div className="glass liquid-border rounded-2xl p-5">
            <h3 className="mb-3 font-semibold">Identité & état</h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Session ID" value={s.id} mono />
              <Field label="Code public" value={s.public_session_code} mono />
              <Field label="État actuel" value={<b>{s.state}</b>} />
              <Field label="Borne (station)" value={s.station_id} mono />
              <Field label="Cabinet" value={s.cabinet_id} mono />
              <Field label="Slot demandé" value={s.selected_slot_num} />
              <Field label="Batterie" value={report?.battery_id} mono />
            </div>
          </div>

          <div className="glass liquid-border rounded-2xl p-5">
            <h3 className="mb-3 font-semibold">Tarif</h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Prix calculé" value={money(s.amount, s.currency)} />
              <Field label="Attendu" value={money(s.amount_expected, s.currency)} />
              <Field label="Payé" value={money(s.amount_paid, s.currency)} />
              <Field label="Profil tarifaire" value={s.price_profile_id} mono />
              <Field label="Version profil" value={s.price_profile_version} />
              <Field label="Hash snapshot" value={s.pricing_snapshot_hash} mono />
            </div>
          </div>

          <div className="glass liquid-border rounded-2xl p-5">
            <h3 className="mb-3 font-semibold">Paiement Stripe</h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Statut paiement" value={<b>{s.state}</b>} />
              <Field label="Checkout Session ID" value={s.stripe_checkout_session_id} mono />
              <Field label="PaymentIntent ID" value={s.stripe_payment_intent_id} mono />
              <Field label="Moyen de paiement" value={s.stripe_payment_method_type} />
            </div>
          </div>

          <div className="glass liquid-border rounded-2xl p-5">
            <h3 className="mb-3 font-semibold">ChargeNow</h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Trade No" value={s.apifox_trade_no} mono />
              <Field label="Order ID" value={s.chargenow_order_id} mono />
              <Field label="Statut ChargeNow" value={s.chargenow_status} />
            </div>
          </div>

          <div className="glass liquid-border rounded-2xl p-5">
            <h3 className="mb-3 font-semibold">Erreurs</h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Code erreur" value={s.error_code ?? s.failure_code} mono />
              <Field label="Message erreur" value={s.error_message ?? s.failure_message} />
              <Field label="Tentatives" value={s.retry_count ?? 0} />
            </div>
          </div>

          <div className="glass liquid-border rounded-2xl p-5">
            <h3 className="mb-3 font-semibold">Timestamps des étapes</h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Créée" value={fmt(s.created_at)} />
              <Field label="Payée" value={fmt(s.paid_at)} />
              <Field label="Démarrée" value={fmt(s.started_at)} />
              <Field label="Éjectée" value={fmt(s.ejected_at)} />
              <Field label="Retournée" value={fmt(s.returned_at)} />
              <Field label="Complétée" value={fmt(s.completed_at)} />
              <Field label="Clôturée" value={fmt(s.closed_at)} />
              <Field label="Annulée" value={fmt(s.cancelled_at)} />
              <Field label="Mise à jour" value={fmt(s.updated_at)} />
            </div>
          </div>

          <JsonBlock label="Commandes & réponses ChargeNow (api_logs)" data={report?.chargenow_api_logs} />
          <JsonBlock label="Callbacks ChargeNow reçus" data={report?.chargenow_callbacks} />
          <JsonBlock label="Événements de borne (cabinet_events)" data={report?.cabinet_events} />
          <JsonBlock label="Événements de location" data={report?.rental_events} />
          <JsonBlock label="Webhooks / logs Stripe" data={report?.stripe_api_logs} />
          <JsonBlock label="Paiements" data={report?.payments} />
          <JsonBlock label="Remboursements" data={report?.refunds} />
          <p className="text-xs text-muted-foreground">
            Pricing snapshot complet inclus dans l'export JSON. Aucun secret n'est affiché.
          </p>
        </>
      )}
    </div>
  );
}
