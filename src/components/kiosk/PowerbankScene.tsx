import { motion } from "framer-motion";
import { AlertTriangle, BatteryCharging, CornerDownLeft, Zap } from "lucide-react";

type Props = {
  charge: number | null;
  selected: boolean;
  recommended: boolean;
  rentable: boolean;
  returnAvailable?: boolean;
};

/**
 * Deliberately restrained inside a slot card: the large cinematic 3D scene is
 * rendered once behind the chooser. Repeating tiny faux-3D batteries in four
 * cards made the actual charge level hard to read on the DTA display.
 */
export function PowerbankScene({ charge, selected, recommended, rentable, returnAvailable = false }: Props) {
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
        {rentable ? <BatteryCharging className={`h-7 w-7 ${iconClass}`} strokeWidth={2.4} /> : returnAvailable ? <CornerDownLeft className="h-7 w-7 text-cyan-100 drop-shadow-[0_0_14px_rgba(34,211,238,.95)]" strokeWidth={2.4} /> : <AlertTriangle className="h-6 w-6 text-amber-200" strokeWidth={2.3} />}
      </motion.div>
      <div className="relative z-10 flex gap-1">
        {[25, 50, 75, 100].map((threshold) => <span key={threshold} className={`h-1.5 w-1.5 rounded-full ${level >= threshold ? "bg-cyan-100 shadow-[0_0_8px_rgba(103,232,249,1)]" : "bg-white/20"}`} />)}
      </div>
      {recommended && <Zap className="relative z-10 h-5 w-5 text-lime-200 drop-shadow-[0_0_10px_rgba(190,242,100,.85)]" />}
    </div>
  );
}

/**
 * A dedicated 16:9 cabinet render is kept behind the interactive content,
 * never cropped into a small card. The dark vignette preserves contrast for
 * the four real slot controls while giving the landscape kiosk a physical,
 * premium context instead of a dashboard-like flat background.
 */
export function KioskHolographicFloor() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <motion.img
        src="/kiosk/attract-scene-v1.png"
        alt=""
        className="absolute inset-0 h-full w-full object-cover object-center opacity-45 mix-blend-screen"
        initial={{ opacity: 0.18, scale: 1.015 }}
        animate={{ opacity: [0.33, 0.5, 0.38], scale: [1.015, 1.035, 1.02] }}
        transition={{ duration: 11, repeat: Infinity, repeatType: "mirror", ease: "easeInOut" }}
      />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(4,14,43,.5)_0%,rgba(6,21,63,.22)_35%,rgba(4,12,38,.62)_100%),radial-gradient(ellipse_at_50%_108%,rgba(14,165,233,.28),transparent_46%),radial-gradient(ellipse_at_8%_12%,rgba(99,102,241,.18),transparent_40%)]" />
      <motion.div
        className="absolute inset-x-[-20%] top-[-45%] h-[85%] rotate-[18deg] bg-[linear-gradient(90deg,transparent,rgba(103,232,249,.07),transparent)] blur-2xl"
        animate={{ x: ["-24%", "78%"] }}
        transition={{ duration: 8, repeat: Infinity, repeatDelay: 3, ease: "easeInOut" }}
      />
      <div className="absolute inset-x-[8%] bottom-[4%] h-32 rounded-[50%] border border-cyan-200/15 bg-[radial-gradient(ellipse_at_center,rgba(14,165,233,.15),transparent_70%)] blur-[1px]" />
    </div>
  );
}

/**
 * Visual-only feedback while the server reports that a compartment is opening.
 * It deliberately says "preparing" through its parent screen: the animation
 * is not evidence that a battery has physically been taken.
 */
export function SlotReleaseScene({ slotNum }: { slotNum: number | null }) {
  const position = {
    1: "left-[25%] top-[58%]",
    2: "left-[73%] top-[58%]",
    3: "left-[25%] top-[80%]",
    4: "left-[73%] top-[80%]",
  }[slotNum ?? 0] ?? "left-1/2 top-2/3";

  return (
    <div className="relative aspect-video w-full max-w-4xl overflow-hidden rounded-[2.5rem] border border-cyan-100/25 bg-slate-950/50 shadow-[0_0_70px_rgba(34,211,238,.2)]">
      <img src="/kiosk/attract-scene-v1.png" alt="" className="h-full w-full object-cover" />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(3,12,34,.08),rgba(3,12,34,.58))]" />
      <motion.div
        className={`absolute ${position} z-10 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center`}
        animate={{ scale: [1, 1.15, 1], opacity: [0.75, 1, 0.75] }}
        transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
      >
        <span className="absolute h-24 w-24 rounded-full border-4 border-cyan-200 bg-cyan-300/20 shadow-[0_0_44px_rgba(34,211,238,.95)]" />
        <span className="relative grid h-16 w-16 place-items-center rounded-full bg-gradient-primary text-2xl font-black text-primary-foreground shadow-glow">
          {slotNum ?? "?"}
        </span>
      </motion.div>
      <motion.div
        className="absolute inset-x-[-15%] bottom-0 h-1/3 bg-[linear-gradient(90deg,transparent,rgba(103,232,249,.38),transparent)] blur-xl"
        animate={{ x: ["-25%", "35%", "-25%"] }}
        transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
      />
    </div>
  );
}
