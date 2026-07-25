import { motion } from "framer-motion";
import { QRCodeSVG } from "qrcode.react";
import { useParams, useSearchParams } from "react-router-dom";
import {
  AlertTriangle, ArrowRight, BatteryCharging, CheckCircle2, Clock3, CreditCard,
  Loader2, ShieldCheck, Smartphone, Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  FlowSteps, KioskV2Backdrop, KioskV2TopBar, PowerbankArt, TrustRow,
} from "@/components/kiosk/KioskV2Primitives";
import "@/styles/kiosk-v2.css";
import "@/styles/kiosk-v2-battery.css";

type Screen = "home" | "price" | "qr" | "preparing" | "success" | "error";
const screens: Screen[] = ["home", "price", "qr", "preparing", "success", "error"];
const labels: Record<Screen, string> = {
  home: "Accueil", price: "Tarif", qr: "Paiement", preparing: "Préparation", success: "Succès", error: "Erreur",
};

export default function KioskV2Showcase() {
  const { stationId = "DTA21269" } = useParams();
  const [params, setParams] = useSearchParams();
  const selected = params.get("screen") as Screen | null;
  const screen: Screen = selected && screens.includes(selected) ? selected : "home";
  const changeScreen = (next: Screen) => setParams({ screen: next });

  return (
    <div className="kiosk-v2-root relative min-h-screen overflow-hidden px-5 py-5 sm:px-9 sm:py-7 lg:px-12">
      <KioskV2Backdrop />
      <div className="relative z-10 mx-auto flex min-h-[calc(100vh-2.5rem)] max-w-[1500px] flex-col">
        <KioskV2TopBar stationId={stationId} online available={4} onLogoTap={() => undefined} onHelp={() => undefined} />
        <main className="flex flex-1 items-center justify-center py-5 sm:py-8">
          {screen === "home" && <HomeScreen onContinue={() => changeScreen("price")} />}
          {screen === "price" && <PriceScreen onContinue={() => changeScreen("qr")} />}
          {screen === "qr" && <QrScreen />}
          {screen === "preparing" && <PreparingScreen />}
          {screen === "success" && <SuccessScreen />}
          {screen === "error" && <ErrorScreen />}
        </main>
        <div className="relative z-20 mb-2 flex flex-wrap items-center justify-center gap-2 rounded-2xl border border-white/10 bg-black/25 p-2 backdrop-blur-xl">
          {screens.map((item) => (
            <button key={item} onClick={() => changeScreen(item)} className={`rounded-xl px-4 py-2 text-xs font-semibold transition ${screen === item ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-white/10 hover:text-foreground"}`}>
              {labels[item]}
            </button>
          ))}
        </div>
        <footer className="flex items-center justify-between border-t border-white/[0.07] py-3 text-[11px] text-muted-foreground">
          <span>Présentation visuelle — aucune opération réelle</span>
          <span className="font-mono">Kiosk 2 · {stationId}</span>
        </footer>
      </div>
    </div>
  );
}

function HomeScreen({ onContinue }: { onContinue: () => void }) {
  return (
    <motion.section initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="grid w-full items-center gap-6 lg:grid-cols-[1.02fr_.98fr] lg:gap-10">
      <div className="flex flex-col items-start py-3 text-left lg:py-8">
        <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-success/30 bg-success/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.17em] text-success">
          <span className="h-2 w-2 rounded-full bg-success shadow-[0_0_12px_hsl(var(--success))]" />Prête à vous charger
        </div>
        <p className="mb-3 text-sm font-semibold uppercase tracking-[0.3em] text-secondary">L'énergie qui vous suit</p>
        <h1 className="max-w-3xl font-display text-[clamp(3rem,6.2vw,6.8rem)] font-extrabold leading-[0.94] tracking-[-0.055em]">
          Ne tombez plus jamais à <span className="text-gradient-cyan">0%</span>.
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground sm:text-xl lg:text-2xl">
          Louez une batterie en quelques secondes, rechargez en déplacement et rendez-la dans le réseau Chargeurs.ch.
        </p>
        <div className="mt-8 grid w-full max-w-2xl grid-cols-3 gap-3">
          <Metric label="Disponibles" value="4" accent />
          <Metric label="Paiement" value="Mobile" />
          <Metric label="Retour" value="Réseau" />
        </div>
        <Button onClick={onContinue} className="kiosk-v2-cta mt-8 h-[4.5rem] w-full max-w-2xl rounded-2xl px-9 text-xl font-extrabold sm:text-2xl">
          Louer une batterie<ArrowRight className="ml-3 h-6 w-6" />
        </Button>
        <div className="mt-7"><TrustRow online /></div>
      </div>
      <div className="kiosk-v2-panel overflow-hidden rounded-[2.25rem] p-4 sm:p-7">
        <PowerbankArt available={4} />
        <div className="border-t border-white/10 px-3 pb-2 pt-5"><FlowSteps active={0} /></div>
      </div>
    </motion.section>
  );
}

function PriceScreen({ onContinue }: { onContinue: () => void }) {
  return (
    <motion.section initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} className="grid w-full max-w-5xl gap-5 lg:grid-cols-[1.1fr_.9fr]">
      <div className="kiosk-v2-panel rounded-[2rem] p-7 sm:p-10">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-secondary">Étape 1 sur 3</p>
        <h2 className="mt-3 font-display text-4xl font-extrabold sm:text-5xl">Votre énergie, sans engagement.</h2>
        <p className="mt-4 max-w-xl text-lg text-muted-foreground">Vous ne payez que la durée utilisée. Le prix final est calculé automatiquement au retour.</p>
        <div className="mt-10"><FlowSteps active={0} /></div>
      </div>
      <div className="kiosk-v2-panel flex flex-col rounded-[2rem] p-7 sm:p-9">
        <div className="flex items-start justify-between gap-4">
          <div><p className="text-sm font-semibold text-muted-foreground">Tarif Standard</p><div className="mt-2 font-display text-5xl font-extrabold text-gradient-cyan">1.50 CHF</div><p className="mt-1 text-sm text-muted-foreground">par heure, calcul par tranche de 30 min</p></div>
          <div className="grid h-14 w-14 place-items-center rounded-2xl border border-primary/25 bg-primary/10"><Sparkles className="h-6 w-6 text-primary" /></div>
        </div>
        <div className="my-7 space-y-3 border-y border-white/10 py-6 text-sm">
          <PriceLine label="Garantie initiale" value="30.00 CHF" strong />
          <PriceLine label="Plafond par jour" value="18.00 CHF" />
          <PriceLine label="Montant si non-retour" value="99.00 CHF" />
        </div>
        <p className="mb-6 text-xs leading-relaxed text-muted-foreground">La garantie est autorisée ou débitée selon le moyen de paiement. Le solde non utilisé est libéré ou remboursé.</p>
        <Button onClick={onContinue} className="kiosk-v2-cta mt-auto h-16 rounded-2xl text-lg font-extrabold">Continuer vers le paiement<ArrowRight className="ml-2 h-5 w-5" /></Button>
      </div>
    </motion.section>
  );
}

function QrScreen() {
  return (
    <motion.section initial={{ opacity: 0, scale: .97 }} animate={{ opacity: 1, scale: 1 }} className="grid w-full max-w-6xl items-center gap-6 lg:grid-cols-[.95fr_1.05fr]">
      <div className="kiosk-v2-panel rounded-[2rem] p-7 text-left sm:p-10">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-secondary">Étape 2 sur 3</p>
        <h2 className="mt-3 font-display text-4xl font-extrabold sm:text-5xl">Scannez. Payez. C'est parti.</h2>
        <p className="mt-4 text-lg text-muted-foreground">Ouvrez l'appareil photo de votre téléphone et scannez le QR code. La page de paiement sécurisée s'ouvre automatiquement.</p>
        <div className="mt-8 grid grid-cols-2 gap-3"><Metric label="Garantie" value="30.00 CHF" accent /><Metric label="Tarif" value="1.50 CHF / h" /></div>
        <div className="mt-8"><FlowSteps active={1} /></div>
        <div className="mt-8 flex flex-wrap gap-3 text-xs text-muted-foreground">
          <PaymentChip icon={<CreditCard className="h-4 w-4" />} label="Carte" />
          <PaymentChip icon={<Smartphone className="h-4 w-4" />} label="Apple Pay" />
          <PaymentChip icon={<Smartphone className="h-4 w-4" />} label="Google Pay" />
          <PaymentChip icon={<ShieldCheck className="h-4 w-4" />} label="TWINT" />
        </div>
      </div>
      <div className="flex flex-col items-center gap-5 text-center">
        <div className="relative"><div className="absolute inset-[-22px] rounded-[2.4rem] bg-primary/20 blur-3xl animate-pulse" /><div className="kiosk-v2-qr-frame relative rounded-[2rem] p-7"><QRCodeSVG value="https://chargeurs.ch/pay/demo" size={310} bgColor="#ffffff" fgColor="#071127" level="M" marginSize={2} /></div></div>
        <div className="flex items-center gap-3 rounded-full border border-white/10 bg-white/[0.04] px-5 py-2.5"><Clock3 className="h-4 w-4 text-primary" /><span className="text-sm text-muted-foreground">QR actif encore</span><span className="font-mono text-lg font-bold">29:42</span></div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin text-secondary" />En attente de la confirmation sécurisée…</div>
      </div>
    </motion.section>
  );
}

function PreparingScreen() {
  return <Centered><div className="relative grid h-40 w-40 place-items-center rounded-full border border-secondary/25 bg-secondary/10"><div className="absolute inset-[-18px] rounded-full border border-secondary/20 animate-pulse" /><BatteryCharging className="h-16 w-16 text-secondary" /></div><div className="max-w-2xl"><p className="text-xs font-semibold uppercase tracking-[0.28em] text-secondary">Paiement confirmé</p><h2 className="mt-3 font-display text-5xl font-extrabold">Préparation de votre batterie</h2><p className="mt-4 text-xl text-muted-foreground">La borne choisit un compartiment disponible et vérifie la réponse matérielle.</p></div><div className="w-full max-w-lg"><FlowSteps active={2} /></div></Centered>;
}

function SuccessScreen() {
  return <Centered><div className="kiosk-v2-slot-beacon"><div className="relative z-10"><p className="text-xs font-bold uppercase tracking-[0.3em] text-success">Compartiment</p><div className="font-display text-7xl font-extrabold text-success">3</div></div></div><div className="max-w-2xl"><div className="mx-auto mb-4 inline-flex items-center gap-2 rounded-full border border-success/30 bg-success/10 px-4 py-2 text-sm font-semibold text-success"><CheckCircle2 className="h-4 w-4" />Location démarrée</div><h2 className="font-display text-5xl font-extrabold">Prenez votre batterie.</h2><p className="mt-4 text-xl text-muted-foreground">Retirez-la dans le compartiment n° 3. L'écran reviendra ensuite automatiquement à l'accueil.</p></div></Centered>;
}

function ErrorScreen() {
  return <Centered><div className="grid h-28 w-28 place-items-center rounded-[2rem] border border-warning/30 bg-warning/10"><AlertTriangle className="h-12 w-12 text-warning" /></div><div className="max-w-2xl"><p className="text-xs font-semibold uppercase tracking-[0.28em] text-muted-foreground">Protection Chargeurs.ch</p><h2 className="mt-3 font-display text-4xl font-extrabold">Le compartiment n'a pas répondu</h2><p className="mt-4 text-xl text-muted-foreground">Votre paiement reste protégé. Une vérification automatique est déclenchée sans afficher de code technique au client.</p></div><Button className="kiosk-v2-cta h-14 rounded-full px-9 font-bold">Revenir à l'accueil</Button></Centered>;
}

function Centered({ children }: { children: React.ReactNode }) { return <motion.section initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-center justify-center gap-7 text-center">{children}</motion.section>; }
function Metric({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) { return <div className="kiosk-v2-panel rounded-2xl p-4"><div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">{label}</div><div className={`mt-1 font-display text-xl font-extrabold ${accent ? "text-secondary" : "text-foreground"}`}>{value}</div></div>; }
function PriceLine({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) { return <div className="flex items-center justify-between gap-4"><span className="text-muted-foreground">{label}</span><span className={strong ? "font-bold" : "font-semibold text-foreground/90"}>{value}</span></div>; }
function PaymentChip({ icon, label }: { icon: React.ReactNode; label: string }) { return <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-2">{icon}{label}</span>; }
