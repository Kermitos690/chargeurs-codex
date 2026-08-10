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
      className={`relative grid min-h-0 place-items-center overflow-visible rounded-[1.7rem] border ${active ? "border-cyan-100/80 bg-cyan-300/[.09]" : "border-white/10 bg-white/[.025]"}`}
      animate={active ? {
        boxShadow: [
          "0 0 0 rgba(34,211,238,0), inset 0 0 0 rgba(34,211,238,0)",
          "0 0 52px rgba(34,211,238,.42), inset 0 0 30px rgba(34,211,238,.12)",
          "0 0 18px rgba(34,211,238,.2), inset 0 0 10px rgba(34,211,238,.04)",
        ],
      } : undefined}
      transition={{ duration: 1.45, repeat: active ? Infinity : 0, ease: "easeInOut" }}
    >
      <div className={`absolute inset-[4%] rounded-[1.45rem] border ${active ? "border-cyan-300/20" : "border-white/[.035]"}`} />
      <div className={`absolute inset-x-[8%] bottom-[-24%] h-[72%] rounded-[50%] blur-3xl ${active ? "bg-cyan-400/28" : "bg-blue-500/6"}`} />

      {active && (
        <>
          <motion.div
            aria-hidden
            className="absolute h-[145%] w-[145%] rounded-full border border-cyan-200/20"
            animate={{ scale: [.58, .92, 1.16], opacity: [.75, .24, 0] }}
            transition={{ duration: 1.55, repeat: Infinity, ease: "easeOut" }}
          />
          <motion.div
            aria-hidden
            className="absolute h-[110%] w-[110%] rounded-full border border-blue-300/20"
            animate={{ scale: [.66, 1.05], opacity: [.55, 0] }}
            transition={{ duration: 1.2, repeat: Infinity, delay: .25, ease: "easeOut" }}
          />
        </>
      )}

      <motion.div
        className={`relative grid h-[68%] w-[54%] place-items-center rounded-[1.15rem] border ${active ? "border-cyan-50/90 bg-[linear-gradient(180deg,rgba(164,244,255,.33),rgba(15,90,184,.25)_42%,rgba(3,18,56,.82))]" : "border-white/14 bg-[linear-gradient(180deg,rgba(255,255,255,.075),rgba(37,99,235,.04))]"}`}
        animate={active ? {
          y: [0, -5, -11, -7],
          scale: [1, 1.025, 1.07, 1.045],
          rotateX: [0, -2, -5, -3],
        } : undefined}
        transition={{ duration: 1.55, repeat: Infinity, ease: "easeInOut" }}
        style={{ transformPerspective: 900 }}
      >
        <div className={`absolute inset-x-[16%] top-[10%] h-[5px] rounded-full ${active ? "bg-cyan-50 shadow-[0_0_13px_rgba(165,243,252,.9)]" : "bg-white/20"}`} />
        <div className="flex flex-col gap-1.5">
          {[0, 1, 2, 3].map((n) => (
            <motion.span
              key={n}
              className={`h-1.5 w-1.5 rounded-full ${active ? "bg-cyan-50 shadow-[0_0_10px_rgba(103,232,249,.95)]" : "bg-white/25"}`}
              animate={active ? { opacity: [.45, 1, .45], scale: [.85, 1.3, .85] } : undefined}
              transition={{ duration: .8, repeat: Infinity, delay: n * .1 }}
            />
          ))}
        </div>
        {active && (
          <motion.div
            aria-hidden
            className="absolute inset-x-[10%] bottom-[8%] h-[2px] rounded-full bg-cyan-100 shadow-[0_0_14px_rgba(103,232,249,1)]"
            animate={{ opacity: [.35, 1, .35] }}
            transition={{ duration: .7, repeat: Infinity }}
          />
        )}
      </motion.div>

      <span className={`absolute bottom-3 right-4 grid h-10 w-10 place-items-center rounded-full text-lg font-black ${active ? "bg-white text-blue-950 shadow-[0_0_24px_rgba(255,255,255,.55)]" : "border border-white/12 bg-slate-950/55 text-white/55"}`}>{slot}</span>
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
    <div className="relative aspect-video w-full max-w-4xl overflow-hidden rounded-[2.6rem] border border-cyan-100/20 bg-[linear-gradient(145deg,rgba(2,11,31,.98),rgba(4,22,60,.96)_54%,rgba(13,8,45,.98))] p-[clamp(16px,2vw,28px)] shadow-[0_34px_100px_rgba(0,0,0,.45),0_0_90px_rgba(34,211,238,.14)]">
      <div aria-hidden className="absolute inset-0 bg-[radial-gradient(circle_at_50%_48%,rgba(56,189,248,.12),transparent_34%),radial-gradient(circle_at_18%_10%,rgba(37,99,235,.22),transparent_34%),radial-gradient(circle_at_90%_82%,rgba(139,92,246,.2),transparent_36%)]" />
      <motion.div
        aria-hidden
        className="absolute -left-[18%] top-[12%] h-[75%] w-[55%] rotate-[17deg] bg-[linear-gradient(90deg,transparent,rgba(125,211,252,.11),transparent)] blur-2xl"
        animate={{ x: ["-15%", "185%"] }}
        transition={{ duration: 2.7, repeat: Infinity, repeatDelay: .5, ease: "easeInOut" }}
      />
      <motion.div
        aria-hidden
        className="absolute left-1/2 top-1/2 h-[62%] w-[72%] -translate-x-1/2 -translate-y-1/2 rounded-[50%] border border-cyan-300/10"
        animate={{ scale: [1, 1.035, 1], opacity: [.35, .7, .35] }}
        transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
      />
      <div aria-hidden className="absolute bottom-[-18%] left-1/2 h-[42%] w-[74%] -translate-x-1/2 rounded-[50%] bg-cyan-500/13 blur-[55px]" />

      <div className="relative grid h-full grid-cols-2 grid-rows-2 gap-[clamp(10px,1.4vw,18px)] rounded-[2rem] border border-white/8 bg-black/15 p-[clamp(12px,1.5vw,20px)] shadow-[inset_0_1px_0_rgba(255,255,255,.035)]">
        <CabinetCell slot={1} active={slotNum === 1} />
        <CabinetCell slot={3} active={slotNum === 3} />
        <CabinetCell slot={2} active={slotNum === 2} />
        <CabinetCell slot={4} active={slotNum === 4} />
      </div>

      {slotNum != null && (
        <motion.div
          aria-hidden
          className="absolute left-1/2 top-1/2 h-[46%] w-[2px] -translate-x-1/2 -translate-y-1/2 bg-[linear-gradient(180deg,transparent,rgba(103,232,249,.92),transparent)] shadow-[0_0_22px_rgba(103,232,249,.75)]"
          animate={{ opacity: [0, .85, 0], scaleY: [.4, 1, .4] }}
          transition={{ duration: 1.05, repeat: Infinity, ease: "easeInOut" }}
        />
      )}

      <motion.div
        aria-hidden
        className="absolute inset-x-[-18%] bottom-0 h-[30%] bg-[linear-gradient(90deg,transparent,rgba(103,232,249,.22),transparent)] blur-2xl"
        animate={{ x: ["-28%", "38%", "-28%"] }}
        transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
      />
    </div>
  );
}
