import { BatteryCharging, Check, CircleHelp, ShieldCheck, Wifi, WifiOff } from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { Button } from "@/components/ui/button";

export function KioskV2Backdrop() {
  return (
    <>
      <div className="kiosk-v2-aurora right-[-10%] top-[-22%] bg-primary" />
      <div className="kiosk-v2-aurora bottom-[-34%] left-[-15%] bg-accent [animation-delay:-8s]" />
    </>
  );
}

export function KioskV2TopBar({
  stationId,
  online,
  available,
  onLogoTap,
  onHelp,
}: {
  stationId?: string;
  online: boolean;
  available: number | null;
  onLogoTap: () => void;
  onHelp: () => void;
}) {
  return (
    <header className="relative z-20 flex items-center justify-between gap-4">
      <button onClick={onLogoTap} aria-label="Chargeurs.ch" className="cursor-default rounded-2xl p-1">
        <BrandLogo size="md" />
      </button>
      <div className="hidden items-center gap-2 rounded-full border border-white/10 bg-white/[0.045] px-4 py-2 text-xs text-muted-foreground backdrop-blur-xl md:flex">
        <span className={`h-2 w-2 rounded-full ${online ? "bg-success shadow-[0_0_12px_hsl(var(--success))]" : "bg-warning"}`} />
        <span>{online ? "Service disponible" : "Service limité"}</span>
        {stationId && <><span className="text-white/20">•</span><span className="font-mono">{stationId}</span></>}
        {available !== null && <><span className="text-white/20">•</span><span>{available} batteries</span></>}
      </div>
      <div className="flex items-center gap-2">
        <Button onClick={onHelp} variant="ghost" className="h-11 gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 hover:bg-white/[0.08]">
          <CircleHelp className="h-4 w-4" />
          <span className="hidden sm:inline">Aide</span>
        </Button>
        <LanguageSwitcher />
      </div>
    </header>
  );
}

export function PowerbankArt({ available }: { available: number }) {
  return (
    <div className="kiosk-v2-battery-stage" aria-label="Illustration d'une batterie Chargeurs.ch">
      <div className="kiosk-v2-battery-halo" />
      <div className="absolute left-[9%] top-[20%] h-24 w-24 rounded-full border border-primary/20 bg-primary/5 blur-sm" />
      <div className="absolute bottom-[16%] right-[7%] h-32 w-32 rounded-full border border-secondary/15 bg-secondary/5 blur-sm" />
      <div className="kiosk-v2-battery">
        <div className="kiosk-v2-battery-inner">
          <div className="kiosk-v2-energy-stream" />
          <div className="kiosk-v2-scan-line" />
          <div className="kiosk-v2-battery-logo">
            <BatteryCharging className="h-12 w-12 text-secondary" strokeWidth={1.5} />
            <div className="font-display text-xl font-extrabold tracking-tight">Chargeurs.ch</div>
            <div className="text-[10px] uppercase tracking-[0.32em] text-muted-foreground">Power anywhere</div>
            <div className="mt-5 flex gap-2">
              {[0, 1, 2, 3].map((dot) => (
                <span key={dot} className={`h-2 w-2 rounded-full ${dot < 3 ? "bg-secondary shadow-[0_0_12px_hsl(var(--secondary))]" : "bg-white/20"}`} />
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="kiosk-v2-panel absolute bottom-[4%] right-[2%] z-10 rounded-2xl px-4 py-3 sm:right-[8%]">
        <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Disponibles</div>
        <div className="font-display text-3xl font-extrabold text-secondary">{available}</div>
      </div>
    </div>
  );
}

export function FlowSteps({ active = 0 }: { active?: number }) {
  const steps = ["Choisir", "Scanner", "Emporter"];
  return (
    <div className="grid w-full grid-cols-3 gap-3">
      {steps.map((label, index) => (
        <div key={label} className="relative flex flex-col items-center gap-2 text-center">
          <div className={`grid h-9 w-9 place-items-center rounded-full border text-sm font-bold transition ${index <= active ? "border-primary/60 bg-primary/20 text-primary" : "border-white/10 bg-white/[0.035] text-muted-foreground"}`}>
            {index < active ? <Check className="h-4 w-4" /> : index + 1}
          </div>
          <span className={`text-xs font-medium ${index <= active ? "text-foreground" : "text-muted-foreground"}`}>{label}</span>
        </div>
      ))}
    </div>
  );
}

export function TrustRow({ online }: { online: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1.5"><ShieldCheck className="h-4 w-4 text-secondary" />Paiement sécurisé</span>
      <span className="inline-flex items-center gap-1.5">{online ? <Wifi className="h-4 w-4 text-success" /> : <WifiOff className="h-4 w-4 text-warning" />}{online ? "Borne connectée" : "Connexion limitée"}</span>
      <span className="inline-flex items-center gap-1.5"><BatteryCharging className="h-4 w-4 text-primary" />Retour dans le réseau</span>
    </div>
  );
}
