import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { DataTable, StateChip } from "@/components/admin/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Loader2, RefreshCw, Search } from "lucide-react";

type Row = any;

function actionError(code?: string, fallback?: string) {
  if (code === "FORBIDDEN") return "Votre rôle ne permet pas cette action.";
  if (code === "INVALID_STATE") return "Cette action n’est pas disponible dans l’état actuel de la location.";
  if (code === "RENTAL_NOT_FOUND") return "Cette location n’existe plus.";
  if (code === "MAX_RETRIES") return "Le nombre maximal de tentatives a été atteint. Une revue manuelle est requise.";
  if (code === "PHYSICAL_STATE_UNCONFIRMED") return "État physique ambigu : aucune nouvelle commande matérielle n’a été envoyée.";
  return code || fallback || "Action refusée";
}

export default function AdminOrders() {
  const { canWrite, isSuperAdmin } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState("");
  const [detail, setDetail] = useState<Row | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-finance-read", { body: { action: "rentals" } });
      if (error || !data?.ok) {
        if (!silent) toast.error(data?.error ?? error?.message ?? "Impossible de charger les locations.");
        return;
      }
      setRows((data.rentals ?? []) as Row[]);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const i = window.setInterval(() => void load(true), 8000);
    return () => window.clearInterval(i);
  }, [load]);

  const filtered = rows.filter((r) => {
    if (!q) return true;
    const hay = `${r.public_session_code} ${r.state} ${r.station_id} ${r.apifox_trade_no} ${r.stripe_checkout_session_id}`.toLowerCase();
    return hay.includes(q.toLowerCase());
  });

  const act = async (action: string, id: string) => {
    setBusy(action + id);
    try {
      const { data, error } = await supabase.functions.invoke("rental-admin-action", { body: { action, rentalSessionId: id } });
      if (error || !data?.ok) {
        toast.error(actionError(data?.error, error?.message));
        return;
      }
      toast.success("Action exécutée");
      await load(true);
      setDetail(null);
    } finally {
      setBusy(null);
    }
  };

  const fmt = (d: string | null) => (d ? new Date(d).toLocaleString() : "—");

  return (
    <div className="animate-fade-in">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-bold">Locations / Commandes</h1>
        <div className="flex items-center gap-2">
          <div className="glass flex items-center gap-2 rounded-xl px-3"><Search className="h-4 w-4 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher…" className="border-0 bg-transparent focus-visible:ring-0" />
          </div>
          <Button variant="ghost" onClick={() => void load()} disabled={loading} className="gap-2" aria-label="Actualiser">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      <DataTable
        columns={["Code", "État", "Stripe", "ChargeNow", "Station", "Slot", "Attendu", "Payé", "Moyen", "Créé", "Payé le", "Retries", ""]}
        empty={loading ? "Chargement…" : "Aucune location."}
        rows={filtered.map((r) => [
          <span className="font-mono text-xs">{r.public_session_code ?? String(r.id).slice(0, 8)}</span>,
          <StateChip state={r.state} />,
          <span className="font-mono text-xs">{r.stripe_checkout_session_id ? "✓" : "—"}</span>,
          <span className="font-mono text-xs">{r.apifox_trade_no ?? "—"}</span>,
          r.station_id, r.selected_slot_num ?? "—",
          r.amount_expected != null ? `${r.amount_expected} ${r.currency}` : "—",
          r.amount_paid != null ? `${r.amount_paid} ${r.currency}` : "—",
          r.stripe_payment_method_type ?? "—",
          fmt(r.created_at), fmt(r.paid_at), r.retry_count ?? 0,
          <Button size="sm" variant="ghost" onClick={() => setDetail(r)}>Détail</Button>,
        ])}
      />

      {detail && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={() => setDetail(null)}>
          <div className="glass-strong max-h-[85vh] w-full max-w-2xl overflow-auto rounded-2xl p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-2 font-display text-2xl font-bold">{detail.public_session_code ?? detail.id}</h2>
            <div className="mb-4"><StateChip state={detail.state} /></div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              {[
                ["Station", detail.station_id], ["Cabinet", detail.cabinet_id], ["Shop", detail.shop_id],
                ["Slot", detail.selected_slot_num], ["TradeNo", detail.apifox_trade_no], ["Order id", detail.chargenow_order_id],
                ["CN status", detail.chargenow_status], ["Stripe PI", detail.stripe_payment_intent_id],
                ["Attendu", `${detail.amount_expected ?? "—"} ${detail.currency}`], ["Payé", `${detail.amount_paid ?? "—"} ${detail.currency}`],
                ["Moyen", detail.stripe_payment_method_type], ["Retries", detail.retry_count],
                ["Créé", fmt(detail.created_at)], ["Payé", fmt(detail.paid_at)], ["Éjecté", fmt(detail.ejected_at)],
                ["Retour", fmt(detail.returned_at)], ["Settlement", detail.settlement_status], ["Erreur settlement", detail.settlement_error],
                ["Erreur", detail.failure_code], ["Message", detail.failure_message],
              ].map(([k, v]) => (
                <div key={k as string} className="rounded-lg bg-muted/30 p-2"><div className="text-xs text-muted-foreground">{k}</div><div className="break-all font-mono text-xs">{String(v ?? "—")}</div></div>
              ))}
            </div>
            {canWrite ? (
              <div className="mt-6 flex flex-wrap gap-2">
                <Button size="sm" onClick={() => void act("retry_chargenow", detail.id)} disabled={!!busy}>
                  {busy === "retry_chargenow" + detail.id ? <Loader2 className="h-4 w-4 animate-spin" /> : "Réessayer ChargeNow"}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => void act("reconcile", detail.id)} disabled={!!busy}>Réconcilier</Button>
                <Button size="sm" variant="secondary" onClick={() => void act("manual_review", detail.id)} disabled={!!busy}>Revue manuelle</Button>
                {isSuperAdmin && <Button size="sm" variant="destructive" onClick={() => void act("refund", detail.id)} disabled={!!busy}>Rembourser</Button>}
              </div>
            ) : (
              <p className="mt-6 text-sm text-muted-foreground">Lecture seule — votre rôle ne permet pas d'actions sur les locations.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
