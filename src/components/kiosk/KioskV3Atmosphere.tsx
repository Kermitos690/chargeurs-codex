import { motion } from "framer-motion";

/**
 * Visual-only V3 atmosphere. No rental or payment state is stored here.
 * The scene is built from native DOM/CSS so it stays crisp on the physical
 * 16:9 display and does not depend on remote image assets.
 */
export function KioskV3Atmosphere() {
  return (
    <div className="kv3-atmosphere" aria-hidden="true">
      <div className="kv3-vignette" />
      <div className="kv3-grid-floor" />
      <motion.div
        className="kv3-neon-beam kv3-neon-beam-a"
        animate={{ x: ["-18vw", "18vw", "-18vw"], opacity: [.22, .52, .22] }}
        transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="kv3-neon-beam kv3-neon-beam-b"
        animate={{ x: ["12vw", "-12vw", "12vw"], opacity: [.16, .38, .16] }}
        transition={{ duration: 13, repeat: Infinity, ease: "easeInOut" }}
      />
      <div className="kv3-smoke kv3-smoke-a" />
      <div className="kv3-smoke kv3-smoke-b" />
      <div className="kv3-smoke kv3-smoke-c" />

      <motion.div
        className="kv3-powerbank-hero"
        animate={{ y: [0, -10, 0], rotateY: [-14, -8, -14], rotateX: [7, 4, 7] }}
        transition={{ duration: 6.5, repeat: Infinity, ease: "easeInOut" }}
      >
        <div className="kv3-powerbank-shadow" />
        <div className="kv3-powerbank-body">
          <div className="kv3-powerbank-edge" />
          <div className="kv3-powerbank-face">
            <span className="kv3-powerbank-brand">Chargeurs.ch</span>
            <span className="kv3-powerbank-bolt">↯</span>
            <div className="kv3-powerbank-leds"><i /><i /><i /><i /></div>
          </div>
          <div className="kv3-powerbank-side" />
          <div className="kv3-powerbank-top" />
        </div>
      </motion.div>

      <div className="kv3-particles">
        {Array.from({ length: 12 }).map((_, i) => <i key={i} style={{ "--i": i } as React.CSSProperties} />)}
      </div>
    </div>
  );
}
