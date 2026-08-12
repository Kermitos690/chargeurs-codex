import { AlertTriangle, CheckCircle2, ScanLine } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";

type ReturnEnergyDockMode = "detected" | "pricing" | "support" | "completed";
type MotionLevel = "full" | "reduced" | "static";

type ReturnEnergyDockProps = {
  mode: ReturnEnergyDockMode;
  slotNumber?: number | null;
  motionLevel?: MotionLevel;
  compact?: boolean;
};

const MODE_COPY: Record<ReturnEnergyDockMode, { eyebrow: string; label: string }> = {
  detected: { eyebrow: "BATTERIE DÉTECTÉE", label: "Vérification physique" },
  pricing: { eyebrow: "RETOUR RECONNU", label: "Calcul en cours" },
  support: { eyebrow: "RETOUR ENREGISTRÉ", label: "Vérification serveur" },
  completed: { eyebrow: "RETOUR CONFIRMÉ", label: "Énergie rendue" },
};

const MODE_ACCENT: Record<ReturnEnergyDockMode, string> = {
  detected: "rgba(34,211,238,.95)",
  pricing: "rgba(56,189,248,.95)",
  support: "rgba(245,158,11,.95)",
  completed: "rgba(34,197,94,.95)",
};

export function ReturnEnergyDock({
  mode,
  slotNumber,
  motionLevel = "full",
  compact = false,
}: ReturnEnergyDockProps) {
  const prefersReducedMotion = useReducedMotion();
  const resolvedMotion: MotionLevel = motionLevel === "static"
    ? "static"
    : (prefersReducedMotion || motionLevel === "reduced" ? "reduced" : "full");
  const fullMotion = resolvedMotion === "full";
  const hasMotion = resolvedMotion !== "static";
  const accent = MODE_ACCENT[mode];
  const copy = MODE_COPY[mode];
  const isSupport = mode === "support";
  const isCompleted = mode === "completed";

  return (
    <div
      className={`relative mx-auto overflow-hidden ${compact ? "h-[210px] w-[330px]" : "h-[260px] w-[430px]"}`}
      aria-label={`${copy.eyebrow}. ${copy.label}${slotNumber ? `. Slot ${slotNumber}` : ""}`}
      data-motion-level={resolvedMotion}
      data-return-visual-state={mode}
    >
      <div
        className="absolute left-1/2 top-[88%] h-[44%] w-[82%] -translate-x-1/2 -translate-y-1/2 rounded-[50%] blur-2xl"
        style={{ background: `radial-gradient(ellipse, ${accent.replace(".95", ".22")} 0%, transparent 70%)` }}
        aria-hidden="true"
      />

      <motion.div
        className="absolute left-1/2 top-[49%] h-[188px] w-[176px] -translate-x-1/2 -translate-y-1/2"
        initial={hasMotion ? { opacity: 0, scale: 0.94 } : false}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: resolvedMotion === "reduced" ? 0.18 : 0.45, ease: "easeOut" }}
        aria-hidden="true"
      >
        <div
          className="absolute inset-x-0 bottom-0 h-[150px] rounded-[32px] border border-white/10 bg-[linear-gradient(145deg,#101827_0%,#070b12_55%,#111827_100%)] shadow-[0_30px_70px_rgba(0,0,0,.55)]"
          style={{ boxShadow: `0 30px 70px rgba(0,0,0,.55), inset 0 1px 0 rgba(255,255,255,.08), 0 0 44px ${accent.replace(".95", ".10")}` }}
        >
          <div className="absolute inset-x-[21px] top-[22px] h-[92px] rounded-[22px] border border-white/10 bg-black/55 shadow-[inset_0_12px_24px_rgba(0,0,0,.6)]" />
          <div
            className="absolute inset-x-[28px] top-[29px] h-[78px] rounded-[18px] border"
            style={{ borderColor: accent.replace(".95", ".34"), boxShadow: `inset 0 0 22px ${accent.replace(".95", ".12")}` }}
          />

          <motion.div
            className="absolute left-[35px] top-[34px] h-[67px] w-[106px] rounded-[15px]"
            style={{ background: `linear-gradient(90deg, transparent, ${accent.replace(".95", ".38")}, transparent)` }}
            animate={fullMotion && !isSupport
              ? { opacity: [0.15, 0.85, 0.15], x: [-18, 18, -18] }
              : { opacity: isSupport ? 0.3 : 0.55, x: 0 }}
            transition={fullMotion ? { duration: 2.2, repeat: Infinity, ease: "easeInOut" } : { duration: 0.2 }}
          />

          <div className="absolute bottom-[17px] left-1/2 flex -translate-x-1/2 items-center gap-2 text-[9px] font-black tracking-[0.28em] text-white/38">
            <span>CHARGEURS</span>
            <span className="h-1 w-1 rounded-full" style={{ background: accent }} />
          </div>
        </div>

        <motion.div
          className="absolute left-1/2 top-0 h-[126px] w-[92px] -translate-x-1/2"
          initial={hasMotion && mode === "detected" ? { y: -22, opacity: 0.7 } : false}
          animate={{ y: 24, opacity: 1 }}
          transition={{ duration: resolvedMotion === "reduced" ? 0.2 : 0.72, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="absolute inset-[7px_4px_6px_10px] rounded-[19px] bg-black/60 blur-md" />
          <div className="absolute inset-0 rounded-[20px] border border-white/45 bg-[linear-gradient(135deg,#e7edf4_0%,#aab7c7_45%,#dbe4ed_100%)] shadow-[inset_0_1px_1px_rgba(255,255,255,.75),0_15px_35px_rgba(0,0,0,.45)]">
            <div className="absolute inset-y-[10px] right-[8px] w-[7px] rounded-full bg-gradient-to-b from-white/70 via-slate-400/50 to-slate-600/70" />
            <div className="absolute left-[14px] top-[14px] h-[38px] w-[38px] rounded-full border-[7px] border-cyan-400/90 border-r-transparent rotate-[-24deg]" />
            <div className="absolute bottom-[13px] left-[17px] flex gap-1">
              {[0, 1, 2, 3].map((item) => (
                <span key={item} className="h-[4px] w-[10px] rounded-full bg-slate-700/55" />
              ))}
            </div>
          </div>
        </motion.div>

        <motion.div
          className="absolute left-1/2 top-[27px] h-[2px] w-[146px] -translate-x-1/2"
          style={{ background: `linear-gradient(90deg, transparent, ${accent}, transparent)`, boxShadow: `0 0 14px ${accent}` }}
          animate={fullMotion && !isSupport ? { opacity: [0.2, 1, 0.2], y: [0, 72, 0] } : { opacity: 0.65, y: 38 }}
          transition={fullMotion ? { duration: 1.9, repeat: Infinity, ease: "easeInOut" } : { duration: 0.2 }}
        />

        {isCompleted && (
          <motion.div
            className="absolute left-1/2 top-[70px] grid h-[58px] w-[58px] -translate-x-1/2 place-items-center rounded-full border border-emerald-300/50 bg-emerald-400/15 backdrop-blur-sm"
            initial={hasMotion ? { opacity: 0, scale: 0.5 } : false}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: hasMotion ? 0.35 : 0, type: "spring", stiffness: 280, damping: 20 }}
          >
            <CheckCircle2 className="h-9 w-9 text-emerald-300" />
          </motion.div>
        )}

        {isSupport && (
          <div className="absolute left-1/2 top-[70px] grid h-[58px] w-[58px] -translate-x-1/2 place-items-center rounded-full border border-amber-300/45 bg-amber-400/10 backdrop-blur-sm">
            <AlertTriangle className="h-8 w-8 text-amber-300" />
          </div>
        )}
      </motion.div>

      <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-4 px-4 pb-1">
        <div>
          <div className="text-[10px] font-black tracking-[0.24em]" style={{ color: accent }}>{copy.eyebrow}</div>
          <div className="mt-1 text-sm font-semibold text-white/72">{copy.label}</div>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-white/10 bg-black/25 px-3 py-2 text-[11px] font-bold text-white/65 backdrop-blur-sm">
          {isCompleted ? <CheckCircle2 className="h-4 w-4" style={{ color: accent }} /> : <ScanLine className="h-4 w-4" style={{ color: accent }} />}
          {slotNumber ? `SLOT ${slotNumber}` : "BORNE CONNECTÉE"}
        </div>
      </div>
    </div>
  );
}
