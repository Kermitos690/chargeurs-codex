import { motion } from "framer-motion";
import { BatteryCharging, Zap } from "lucide-react";

type Props = {
  charge: number | null;
  selected: boolean;
  recommended: boolean;
  rentable: boolean;
};

/**
 * A lightweight, code-native three-dimensional powerbank. It deliberately
 * uses CSS and motion rather than a remote model/video so it remains smooth
 * on the DTA tablet and works when campaign media is unavailable.
 */
export function PowerbankScene({ charge, selected, recommended, rentable }: Props) {
  const level = charge == null ? 0 : Math.max(0, Math.min(100, charge));
  const accent = rentable ? "from-cyan-300 via-blue-500 to-violet-500" : "from-slate-500 via-slate-600 to-slate-800";
  return (
    <motion.div className="relative mt-3 h-20 [perspective:600px]" aria-hidden="true"
      animate={selected || recommended ? { y: [0, -4, 0], rotateY: [-4, 4, -4] } : { rotateY: [-2, 2, -2] }}
      transition={{ duration: selected ? 1.7 : 4.2, repeat: Infinity, ease: "easeInOut" }}>
      <motion.div className={`absolute inset-x-3 top-2 h-14 rounded-2xl border border-white/25 bg-gradient-to-br ${accent} shadow-[0_18px_22px_rgba(0,0,0,.38)]`}
        style={{ transform: "rotateX(8deg) rotateY(-11deg)" }}>
        <div className="absolute inset-x-3 top-3 h-1 rounded-full bg-white/30" />
        <div className="absolute bottom-2 left-3 flex gap-1">
          {[0, 1, 2, 3].map((led) => <span key={led} className={`h-1.5 w-1.5 rounded-full ${level >= (led + 1) * 25 ? "bg-lime-300 shadow-[0_0_8px_rgba(190,242,100,1)]" : "bg-black/35"}`} />)}
        </div>
        <BatteryCharging className="absolute right-3 top-4 h-6 w-6 text-white/95" />
      </motion.div>
      <motion.div className="absolute inset-x-6 bottom-1 h-4 rounded-full bg-primary/40 blur-xl" animate={{ opacity: rentable ? [.35, .8, .35] : [.15, .3, .15] }} transition={{ duration: 2, repeat: Infinity }} />
      {recommended && <motion.div className="absolute -right-1 -top-1 grid h-6 w-6 place-items-center rounded-full bg-success shadow-glow-success" animate={{ scale: [1, 1.12, 1] }} transition={{ duration: 1.5, repeat: Infinity }}><Zap className="h-3.5 w-3.5 text-success-foreground" /></motion.div>}
    </motion.div>
  );
}
