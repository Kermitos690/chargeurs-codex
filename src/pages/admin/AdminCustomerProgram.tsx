import { useCallback, useEffect, useState } from "react";
import { Crown, Gem, Loader2, RefreshCw, TicketPercent, Users, WalletCards } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

type Data = {
  metrics: {
    memberships: number;
    membershipCounts: Record<string, number>;
    walletPasses: number;
    passCounts: Record<string, number>;
    activePointRules: number;
    recentPointsIssued: number;
    activePromotions: number;
  };
  plans: any[];
  memberships: any[];
  passes: any[];
  pointRules: any[];
  recentPointLedger: any[];
  promotions: any[];
};

function Metric({ icon: Icon, label, value }: { icon: typeof Crown; label: string; value: string | number }) {
  return <div className="glass liquid-border rounded-2xl p-5"><Icon className="h-6 w-6 text-primary" /><div className="mt-4 text-sm text-muted-foreground">{label}</div><div className="mt-1 text-3xl font-bold">{value}</div></div>;
}

const money = (cents: number | null | undefined, currency = "CHF") => cents == null ? "—" : `${(Number(cents) / 100).toFixed(2)} ${currency}`;

export default function AdminCustomerProgram() {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(false);
    const { data: result, error: invokeError } = await supabase.functions.invoke("admin-customer-program", { body: {} });
    if (invokeError || !result?.ok) { setError(true); setLoading(false); return; }
    setData(result as Data); setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><h1 className="font-display text-3xl font-bold">Client Chargeurs</h1><p className="mt-1 text-sm text-muted-foreground">Plans, adhésions, Chargeurs+ Pass, ChargePoints et promotions.</p></div>
        <Button variant="ghost" className="gap-2" onClick={() => void load()} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />Rafraîchir</Button>
      </div>

      {loading && <div className="glass grid min-h-52 place-items-center rounded-3xl"><Loader2 className="h-9 w-9 animate-spin text-primary" /></div>}
      {!loading && error && <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-5 text-destructive">Les données du programme client ne sont pas disponibles.</div>}

      {!loading && data && <>
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <Metric icon={Users} label="Adhésions" value={data.metrics.memberships} />
          <Metric icon={WalletCards} label="Pass" value={data.metrics.walletPasses} />
          <Metric icon={Gem} label="Règles ChargePoints actives" value={data.metrics.activePointRules} />
          <Metric icon={Gem} label="Points récents émis" value={data.metrics.recentPointsIssued} />
          <Metric icon={TicketPercent} label="Promotions actives" value={data.metrics.activePromotions} />
        </section>

        <section className="glass liquid-border overflow-hidden rounded-2xl">
          <div className="border-b border-border/50 p-5"><h2 className="font-semibold">Plans</h2><p className="mt-1 text-sm text-muted-foreground">Les montants affichés viennent des plans configurés dans Supabase.</p></div>
          <div className="overflow-x-auto"><table className="w-full min-w-[800px] text-left text-sm"><thead className="bg-muted/20 text-xs uppercase tracking-wide text-muted-foreground"><tr><th className="px-4 py-3">Plan</th><th className="px-4 py-3">Facturation</th><th className="px-4 py-3">Cotisation</th><th className="px-4 py-3">Crédit</th><th className="px-4 py-3">Tarif</th><th className="px-4 py-3">Plafond</th><th className="px-4 py-3">État</th></tr></thead><tbody>{data.plans.map((p:any)=><tr key={p.id} className="border-t border-border/40"><td className="px-4 py-3 font-bold">{p.name}<div className="font-mono text-xs text-muted-foreground">{p.code}</div></td><td className="px-4 py-3">{p.billing_interval_count} × {p.billing_interval}</td><td className="px-4 py-3">{money(p.annual_fee_cents,p.currency)}</td><td className="px-4 py-3">{money(p.renewal_credit_cents,p.currency)}</td><td className="px-4 py-3">{money(p.hourly_cents,p.currency)}/h</td><td className="px-4 py-3">{money(p.daily_cap_cents,p.currency)}/j</td><td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${p.active?"bg-success/15 text-success":"bg-muted text-muted-foreground"}`}>{p.active?"Actif":"Inactif"}</span></td></tr>)}</tbody></table></div>
        </section>

        <section className="grid gap-4 xl:grid-cols-2">
          <div className="glass overflow-hidden rounded-2xl"><div className="border-b border-border/50 p-5"><h2 className="font-semibold">Adhésions récentes</h2></div><div className="max-h-[430px] overflow-auto">{data.memberships.slice(0,30).map((m:any)=><div key={m.id} className="border-b border-border/30 p-4 last:border-0"><div className="flex justify-between gap-3"><span className="font-mono text-xs">{String(m.user_id).slice(0,8)}…</span><b>{m.status}</b></div><p className="mt-1 text-xs text-muted-foreground">Renouvellement : {m.renews_at?new Date(m.renews_at).toLocaleString("fr-CH"):"—"}</p></div>)}{!data.memberships.length&&<p className="p-5 text-muted-foreground">Aucune adhésion.</p>}</div></div>
          <div className="glass overflow-hidden rounded-2xl"><div className="border-b border-border/50 p-5"><h2 className="font-semibold">État des Pass</h2></div><div className="max-h-[430px] overflow-auto">{data.passes.slice(0,30).map((p:any)=><div key={p.id} className="border-b border-border/30 p-4 last:border-0"><div className="flex justify-between gap-3"><span className="font-mono text-xs">{String(p.user_id).slice(0,8)}…</span><b>{p.provider_status}</b></div><p className="mt-1 text-xs text-muted-foreground">Révision {p.pass_revision} · synchronisé {p.last_synced_at?new Date(p.last_synced_at).toLocaleString("fr-CH"):"jamais"}</p></div>)}{!data.passes.length&&<p className="p-5 text-muted-foreground">Aucun Pass.</p>}</div></div>
        </section>

        <section className="grid gap-4 xl:grid-cols-2">
          <div className="glass rounded-2xl p-5"><h2 className="font-semibold">Règles ChargePoints</h2><div className="mt-4 space-y-2">{data.pointRules.map((r:any)=><div key={r.id} className="rounded-xl border border-border/40 bg-muted/10 p-3"><div className="flex justify-between gap-3"><b>{r.name}</b><span className={r.active?"text-success":"text-muted-foreground"}>{r.active?"Active":"Inactive"}</span></div><p className="mt-1 font-mono text-xs text-muted-foreground">{r.event_type} · fixe {r.fixed_points??"—"} · /CHF {r.points_per_chf??"—"}</p></div>)}{!data.pointRules.length&&<p className="text-sm text-muted-foreground">Aucun barème configuré. Aucun point n’est donc attribué automatiquement.</p>}</div></div>
          <div className="glass rounded-2xl p-5"><h2 className="font-semibold">Promotions</h2><div className="mt-4 space-y-2">{data.promotions.map((p:any)=><div key={p.id} className="rounded-xl border border-border/40 bg-muted/10 p-3"><div className="flex justify-between gap-3"><b>{p.name}</b><span className={p.active?"text-success":"text-muted-foreground"}>{p.active?"Active":"Inactive"}</span></div><p className="mt-1 font-mono text-xs text-muted-foreground">{p.code} · {p.audience} · {p.promotion_type}</p></div>)}{!data.promotions.length&&<p className="text-sm text-muted-foreground">Aucune promotion active ou inventée par défaut.</p>}</div></div>
        </section>
      </>}
    </div>
  );
}
