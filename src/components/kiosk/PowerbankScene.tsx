import { motion } from "framer-motion";
import { AlertTriangle, BatteryCharging, Zap } from "lucide-react";

type Props = {
  charge: number | null;
  selected: boolean;
  recommended: boolean;
  rentable: boolean;
};

/**
 * Deliberately restrained inside a slot card: the large cinematic 3D scene is
 * rendered once behind the chooser. Repeating tiny faux-3D batteries in four
 * cards made the actual charge level hard to read on the DTA display.
 */
export function PowerbankScene({ charge, selected, recommended, rentable }: Props) {
  const level = charge == null ? 0 : Math.max(0, Math.min(100, charge));
  const iconClass = rentable
    ? "text-cyan-100 drop-shadow-[0_0_14px_rgba(34,211,238,.95)]"
    : "text-amber-200";

  return (
    <div className="kiosk-slot-visual relative mt-2 flex h-11 items-center justify-between overflow-hidden rounded-2xl border border-white/15 bg-slate-950/25 px-3" aria-hidden="true">
      <motion.div
        className="absolute inset-y-0 left-0 rounded-r-2xl bg-gradient-to-r from-cyan-400/35 via-blue-500/20 to-violet-500/5"
        animate={{ width: `${level}%`, opacity: rentable ? [0.5, 0.85, 0.5] : 0.3 }}
        transition={{ duration: rentable ? 2.4 : 0.35, repeat: rentable ? Infinity : 0, ease: "easeInOut" }}
      />
      <motion.div
        className="relative z-10"
        animate={selected ? { y: [0, -2, 0], rotate: [0, -3, 0] } : undefined}
        transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
      >
        {rentable ? <BatteryCharging className={`h-7 w-7 ${iconClass}`} strokeWidth={2.4} /> : <AlertTriangle className="h-6 w-6 text-amber-200" strokeWidth={2.3} />}
      </motion.div>
      <div className="relative z-10 flex gap-1">
        {[25, 50, 75, 100].map((threshold) => <span key={threshold} className={`h-1.5 w-1.5 rounded-full ${level >= threshold ? "bg-cyan-100 shadow-[0_0_8px_rgba(103,232,249,1)]" : "bg-white/20"}`} />)}
      </div>
      {recommended && <Zap className="relative z-10 h-5 w-5 text-lime-200 drop-shadow-[0_0_10px_rgba(190,242,100,.85)]" />}
    </div>
  );
}

/** A high-resolution product scene with only subtle movement behind UI. */
export function KioskHolographicFloor() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <motion.img
        src="/kiosk/powerbank-stage-v1.png"
        alt=""
        className="absolute inset-0 h-full w-full object-cover object-center opacity-[0.3] mix-blend-screen"
        animate={{ scale: [1.02, 1.065, 1.02], x: [0, -7, 0], y: [0, 4, 0] }}
        transition={{ duration: 15, repeat: Infinity, ease: "easeInOut" }}
      />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(7,19,68,.42)_0%,rgba(7,19,68,.16)_38%,rgba(7,19,68,.76)_100%)]" />
      <motion.div
        className="absolute inset-x-[-20%] top-[-45%] h-[85%] rotate-[18deg] bg-[linear-gradient(90deg,transparent,rgba(103,232,249,.1),transparent)] blur-2xl"
        animate={{ x: ["-24%", "78%"] }}
        transition={{ duration: 8, repeat: Infinity, repeatDelay: 3, ease: "easeInOut" }}
      />
      <div className="absolute inset-x-[10%] bottom-[8%] h-28 rounded-[50%] border border-cyan-200/15 bg-[radial-gradient(ellipse_at_center,rgba(14,165,233,.15),transparent_70%)] blur-[1px]" />
    </div>
  );
}
