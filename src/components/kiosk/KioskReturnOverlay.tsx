import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Clock, Loader2, ReceiptText, ShieldCheck, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { readKioskToken } from "@/lib/kioskFetch";
import { invokeKioskEdgeProxy } from "@/lib/kioskEdgeProxy";
import { Button } from "@/components/ui/button";

const FINAL_SECONDS = 20;
type Summary = {
  rentalSessionId: string;
  publicCode: string | null;
  currency: string;
  language: string;
  startedAt: string | null;
  returnedAt: string | null;
  completedAt: string | null;
  returnStationId: string | null;
  returnedSlotNum: number | null;
  paymentMode: string | null;
  settlementStrategy: string | null;
  settlementStatus: string | null;
  paymentMethod: string;
  depositCents: number;
  finalAmountCents: number;
  capturedCents: number;
  refundedCents: number;
  releasedAuthorizationCents: number;
  supplementalCents: number;
  totalMinutes: number;
  billedPeriods: number;
  periodMinutes: number;
  pricePerPeriodCents: number;
  dailyCapCents: number;
  failureCode?: string | null;
};
type Result = { ok?: boolean; stage?: "none"|"settling"|"completed"|"support"; summary?: Summary; error?: string };

function stationFromPath() {
  const match = window.location.pathname.match(/^\/kiosk\/(?:station\/)?([A-Za-z0-9_-]{4,32})(?:\/|$)/);
  return match?.[1] ?? null;
}
function money(cents: number | null | undefined, currency = "CHF") { return `${(Number(cents ?? 0) / 100).toFixed(2)} ${currency}`; }
function when(value: string | null | undefined) { if (!value) return "—"; try { return new Intl.DateTimeFormat("fr-CH", { hour:"2-digit", minute:"2-digit" }).format(new Date(value)); } catch { return "—"; } }
function duration(s: Summary) { const mins=s.totalMinutes||((s.startedAt&&s.returnedAt)?Math.max(0,Math.ceil((Date.parse(s.returnedAt)-Date.parse(s.startedAt))/60000)):0); const h=Math.floor(mins/60),m=mins%60; return h?`${h} h ${String(m).padStart(2,"0")}`:`${m} min`; }

export function KioskReturnOverlay() {
  const stationId = stationFromPath();
  const [result,setResult]=useState<Result|null>(null);
  const [seconds,setSeconds]=useState(FINAL_SECONDS);
  const shownRental=useRef<string|null>(null);

  const fetchSummary=useCallback(async()=>{
    const token=readKioskToken(); if(!stationId||!token)return;
    const{data}=await invokeKioskEdgeProxy<Result>("/api/kiosk/return-summary",{stationId},{"X-Kiosk-Token":token});
    if(data?.ok)setResult(data);
  },[stationId]);

  useEffect(()=>{if(!stationId)return;const token=readKioskToken();if(!token)return;let stopped=false;const tick=async()=>{await invokeKioskEdgeProxy("/api/kiosk/cabinet-snapshot",{stationId},{"X-Kiosk-Token":token});if(!stopped)await fetchSummary();};void tick();const id=window.setInterval(()=>void tick(),5000);return()=>{stopped=true;window.clearInterval(id);};},[stationId,fetchSummary]);

  const finish=useCallback(async()=>{
    const token=readKioskToken(),id=result?.summary?.rentalSessionId;if(!stationId||!token||!id)return;
    await invokeKioskEdgeProxy("/api/kiosk/return-summary",{stationId,ackRentalSessionId:id},{"X-Kiosk-Token":token});
    setResult({ok:true,stage:"none"});
    window.dispatchEvent(new CustomEvent("chargeurs:kiosk-flow-complete"));
    window.location.replace(`/kiosk/${stationId}`);
  },[result,stationId]);

  useEffect(()=>{const s=result?.summary;if(result?.stage!=="completed"||!s)return;if(shownRental.current!==s.rentalSessionId){shownRental.current=s.rentalSessionId;setSeconds(FINAL_SECONDS);}const id=window.setInterval(()=>setSeconds(v=>Math.max(0,v-1)),1000);return()=>window.clearInterval(id);},[result]);
  useEffect(()=>{if(result?.stage==="completed"&&seconds===0)void finish();},[seconds,result,finish]);

  if(!stationId||!result?.stage||result.stage==="none"||!result.summary)return null;
  const s=result.summary,currency=s.currency||"CHF";
  return <AnimatePresence><motion.div key={s.rentalSessionId} initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} className="fixed inset-0 z-[120] grid place-items-center overflow-auto bg-slate-950/90 p-5 backdrop-blur-2xl">
    <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_15%,rgba(34,211,238,.2),transparent_38%),radial-gradient(circle_at_20%_90%,rgba(99,102,241,.18),transparent_42%)]"/>
    {result.stage==="settling" ? <motion.section initial={{scale:.97,y:18}} animate={{scale:1,y:0}} className="glass-strong liquid-border relative flex w-full max-w-3xl flex-col items-center rounded-[2.5rem] p-10 text-center shadow-[0_0_80px_rgba(34,211,238,.2)]"><div className="grid h-28 w-28 place-items-center rounded-full bg-primary/15"><ReceiptText className="h-14 w-14 text-primary"/></div><h1 className="mt-7 font-display text-5xl font-extrabold">Retour détecté</h1><p className="mt-4 max-w-2xl text-2xl text-muted-foreground">La batterie est bien revenue. Calcul du prix exact et finalisation du règlement…</p><Loader2 className="mt-8 h-12 w-12 animate-spin text-primary"/><p className="mt-5 font-mono text-sm text-muted-foreground">{s.publicCode}</p></motion.section> : result.stage==="support" ? <motion.section initial={{scale:.97}} animate={{scale:1}} className="glass-strong liquid-border relative w-full max-w-3xl rounded-[2.5rem] p-10 text-center"><div className="mx-auto grid h-24 w-24 place-items-center rounded-full bg-warning/15"><ShieldCheck className="h-12 w-12 text-warning"/></div><h1 className="mt-6 font-display text-4xl font-extrabold">Retour enregistré — vérification en cours</h1><p className="mx-auto mt-4 max-w-xl text-xl text-muted-foreground">La borne a reconnu le retour. Le règlement nécessite une vérification avant d’afficher un montant comme définitif.</p></motion.section> : <motion.section initial={{scale:.96,y:20}} animate={{scale:1,y:0}} className="glass-strong liquid-border relative w-full max-w-5xl rounded-[2.5rem] p-7 shadow-[0_0_90px_rgba(34,211,238,.24)] sm:p-10">
      <button onClick={()=>void finish()} className="absolute right-5 top-5 grid h-11 w-11 place-items-center rounded-full border border-white/15 bg-white/5" aria-label="Terminer"><X className="h-5 w-5"/></button>
      <div className="flex flex-col items-center text-center"><div className="grid h-24 w-24 place-items-center rounded-full bg-success/20 shadow-[0_0_40px_rgba(34,197,94,.2)]"><CheckCircle2 className="h-14 w-14 text-success"/></div><h1 className="mt-4 font-display text-5xl font-extrabold">Location terminée</h1><div className="mt-4 font-display text-7xl font-extrabold text-gradient-cyan">{money(s.finalAmountCents,currency)}</div><p className="mt-2 text-lg font-semibold text-muted-foreground">Prix final confirmé</p></div>
      <div className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4"><Cell label="Durée" value={duration(s)}/><Cell label="Tarif" value={`${money(s.pricePerPeriodCents,currency)} / ${s.periodMinutes||30} min`}/><Cell label="Départ" value={when(s.startedAt)}/><Cell label="Retour" value={when(s.returnedAt)}/><Cell label="Garantie initiale" value={money(s.depositCents,currency)}/><Cell label="Montant capturé" value={money(s.capturedCents,currency)}/>{s.settlementStrategy==="manual_capture"?<Cell label="Autorisation libérée" value={money(s.releasedAuthorizationCents,currency)}/>:<Cell label="Remboursement" value={money(s.refundedCents,currency)}/>}<Cell label="Moyen" value={s.paymentMethod}/><Cell label="Borne de retour" value={s.returnStationId??"—"}/><Cell label="Slot" value={s.returnedSlotNum?String(s.returnedSlotNum):"—"}/>{s.supplementalCents>0&&<Cell label="Complément" value={money(s.supplementalCents,currency)}/>}<Cell label="Référence" value={s.publicCode??"—"}/></div>
      <div className="mt-7 flex flex-col items-center justify-between gap-4 rounded-2xl border border-white/10 bg-black/10 p-4 sm:flex-row"><p className="flex items-center gap-2 text-sm text-muted-foreground"><ShieldCheck className="h-5 w-5 text-success"/>Montants affichés uniquement après confirmation du règlement serveur.</p><div className="flex items-center gap-3"><span className="flex items-center gap-2 text-sm font-bold"><Clock className="h-4 w-4"/>Accueil dans {seconds}s</span><Button onClick={()=>void finish()} className="rounded-full bg-gradient-primary px-7">Terminer maintenant</Button></div></div>
    </motion.section>}
  </motion.div></AnimatePresence>;
}
function Cell({label,value}:{label:string;value:string}){return <div className="rounded-2xl border border-white/10 bg-white/5 p-4"><div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</div><div className="mt-2 break-words text-lg font-extrabold">{value}</div></div>}
