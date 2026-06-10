import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Loader2, BatteryCharging, MapPin, Receipt, RefreshCw } from "lucide-react";

type Rental = {
  id: string;
  station_id: string | null;
  state: string;
  amount_paid: number | null;
  amount_expected: number | null;
  currency: string | null;
  created_at: string;
  paid_at: string | null;
  ejected_at: string | null;
  returned_at: string | null;
  closed_at: string | null;
};

const ACTIVE_STATES = ["ejected", "battery_taken", "active_rental"];

const STATE_LABELS: Record<string, string> = {
  ejected: "Batterie distribuée",
  battery_taken: "Batterie retirée",
  active_rental: "Location en cours",
  battery_returned: "Batterie rendue",
  closing: "Clôture en cours",
  closed: "Terminée",
  payment_succeeded: "Payée",
  refunded: "Remboursée",
  partially_refunded: "Partiellement remboursée",
  refund_pending: "Remboursement en cours",
  needs_support: "Vérification en cours",
};

function stateLabel(s: string) {
  return STATE_LABELS[s] ?? s;
}

function money(amount: number | null, currency: string | null) {
  if (amount == null) return "—";
  return new Intl.NumberFormat("fr-CH", { style: "currency", currency: currency ?? "CHF" }).format(amount);
}

function fmtDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleString("fr-CH", { dateStyle: "medium", timeStyle: "short" });
}

export default function AccountDashboard() {
  const [rentals, setRentals] = useState<Rental[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("rental_sessions")
      .select("id,station_id,state,amount_paid,amount_expected,currency,created_at,paid_at,ejected_at,returned_at,closed_at")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) {
      toast.error("Impossible de charger vos locations.");
    } else {
      setRentals((data ?? []) as Rental[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const active = rentals.filter((r) => ACTIVE_STATES.includes(r.state));
  const history = rentals.filter((r) => !ACTIVE_STATES.includes(r.state));

  return (
    <div className="space-y-8 pt-2">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold">Mes locations</h1>
          <p className="text-sm text-muted-foreground">Historique et suivi de vos batteries louées.</p>
        </div>
        <Button variant="outline" size="sm" className="rounded-full" onClick={load} disabled={loading}>
          <RefreshCw className={`mr-1.5 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Actualiser
        </Button>
      </header>

      {loading ? (
        <div className="grid place-items-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
      ) : rentals.length === 0 ? (
        <div className="glass rounded-3xl p-10 text-center">
          <BatteryCharging className="mx-auto mb-4 h-10 w-10 text-primary" />
          <p className="font-semibold">Aucune location pour le moment</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Vos locations apparaîtront ici après un paiement effectué avec cette adresse email.
          </p>
        </div>
      ) : (
        <>
          {active.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">En cours</h2>
              {active.map((r) => (
                <div key={r.id} className="glass-strong liquid-border rounded-3xl p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <BatteryCharging className="h-5 w-5 text-primary" />
                        <span className="font-semibold">{stateLabel(r.state)}</span>
                      </div>
                      <p className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
                        <MapPin className="h-4 w-4" /> Borne {r.station_id ?? "—"}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">Démarrée le {fmtDate(r.ejected_at ?? r.paid_at)}</p>
                    </div>
                    <Badge className="bg-gradient-primary">{money(r.amount_paid ?? r.amount_expected, r.currency)}</Badge>
                  </div>
                </div>
              ))}
            </section>
          )}

          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Historique</h2>
            {history.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucune location passée.</p>
            ) : (
              history.map((r) => (
                <div key={r.id} className="glass rounded-2xl p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Receipt className="h-4 w-4 text-muted-foreground" />
                        <span className="font-semibold">{stateLabel(r.state)}</span>
                      </div>
                      <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                        <MapPin className="h-4 w-4" /> Borne {r.station_id ?? "—"}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">{fmtDate(r.paid_at ?? r.created_at)}</p>
                    </div>
                    <Badge variant="secondary">{money(r.amount_paid ?? r.amount_expected, r.currency)}</Badge>
                  </div>
                </div>
              ))
            )}
          </section>
        </>
      )}
    </div>
  );
}
