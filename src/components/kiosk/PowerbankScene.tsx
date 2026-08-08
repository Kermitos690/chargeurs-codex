import { motion } from "framer-motion";
import { Zap } from "lucide-react";

type Props = {
  charge: number | null;
  selected: boolean;
  recommended: boolean;
  rentable: boolean;
};

/**
 * A deliberately code-native 3D product scene: three visible faces, depth,
 * moving scan light and LEDs. It is GPU-friendly CSS/motion rather than a
 * remote video so it remains smooth and available on the DTA tablet offline.
 */
export function PowerbankScene({ charge, selected, recommended, rentable }: Props) {
  const level = charge == null ? 0 : Math.max(0, Math.min(100, charge));
  const alive = rentable || recommended || selected;
  const body = rentable ? "from-cyan-200 via-blue-500 to-violet-700" : "from-slate-300 via-slate-500 to-slate-700";

  return (
    <motion.div
      className="relative mt-1 h-[4.7rem] w-full [perspective:900px]"
      aria-hidden="true"
      animate={selected || recommended
        ? { y: [0, -6, 0], rotateY: [-3, 4, -3] }
        : { y: [0, -2, 0], rotateY: [-1.5, 1.5, -1.5] }}
      transition={{ duration: selected ? 1.5 : 4.4, repeat: Infinity, ease: "easeInOut" }}
    >
      {/* Projected floor / neon reflection. */}
      <motion.div
        className={`absolute inset-x-6 bottom-0 h-5 rounded-[100%] ${alive ? "bg-cyan-400/55" : "bg-slate-500/25"} blur-xl`}
        animate={{ scaleX: alive ? [.82, 1.18, .82] : [.86, 1, .86], opacity: alive ? [.42, .9, .42] : [.18, .35, .18] }}
        transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
      />

      <motion.div className="absolute inset-x-4 top-4 h-10 [transform-style:preserve-3d]"
        style={{ transform: "rotateX(51deg) rotateZ(-4deg)" }}>
        {/* Main face */}
        <div className={`absolute inset-0 overflow-hidden rounded-xl border border-white/60 bg-gradient-to-br ${body} shadow-[0_16px_25px_rgba(4,12,45,.7)]`}>
          <div className="absolute inset-x-2 top-1 h-px bg-white/80" />
          <div className="absolute inset-x-3 bottom-1.5 flex gap-1">
            {[0, 1, 2, 3].map((led) => (
              <motion.span key={led} className={`h-1.5 w-1.5 rounded-full ${level >= (led + 1) * 25 ? "bg-lime-200 shadow-[0_0_10px_rgba(190,242,100,1)]" : "bg-slate-950/50"}`}
                animate={level >= (led + 1) * 25 ? { opacity: [.55, 1, .55] } : undefined}
                transition={{ duration: 1.3, repeat: Infinity, delay: led * .12 }}
              />
            ))}
          </div>
          {alive && <motion.div className="absolute -inset-y-5 w-8 rotate-12 bg-white/75 blur-sm"
            animate={{ x: ["-160%", "540%"] }} transition={{ duration: 2.7, repeat: Infinity, repeatDelay: 1.2, ease: "easeInOut" }} />}
          <div className="absolute right-2 top-2 text-[.65rem] font-black tracking-tighter text-white/90">CHG</div>
        </div>
        {/* Right depth face */}
        <div className="absolute -right-2 bottom-1 top-1 w-3 origin-left rounded-r-md border-y border-r border-white/25 bg-slate-950/55"
          style={{ transform: "rotateY(76deg)" }} />
        {/* Bottom depth face */}
        <div className="absolute -bottom-2 left-1 right-2 h-3 origin-top rounded-b-lg bg-slate-950/65"
          style={{ transform: "rotateX(-76deg)" }} />
        {/* Top metallic edge */}
        <div className="absolute -top-1 left-1 right-1 h-2 origin-bottom rounded-t-lg bg-gradient-to-r from-white/80 via-cyan-100/70 to-violet-200/80"
          style={{ transform: "rotateX(76deg)" }} />
      </motion.div>

      {recommended && (
        <motion.div className="absolute right-0 top-0 grid h-7 w-7 place-items-center rounded-full border border-white/50 bg-gradient-success shadow-[0_0_22px_rgba(132,204,22,.75)]"
          animate={{ scale: [1, 1.16, 1], rotate: [0, 6, -6, 0] }} transition={{ duration: 1.6, repeat: Infinity }}>
          <Zap className="h-4 w-4 text-success-foreground" />
        </motion.div>
      )}
    </motion.div>
  );
}

/** Adds depth to the idle page itself without competing with the battery controls. */
export function KioskHolographicFloor() {
  return (
    <div className="pointer-events-none absolute inset-x-[7%] bottom-[6%] top-[22%] overflow-hidden rounded-[3rem] opacity-70" aria-hidden="true">
      <motion.div className="absolute inset-x-[8%] bottom-3 h-40 rounded-[50%] border border-cyan-300/25 bg-[radial-gradient(ellipse_at_center,rgba(14,165,233,.14),transparent_68%)]"
        style={{ transform: "perspective(750px) rotateX(66deg)" }}
        animate={{ scale: [1, 1.08, 1], opacity: [.45, .8, .45] }} transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }} />
      {[0, 1, 2].map((ring) => <motion.div key={ring} className="absolute left-1/2 top-1/2 h-48 w-48 -translate-x-1/2 -translate-y-1/2 rounded-full border border-primary/25"
        animate={{ scale: [0.55, 1.55], opacity: [.7, 0] }} transition={{ duration: 4.5, delay: ring * 1.5, repeat: Infinity, ease: "easeOut" }} />)}
    </div>
  );
}
