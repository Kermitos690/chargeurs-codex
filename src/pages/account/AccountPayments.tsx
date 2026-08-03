import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CircleDollarSign, CreditCard, HelpCircle, Loader2, RefreshCw, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CustomerPayment,
  CustomerRefund,
  fetchCustomerPayments,
  fetchPrivateAccountSummary,
  formatAccountDate,
  formatAccountMoney,
} from "./accountData";

const PAYMENT_LABELS: Record<string, string> = {
  pending: "En attente",
  processing: "En traitement",
  succeeded: "Payé",
  paid: "Payé",
  failed: "Échec",
  canceled: "Annulé",
  refunded: "Remboursé",
  partially_refunded: "Partiellement remboursé",
};

const REFUND_LABELS: Record<string, string> = {
  pending: "En cours",
  succeeded: "Effectué",
  failed: "Échec",
  canceled: "Annulé",
};

export default function AccountPayments() {
  const [payments, setPayments] = useState<CustomerPayment[]>([]);
  const [refunds, setRefunds] = useState<CustomerRefund[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const [paymentRows, summary] = await Promise.all([
        fetchCustomerPayments(),
        fetchPrivateAccountSummary(),
      ]);
      setPayments(paymentRows);
      setRefunds(summary.refunds);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-7 pt-3">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-extrabold">Paiements</h1>
          <p className="mt-1 text-sm text-muted-foreground">Transactions et remboursements reliés uniquement à vos locations.</p>
        </div>
        <Button variant="outline" size="sm" className="rounded-full" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />Actualiser
        </Button>
      </header>

      {loading && <div className="glass grid min-h-56 place-items-center rounded-3xl"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>}
      {!loading && error && (
        <section className="rounded-3xl border border-warning/30 bg-warning/10 p-6" role="alert">
          <h2 className="font-semibold text-warning">Historique de paiement indisponible</h2>
          <p className="mt-1 text-sm text-muted-foreground">Les données ne sont ni remplacées ni estimées.</p>
          <Button variant="outline" size="sm" className="mt-4 rounded-full" onClick={() => void load()}>Réessayer</Button>
        </section>
      )}

      {!loading && !error && payments.length === 0 && refunds.length === 0 && (
        <section className="glass rounded-3xl p-9 text-center">
          <CircleDollarSign className="mx-auto h-11 w-11 text-primary" />
          <h2 className="mt-4 font-display text-xl font-bold">Aucune transaction</h2>
          <p className="mt-2 text-sm text-muted-foreground">Vos paiements Stripe Checkout apparaîtront ici après confirmation serveur.</p>
        </section>
      )}

      {!loading && !error && payments.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Paiements</h2>
          {payments.map((payment) => (
            <article key={payment.id} className="glass rounded-2xl p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2"><CreditCard className="h-5 w-5 text-primary" /><h3 className="font-semibold">{payment.payment_method || "Paiement en ligne"}</h3></div>
                  <p className="mt-2 text-xs text-muted-foreground">{formatAccountDate(payment.created_at)}</p>
                  {payment.rental_session_id && <p className="mt-1 font-mono text-xs text-muted-foreground">Location {payment.rental_session_id.slice(0, 8)}</p>}
                </div>
                <div className="text-right"><p className="font-bold">{formatAccountMoney(payment.amount, payment.currency)}</p><Badge variant="secondary" className="mt-2">{PAYMENT_LABELS[payment.status ?? ""] ?? "À vérifier"}</Badge></div>
              </div>
            </article>
          ))}
        </section>
      )}

      {!loading && !error && refunds.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Remboursements</h2>
          {refunds.map((refund) => (
            <article key={refund.id} className="glass rounded-2xl p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><div className="flex items-center gap-2"><RotateCcw className="h-5 w-5 text-success" /><h3 className="font-semibold">{REFUND_LABELS[refund.status] ?? "À vérifier"}</h3></div><p className="mt-2 text-xs text-muted-foreground">Demandé le {formatAccountDate(refund.created_at)}</p>{refund.reason && <p className="mt-2 text-sm text-muted-foreground">{refund.reason}</p>}</div>
                <p className="font-bold text-success">{formatAccountMoney(refund.amount, refund.currency)}</p>
              </div>
            </article>
          ))}
        </section>
      )}

      <section className="glass flex flex-col items-start justify-between gap-4 rounded-2xl p-5 sm:flex-row sm:items-center">
        <div><h2 className="font-semibold">Question sur un paiement ?</h2><p className="mt-1 text-sm text-muted-foreground">Ne transmettez jamais votre numéro de carte complet.</p></div>
        <Button asChild variant="outline" className="shrink-0 rounded-full"><Link to="/compte/support"><HelpCircle className="mr-2 h-4 w-4" />Contacter le support</Link></Button>
      </section>
    </div>
  );
}
