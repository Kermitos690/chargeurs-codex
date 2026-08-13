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
  const visualState = returnAvailable ? "return" : rentable ? "rentable" : "unavailable";

  return (
    <div
      className={`kiosk-slot-visual kiosk-slot-visual--${visualState} relative mt-2 flex h-11 items-center justify-between overflow-hidden rounded-2xl border border-white/15 bg-slate-950/25 px-3`}
      data-slot-visual-state={visualState}
      aria-hidden="true"
    >
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
      className={`relative grid min-h-0 place-items-center overflow-visible rounded-[2rem] border ${active ? "border-cyan-100/90 bg-cyan-300/[.11]" : "border-white/10 bg-white/[.025]"}`}
      animate={active ? {
        scale: [1, 1.018, 1],
        boxShadow: [
          "0 0 0 rgba(34,211,238,0), inset 0 0 0 rgba(34,211,238,0)",
          "0 0 78px rgba(34,211,238,.52), inset 0 0 42px rgba(34,211,238,.16)",
          "0 0 24px rgba(34,211,238,.22), inset 0 0 14px rgba(34,211,238,.05)",
        ],
      } : undefined}
      transition={{ duration: 1.35, repeat: active ? Infinity : 0, ease: "easeInOut" }}
    >
      <div className={`absolute inset-[4%] rounded-[1.7rem] border ${active ? "border-cyan-300/25" : "border-white/[.035]"}`} />
      <div className={`absolute inset-x-[5%] bottom-[-32%] h-[86%] rounded-[50%] blur-3xl ${active ? "bg-cyan-400/34" : "bg-blue-500/6"}`} />

      {active && (
        <>
          <motion.div
            aria-hidden
            className="absolute h-[152%] w-[152%] rounded-full border border-cyan-100/25"
            animate={{ scale: [.52, .94, 1.2], opacity: [.78, .28, 0] }}
            transition={{ duration: 1.3, repeat: Infinity, ease: "easeOut" }}
          />
          <motion.div
            aria-hidden
            className="absolute h-[122%] w-[122%] rounded-full border border-blue-200/25"
            animate={{ scale: [.62, 1.1], opacity: [.62, 0] }}
            transition={{ duration: 1.05, repeat: Infinity, delay: .18, ease: "easeOut" }}
          />
          <motion.div
            aria-hidden
            className="absolute inset-x-[7%] top-[8%] h-[2px] rounded-full bg-cyan-100 shadow-[0_0_24px_rgba(103,232,249,1)]"
            animate={{ y: [0, 78, 0], opacity: [.2, 1, .2] }}
            transition={{ duration: 1.15, repeat: Infinity, ease: "easeInOut" }}
          />
        </>
      )}

      <motion.div
        className={`kiosk-cabinet-powerbank relative grid h-[72%] w-[58%] place-items-center rounded-[1.35rem] border ${active ? "border-cyan-50 bg-[linear-gradient(180deg,rgba(207,250,254,.42),rgba(14,116,200,.3)_40%,rgba(3,18,56,.9))]" : "border-white/14 bg-[linear-gradient(180deg,rgba(255,255,255,.075),rgba(37,99,235,.04))]"}`}
        style={{ transformPerspective: 1000 }}
      >
        <div className={`absolute inset-x-[14%] top-[10%] h-[6px] rounded-full ${active ? "bg-cyan-50 shadow-[0_0_18px_rgba(165,243,252,1)]" : "bg-white/20"}`} />
        <div className="flex flex-col gap-2">
          {[0, 1, 2, 3].map((n) => (
            <motion.span
              key={n}
              className={`h-2 w-2 rounded-full ${active ? "bg-cyan-50 shadow-[0_0_13px_rgba(103,232,249,1)]" : "bg-white/25"}`}
              animate={active ? { opacity: [.4, 1, .4], scale: [.8, 1.42, .8] } : undefined}
              transition={{ duration: .72, repeat: Infinity, delay: n * .09 }}
            />
          ))}
        </div>
        {active && (
          <motion.div
            aria-hidden
            className="absolute inset-x-[9%] bottom-[8%] h-[3px] rounded-full bg-cyan-50 shadow-[0_0_18px_rgba(103,232,249,1)]"
            animate={{ opacity: [.3, 1, .3] }}
            transition={{ duration: .58, repeat: Infinity }}
          />
        )}
      </motion.div>

      <span className={`absolute bottom-4 right-5 grid h-12 w-12 place-items-center rounded-full text-xl font-black ${active ? "bg-white text-blue-950 shadow-[0_0_32px_rgba(255,255,255,.68)]" : "border border-white/12 bg-slate-950/55 text-white/55"}`}>{slot}</span>
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
    <motion.div
      initial={{ opacity: 0, scale: .985 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: .42, ease: "easeOut" }}
      className="relative aspect-[16/10] w-full max-w-none overflow-hidden rounded-[3rem] border border-cyan-100/25 bg-[linear-gradient(145deg,rgba(2,8,24,.99),rgba(3,24,66,.98)_52%,rgba(17,8,54,.99))] p-[clamp(18px,2.4vw,36px)] shadow-[0_42px_130px_rgba(0,0,0,.5),0_0_120px_rgba(34,211,238,.2)]"
    >
      <div aria-hidden className="absolute inset-0 bg-[radial-gradient(circle_at_50%_48%,rgba(56,189,248,.17),transparent_30%),radial-gradient(circle_at_14%_8%,rgba(37,99,235,.28),transparent_36%),radial-gradient(circle_at_92%_84%,rgba(139,92,246,.25),transparent_38%)]" />
      <div aria-hidden className="absolute inset-x-[8%] top-[5%] h-px bg-[linear-gradient(90deg,transparent,rgba(165,243,252,.55),transparent)]" />

      <motion.div
        aria-hidden
        className="absolute -left-[28%] top-[5%] h-[88%] w-[58%] rotate-[18deg] bg-[linear-gradient(90deg,transparent,rgba(125,211,252,.15),transparent)] blur-2xl"
        animate={{ x: ["-15%", "218%"] }}
        transition={{ duration: 2.25, repeat: Infinity, repeatDelay: .35, ease: "easeInOut" }}
      />
      <motion.div
        aria-hidden
        className="absolute left-1/2 top-1/2 h-[72%] w-[80%] -translate-x-1/2 -translate-y-1/2 rounded-[50%] border border-cyan-300/15"
        animate={{ scale: [1, 1.045, 1], opacity: [.38, .82, .38] }}
        transition={{ duration: 2.05, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        aria-hidden
        className="absolute left-1/2 top-1/2 h-[58%] w-[66%] -translate-x-1/2 -translate-y-1/2 rounded-[50%] border border-blue-300/10"
        animate={{ scale: [.98, 1.075, .98], opacity: [.18, .52, .18] }}
        transition={{ duration: 1.65, repeat: Infinity, ease: "easeInOut" }}
      />
      <div aria-hidden className="absolute bottom-[-20%] left-1/2 h-[50%] w-[82%] -translate-x-1/2 rounded-[50%] bg-cyan-500/16 blur-[70px]" />

      <div className="relative grid h-full grid-cols-2 grid-rows-2 gap-[clamp(12px,1.6vw,24px)] rounded-[2.35rem] border border-white/10 bg-black/20 p-[clamp(14px,1.8vw,24px)] shadow-[inset_0_1px_0_rgba(255,255,255,.05),inset_0_-40px_80px_rgba(2,6,23,.28)]">
        <CabinetCell slot={1} active={slotNum === 1} />
        <CabinetCell slot={3} active={slotNum === 3} />
        <CabinetCell slot={2} active={slotNum === 2} />
        <CabinetCell slot={4} active={slotNum === 4} />
      </div>

      {slotNum != null && (
        <>
          <motion.div aria-hidden className="absolute left-1/2 top-1/2 h-[58%] w-[3px] -translate-x-1/2 -translate-y-1/2 bg-[linear-gradient(180deg,transparent,rgba(207,250,254,.98),transparent)] shadow-[0_0_30px_rgba(103,232,249,.95)]" animate={{ opacity: [0, 1, 0], scaleY: [.35, 1, .35] }} transition={{ duration: .92, repeat: Infinity, ease: "easeInOut" }} />
          <motion.div aria-hidden className="absolute left-1/2 top-1/2 h-[86%] w-[86%] -translate-x-1/2 -translate-y-1/2 rounded-[50%] border border-cyan-100/10" animate={{ scale: [.84, 1.04, 1.16], opacity: [.45, .18, 0] }} transition={{ duration: 1.4, repeat: Infinity, ease: "easeOut" }} />
        </>
      )}

      <motion.div aria-hidden className="absolute inset-x-[-22%] bottom-[-2%] h-[34%] bg-[linear-gradient(90deg,transparent,rgba(103,232,249,.28),transparent)] blur-2xl" animate={{ x: ["-34%", "44%", "-34%"] }} transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }} />
    </motion.div>
  );
}
