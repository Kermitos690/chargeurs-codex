import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { DataTable, StateChip } from "@/components/admin/DataTable";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { AlertTriangle, Loader2, RefreshCw, RotateCcw, SearchCheck } from "lucide-react";
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

interface RentalRow {
  id: string;
  public_session_code: string | null;
  station_id: string;
  apifox_trade_no: string | null;
  selected_slot_num: number | null;
  state: string;
  settlement_status: string | null;
  settlement_strategy: string | null;
  deposit_amount_cents: number | null;
  final_amount_cents: number | null;
  captured_amount_cents: number | null;
  refunded_amount_cents: number | null;
  supplemental_amount_cents: number | null;
  settlement_error: string | null;
  created_at: string;
  paid_at: string | null;
  ejected_at: string | null;
  returned_at: string | null;
  settled_at: string | null;
}

type RentalAction =
  | "retry_chargenow"
  | "reconcile"
  | "retry_settlement"
  | "declare_non_return"
  | "manual_review";

const SELECT_FIELDS = [
  "id",
  "public_session_code",
  "station_id",
  "apifox_trade_no",
  "selected_slot_num",
  "state",
  "settlement_status",
  "settlement_strategy",
  "deposit_amount_cents",
  "final_amount_cents",
  "captured_amount_cents",
  "refunded_amount_cents",
  "supplemental_amount_cents",
  "settlement_error",
  "created_at",
  "paid_at",
  "ejected_at",
  "returned_at",
  "settled_at",
].join(",");

function money(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "—";
  return new Intl.NumberFormat("fr-CH", {
    style: "currency",
    currency: "CHF",
  }).format(cents / 100);
}

function dateTime(value: string | null): string {
  return value ? new Date(value).toLocaleString("fr-CH") : "—";
}

function SettlementChip({ status }: { status: string | null }) {
  if (!status) return <span className="text-xs text-muted-foreground">ancien flux</span>;
  const tone =
    status === "settled"
      ? "bg-success/15 text-success"
      : ["failed", "manual_review", "supplemental_required"].includes(status)
        ? "bg-destructive/15 text-destructive"
        : ["authorized", "prepaid", "settling"].includes(status)
          ? "bg-warning/15 text-warning"
          : "bg-muted text-muted-foreground";
  return <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${tone}`}>{status}</span>;
}

export default function AdminRentals() {
  const [rows, setRows] = useState<RentalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: queryError } = await supabase
      .from("rental_sessions")
      .select(SELECT_FIELDS)
      .order("created_at", { ascending: false })
      .limit(100);

    if (queryError) {
      setError(queryError.message);
      setRows([]);
    } else {
      setRows((data ?? []) as unknown as RentalRow[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const callAction = async (row: RentalRow, action: RentalAction) => {
    const key = `${row.id}:${action}`;
    setBusy(key);
    try {
      const { data, error: invokeError } = await supabase.functions.invoke("rental-admin-action", {
        body: { action, rentalSessionId: row.id },
      });
      if (invokeError) throw invokeError;
      const result = data as { ok?: boolean; error?: string; requires_action?: boolean } | null;
      if (!result?.ok) throw new Error(result?.error ?? "Action non terminée");
      toast.success(`Action « ${action} » terminée pour ${row.public_session_code ?? row.id.slice(0, 8)}`);
      await load();
    } catch (actionError) {
      toast.error(actionError instanceof Error ? actionError.message : "Échec de l'action");
    } finally {
      setBusy(null);
    }
  };

  const unresolved = useMemo(
    () => rows.filter((row) => ["failed", "manual_review", "supplemental_required"].includes(row.settlement_status ?? "")).length,
    [rows],
  );

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold">Locations et règlements</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Les montants sont exprimés en centimes côté serveur. Les actions financières passent exclusivement par une Edge Function protégée.
          </p>
        </div>
        <Button variant="ghost" onClick={load} disabled={loading} className="gap-2 border border-border">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Rafraîchir
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryCard label="Locations chargées" value={rows.length} />
        <SummaryCard label="Règlements à traiter" value={unresolved} danger={unresolved > 0} />
        <SummaryCard label="Règlements terminés" value={rows.filter((row) => row.settlement_status === "settled").length} />
      </div>

      {error && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          Impossible de charger les nouvelles colonnes de règlement : {error}. La migration staging doit être appliquée avant d'utiliser cette console.
        </div>
      )}

      <DataTable
        columns={[
          "Session",
          "Borne",
          "État matériel",
          "Règlement",
          "Stratégie",
          "Caution",
          "Final",
          "Capturé",
          "Remboursé",
          "Complément",
          "Retour",
          "Actions",
        ]}
        empty={loading ? "Chargement…" : "Aucune location pour l'instant."}
        rows={rows.map((row) => [
          <div key={`${row.id}:session`}>
            <div className="font-mono text-xs font-semibold">{row.public_session_code ?? row.id.slice(0, 8)}</div>
            <div className="mt-1 font-mono text-[10px] text-muted-foreground">{row.apifox_trade_no ?? "sans tradeNo"}</div>
          </div>,
          <div key={`${row.id}:station`}>
            <div>{row.station_id}</div>
            <div className="text-xs text-muted-foreground">slot {row.selected_slot_num ?? "—"}</div>
          </div>,
          <StateChip key={`${row.id}:state`} state={row.state} />,
          <div key={`${row.id}:settlement`} className="space-y-1">
            <SettlementChip status={row.settlement_status} />
            {row.settlement_error && <div className="max-w-44 whitespace-normal text-[10px] text-destructive">{row.settlement_error}</div>}
          </div>,
          <span key={`${row.id}:strategy`} className="font-mono text-xs">{row.settlement_strategy ?? "—"}</span>,
          money(row.deposit_amount_cents),
          money(row.final_amount_cents),
          money(row.captured_amount_cents),
          money(row.refunded_amount_cents),
          money(row.supplemental_amount_cents),
          <div key={`${row.id}:dates`} className="text-xs">
            <div>{dateTime(row.returned_at)}</div>
            {row.settled_at && <div className="text-muted-foreground">réglé {dateTime(row.settled_at)}</div>}
          </div>,
          <RentalActions
            key={`${row.id}:actions`}
            row={row}
            busy={busy}
            onAction={callAction}
          />,
        ])}
      />
    </div>
  );
}

function SummaryCard({ label, value, danger = false }: { label: string; value: number; danger?: boolean }) {
  return (
    <div className="glass liquid-border rounded-2xl p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${danger ? "text-destructive" : ""}`}>{value}</div>
    </div>
  );
}

function RentalActions({
  row,
  busy,
  onAction,
}: {
  row: RentalRow;
  busy: string | null;
  onAction: (row: RentalRow, action: RentalAction) => Promise<void>;
}) {
  const isBusy = (action: RentalAction) => busy === `${row.id}:${action}`;
  const settled = row.settlement_status === "settled";
  const returned = Boolean(row.returned_at) || row.state === "battery_returned";
  const canRetrySettlement = returned && !settled;
  const canDeclareNonReturn = !returned && !settled && ["ejected", "battery_taken", "active_rental", "needs_support"].includes(row.state);

  return (
    <div className="flex min-w-56 flex-wrap gap-1.5">
      <Button
        size="sm"
        variant="ghost"
        className="h-8 gap-1 border border-border px-2 text-xs"
        disabled={Boolean(busy)}
        onClick={() => onAction(row, "reconcile")}
      >
        {isBusy("reconcile") ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <SearchCheck className="h-3.5 w-3.5" />}
        Réconcilier
      </Button>

      {canRetrySettlement && (
        <Button
          size="sm"
          variant="ghost"
          className="h-8 gap-1 border border-border px-2 text-xs"
          disabled={Boolean(busy)}
          onClick={() => onAction(row, "retry_settlement")}
        >
          {isBusy("retry_settlement") ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
          Rejouer règlement
        </Button>
      )}

      {canDeclareNonReturn && (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="sm" variant="destructive" className="h-8 gap-1 px-2 text-xs" disabled={Boolean(busy)}>
              {isBusy("declare_non_return") ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <AlertTriangle className="h-3.5 w-3.5" />}
              Non-retour
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent className="glass-strong">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-destructive">Déclarer la batterie non retournée ?</AlertDialogTitle>
              <AlertDialogDescription>
                Cette action super-administrateur recalcule le montant final avec la règle de non-retour, actuellement ciblée à 99 CHF, puis tente de régler le complément. Elle est auditée et ne doit être utilisée qu'après vérification matérielle et ChargeNow.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Annuler</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => onAction(row, "declare_non_return")}
              >
                Confirmer le non-retour
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}
