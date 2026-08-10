import { motion } from "framer-motion";
import { AlertTriangle, BatteryCharging, CornerDownLeft, Zap } from "lucide-react";

type Props = {
  charge: number | null;
  selected: boolean;
  recommended: boolean;
  rentable: boolean;
  returnAvailable?: boolean;
};

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
 * Ambient kiosk floor made from native gradients rather than a raster cabinet
 * photo. It fills the available display at any aspect ratio without soft edges,
 * mismatched margins or a low-resolution image competing with the controls.
 */
export function KioskHolographicFloor() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_102%,rgba(34,211,238,.18),transparent_48%),radial-gradient(ellipse_at_8%_8%,rgba(37,99,235,.2),transparent_40%),radial-gradient(ellipse_at_92%_84%,rgba(139,92,246,.18),transparent_40%)]" />
      <motion.div
        className="absolute inset-x-[-25%] top-[-44%] h-[82%] rotate-[16deg] bg-[linear-gradient(90deg,transparent,rgba(103,232,249,.075),transparent)] blur-2xl"
        animate={{ x: ["-26%", "82%"] }}
        transition={{ duration: 9, repeat: Infinity, repeatDelay: 3, ease: "easeInOut" }}
      />
      <motion.div
        className="absolute left-1/2 top-[52%] h-[52%] w-[68%] -translate-x-1/2 rounded-[50%] border border-cyan-200/10 bg-[radial-gradient(ellipse_at_center,rgba(14,165,233,.11),rgba(37,99,235,.03)_48%,transparent_70%)]"
        animate={{ scale: [1, 1.025, 1], opacity: [.62, .9, .62] }}
        transition={{ duration: 5.4, repeat: Infinity, ease: "easeInOut" }}
      />
    </div>
  );
}

function CabinetCell({ slot, active }: { slot: number; active: boolean }) {
  return (
    <motion.div
      className={`relative grid min-h-0 place-items-center overflow-hidden rounded-[1.6rem] border ${active ? "border-cyan-200/75 bg-cyan-300/15" : "border-white/12 bg-white/[.035]"}`}
      animate={active ? { boxShadow: ["0 0 0 rgba(34,211,238,0)", "0 0 44px rgba(34,211,238,.48)", "0 0 0 rgba(34,211,238,0)"] } : undefined}
      transition={{ duration: 1.2, repeat: active ? Infinity : 0, ease: "easeInOut" }}
    >
      <div className={`absolute inset-x-[16%] bottom-[-34%] h-[78%] rounded-[45%] blur-2xl ${active ? "bg-cyan-400/25" : "bg-blue-500/8"}`} />
      <div className={`relative grid h-[68%] w-[56%] place-items-center rounded-[1.15rem] border ${active ? "border-cyan-100/80 bg-gradient-to-b from-cyan-200/30 to-blue-500/20" : "border-white/16 bg-gradient-to-b from-white/10 to-blue-500/6"}`}>
        <div className="absolute inset-x-[18%] top-[12%] h-[5px] rounded-full bg-white/25" />
        <div className="flex flex-col gap-1.5">
          {[0, 1, 2, 3].map((n) => <span key={n} className={`h-1.5 w-1.5 rounded-full ${active ? "bg-cyan-100 shadow-[0_0_10px_rgba(103,232,249,.95)]" : "bg-white/30"}`} />)}
        </div>
      </div>
      <span className={`absolute bottom-3 right-4 grid h-10 w-10 place-items-center rounded-full text-lg font-black ${active ? "bg-white text-blue-950" : "border border-white/12 bg-slate-950/55 text-white/55"}`}>{slot}</span>
    </motion.div>
  );
}

/**
 * Visual-only release scene. Physical DTA21269 mapping from the front:
 *   1 | 3
 *   2 | 4
 */
export function SlotReleaseScene({ slotNum }: { slotNum: number | null }) {
  return (
    <div className="relative aspect-video w-full max-w-4xl overflow-hidden rounded-[2.5rem] border border-cyan-100/20 bg-[linear-gradient(145deg,rgba(5,25,68,.94),rgba(3,12,36,.98))] p-[clamp(16px,2vw,28px)] shadow-[0_30px_90px_rgba(0,0,0,.34),0_0_70px_rgba(34,211,238,.12)]">
      <div aria-hidden className="absolute -left-[15%] -top-[40%] h-[80%] w-[80%] rounded-full bg-blue-600/18 blur-[90px]" />
      <div aria-hidden className="absolute -bottom-[46%] right-[-10%] h-[86%] w-[86%] rounded-full bg-violet-600/18 blur-[100px]" />
      <div className="relative grid h-full grid-cols-2 grid-rows-2 gap-[clamp(10px,1.4vw,18px)] rounded-[2rem] border border-white/8 bg-white/[.025] p-[clamp(12px,1.5vw,20px)]">
        <CabinetCell slot={1} active={slotNum === 1} />
        <CabinetCell slot={3} active={slotNum === 3} />
        <CabinetCell slot={2} active={slotNum === 2} />
        <CabinetCell slot={4} active={slotNum === 4} />
      </div>
      <motion.div
        aria-hidden
        className="absolute inset-x-[-18%] bottom-0 h-[28%] bg-[linear-gradient(90deg,transparent,rgba(103,232,249,.18),transparent)] blur-2xl"
        animate={{ x: ["-28%", "38%", "-28%"] }}
        transition={{ duration: 2.8, repeat: Infinity, ease: "easeInOut" }}
      />
    </div>
  );
}
