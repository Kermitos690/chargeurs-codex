import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { CheckCircle2, Clock, Loader2, ReceiptText, RotateCcw, ShieldCheck, Smartphone } from "lucide-react";
import { motion } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { LiquidBackground } from "@/components/LiquidBackground";
import { BrandLogo } from "@/components/BrandLogo";

type Lang = "fr" | "de" | "en";
type Status = {
  state?: string;
  currency?: string;
  public_session_code?: string | null;
  selected_slot_num?: number | null;
  checkout_payment_mode?: "card_hold" | "twint_prepaid" | null;
  settlement_strategy?: string | null;
  settlement_status?: string | null;
  stripe_payment_method_type?: string | null;
  deposit_amount_cents?: number | null;
  final_amount_cents?: number | null;
  captured_amount_cents?: number | null;
  refunded_amount_cents?: number | null;
  supplemental_amount_cents?: number | null;
  started_at?: string | null;
  returned_at?: string | null;
  completed_at?: string | null;
  return_station_id?: string | null;
  returned_slot_num?: number | null;
  failure_code?: string | null;
  pricing?: {
    period_minutes?: number | null;
    price_per_period_cents?: number | null;
    daily_cap_cents?: number | null;
    unreturned_fee_cents?: number | null;
  } | null;
};

const COPY = {
  fr: { secured:"Garantie confirmée", release:"La borne prépare votre batterie. Vous pouvez revenir à l’écran de la borne.", active:"Location en cours", activeSub:"Votre batterie est sortie. Le tarif continue jusqu’à son retour dans une borne Chargeurs.ch.", returned:"Retour détecté", returnedSub:"Votre batterie est bien revenue. Nous calculons maintenant le montant exact et finalisons le règlement.", done:"Location terminée", paid:"Prix final", duration:"Durée", start:"Départ", back:"Retour", guarantee:"Garantie initiale", captured:"Montant capturé", released:"Autorisation libérée", refunded:"Remboursement", supplemental:"Complément", method:"Moyen de paiement", station:"Borne de retour", slot:"Slot de retour", ref:"Référence", support:"Vérification nécessaire", supportSub:"Votre retour ou votre règlement nécessite une vérification. Aucun montant supplémentaire ne sera présenté comme final tant que le serveur ne l’a pas confirmé.", waiting:"Mise à jour de la location…", card:"Carte / wallet", twint:"TWINT", receipt:"Votre récapitulatif", legal:"Le montant affiché comme final provient du règlement confirmé par le serveur." },
  de: { secured:"Garantie bestätigt", release:"Die Station bereitet Ihre Batterie vor. Sie können zum Stationsbildschirm zurückkehren.", active:"Miete läuft", activeSub:"Die Batterie wurde ausgegeben. Der Tarif läuft bis zur Rückgabe an einer Chargeurs.ch-Station.", returned:"Rückgabe erkannt", returnedSub:"Die Batterie wurde zurückgegeben. Der genaue Betrag wird jetzt berechnet und die Abrechnung abgeschlossen.", done:"Miete abgeschlossen", paid:"Endpreis", duration:"Dauer", start:"Start", back:"Rückgabe", guarantee:"Anfangsgarantie", captured:"Belasteter Betrag", released:"Freigegebene Autorisierung", refunded:"Rückerstattung", supplemental:"Zusatzbetrag", method:"Zahlungsmittel", station:"Rückgabestation", slot:"Rückgabefach", ref:"Referenz", support:"Prüfung erforderlich", supportSub:"Rückgabe oder Abrechnung muss geprüft werden. Es wird kein zusätzlicher Betrag als endgültig angezeigt, bevor der Server ihn bestätigt.", waiting:"Miete wird aktualisiert…", card:"Karte / Wallet", twint:"TWINT", receipt:"Ihre Zusammenfassung", legal:"Der als endgültig angezeigte Betrag stammt aus der serverseitig bestätigten Abrechnung." },
  en: { secured:"Guarantee confirmed", release:"The station is preparing your battery. You can return to the kiosk screen.", active:"Rental in progress", activeSub:"Your battery has been released. Pricing continues until it is returned to a Chargeurs.ch station.", returned:"Return detected", returnedSub:"Your battery is back. We are calculating the exact amount and finalising settlement.", done:"Rental completed", paid:"Final price", duration:"Duration", start:"Start", back:"Return", guarantee:"Initial guarantee", captured:"Captured amount", released:"Authorisation released", refunded:"Refund", supplemental:"Supplement", method:"Payment method", station:"Return station", slot:"Return slot", ref:"Reference", support:"Review required", supportSub:"Your return or settlement needs review. No additional amount is presented as final until the server confirms it.", waiting:"Updating your rental…", card:"Card / wallet", twint:"TWINT", receipt:"Your summary", legal:"The amount shown as final comes from the server-confirmed settlement." },
} as const;

function money(value: number | null | undefined, currency = "CHF") { return `${(Number(value ?? 0) / 100).toFixed(2)} ${currency}`; }
function time(value: string | null | undefined, lang: Lang) { if (!value) return "—"; try { return new Intl.DateTimeFormat(lang === "de" ? "de-CH" : lang === "en" ? "en-CH" : "fr-CH", { dateStyle:"short", timeStyle:"short" }).format(new Date(value)); } catch { return "—"; } }
function duration(start: string | null | undefined, end: string | null | undefined) { if (!start || !end) return "—"; const mins=Math.max(0,Math.ceil((Date.parse(end)-Date.parse(start))/60000)); const h=Math.floor(mins/60),m=mins%60; return h ? `${h} h ${String(m).padStart(2,"0")}` : `${m} min`; }

export default function RentalProgress() {
  const { rentalSessionId } = useParams();
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const publicCode = params.get("c") ?? "";
  const lang: Lang = params.get("lang") === "de" || params.get("lang") === "en" ? params.get("lang") as Lang : "fr";
  const c = COPY[lang];
  const [status,setStatus]=useState<Status|null>(null);

  useEffect(()=>{let cancelled=false;const poll=async()=>{if(!rentalSessionId||publicCode.length<4)return;const{data}=await supabase.rpc("kiosk_session_status",{p_id:rentalSessionId,p_code:publicCode});if(!cancelled&&data)setStatus(data as Status);};void poll();const id=window.setInterval(()=>void poll(),2500);return()=>{cancelled=true;window.clearInterval(id);};},[rentalSessionId,publicCode]);

  const state=status?.state??"";
  const completed=state==="completed"&&status?.settlement_status==="settled";
  const returned=state==="battery_returned";
  const active=["ejected","active_rental","battery_taken"].includes(state);
  const releasing=["payment_succeeded","ejecting"].includes(state);
  const support=state==="needs_support"||status?.settlement_status==="failed"||status?.settlement_status==="manual_review"||status?.settlement_status==="supplemental_required";
  const currency=status?.currency??"CHF";
  const deposit=Number(status?.deposit_amount_cents??0),captured=Number(status?.captured_amount_cents??0),refunded=Number(status?.refunded_amount_cents??0),supplemental=Number(status?.supplemental_amount_cents??0),final=Number(status?.final_amount_cents??0);
  const released=status?.settlement_strategy==="manual_capture"?Math.max(0,deposit-captured):0;
  const paymentMethod=status?.checkout_payment_mode==="twint_prepaid"||status?.stripe_payment_method_type==="twint"?c.twint:c.card;

  return <div className="relative min-h-screen overflow-hidden px-5 py-8"><LiquidBackground/><main className="relative z-10 mx-auto w-full max-w-2xl"><div className="mb-8 flex justify-center"><BrandLogo/></div>
    {!status ? <div className="grid min-h-[55vh] place-items-center"><div className="flex items-center gap-3 text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin text-primary"/>{c.waiting}</div></div> :
    completed ? <motion.section initial={{opacity:0,y:20}} animate={{opacity:1,y:0}} className="glass-strong liquid-border rounded-[2rem] p-6 sm:p-8">
      <div className="flex flex-col items-center text-center"><div className="grid h-20 w-20 place-items-center rounded-full bg-success/20"><CheckCircle2 className="h-11 w-11 text-success"/></div><h1 className="mt-4 font-display text-4xl font-extrabold">{c.done}</h1><p className="mt-2 text-sm text-muted-foreground">{c.receipt}</p><div className="mt-5 font-display text-6xl font-extrabold text-gradient-cyan">{money(final,currency)}</div><p className="mt-1 text-sm font-bold text-muted-foreground">{c.paid}</p></div>
      <div className="mt-7 grid gap-3 sm:grid-cols-2">
        <Row label={c.duration} value={duration(status.started_at,status.returned_at)} icon={<Clock/>}/><Row label={c.method} value={paymentMethod} icon={<Smartphone/>}/><Row label={c.start} value={time(status.started_at,lang)}/><Row label={c.back} value={time(status.returned_at,lang)}/><Row label={c.guarantee} value={money(deposit,currency)}/><Row label={c.captured} value={money(captured,currency)}/>{status?.settlement_strategy==="manual_capture"&&<Row label={c.released} value={money(released,currency)}/>} {status?.settlement_strategy!=="manual_capture"&&<Row label={c.refunded} value={money(refunded,currency)}/>} {supplemental>0&&<Row label={c.supplemental} value={money(supplemental,currency)}/>}<Row label={c.station} value={status.return_station_id??"—"}/><Row label={c.slot} value={status.returned_slot_num?String(status.returned_slot_num):"—"}/>
      </div>
      <div className="mt-6 flex items-center justify-between rounded-2xl border border-white/10 bg-black/10 p-4 text-xs text-muted-foreground"><span>{c.ref}</span><span className="font-mono">{status.public_session_code??publicCode}</span></div><p className="mt-4 flex items-start gap-2 text-xs text-muted-foreground"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success"/>{c.legal}</p>
    </motion.section> : support ? <StateCard icon={<RotateCcw className="h-10 w-10 text-warning"/>} title={c.support} text={c.supportSub}/> : returned ? <StateCard icon={<ReceiptText className="h-10 w-10 text-primary"/>} title={c.returned} text={c.returnedSub} loading/> : active ? <StateCard icon={<CheckCircle2 className="h-10 w-10 text-success"/>} title={c.active} text={c.activeSub}/> : releasing ? <StateCard icon={<Loader2 className="h-10 w-10 animate-spin text-primary"/>} title={c.secured} text={c.release} loading/> : <StateCard icon={<Loader2 className="h-10 w-10 animate-spin text-primary"/>} title={c.secured} text={c.waiting} loading/>}
  </main></div>;
}

function Row({label,value,icon}:{label:string;value:string;icon?:React.ReactNode}){return <div className="glass flex items-center justify-between gap-3 rounded-2xl p-4"><span className="flex items-center gap-2 text-sm text-muted-foreground">{icon&&<span className="[&>svg]:h-4 [&>svg]:w-4">{icon}</span>}{label}</span><strong className="text-right text-sm">{value}</strong></div>}
function StateCard({icon,title,text,loading=false}:{icon:React.ReactNode;title:string;text:string;loading?:boolean}){return <motion.section initial={{opacity:0,scale:.98}} animate={{opacity:1,scale:1}} className="glass-strong liquid-border flex min-h-[55vh] flex-col items-center justify-center rounded-[2rem] p-8 text-center"><div className="grid h-20 w-20 place-items-center rounded-full bg-white/5">{icon}</div><h1 className="mt-5 font-display text-3xl font-extrabold">{title}</h1><p className="mt-3 max-w-md text-muted-foreground">{text}</p>{loading&&<div className="mt-6 h-1 w-40 overflow-hidden rounded-full bg-white/10"><motion.div className="h-full w-1/3 rounded-full bg-primary" animate={{x:[-70,180]}} transition={{duration:1.2,repeat:Infinity,ease:"easeInOut"}}/></div>}</motion.section>}
