import type { CSSProperties } from "react";
import { motion } from "framer-motion";
import { useI18n } from "@/i18n/i18n";

/** Visual-only production atmosphere. No payment/rental state lives here. */
export function KioskV3Atmosphere() {
  const { lang } = useI18n();
  const display = {
    fr: { title: "Bienvenue", subtitle: "Choisissez votre option", status: "4 slots · connectés" },
    en: { title: "Welcome", subtitle: "Choose your option", status: "4 slots · connected" },
    de: { title: "Willkommen", subtitle: "Wähle deine Option", status: "4 Slots · verbunden" },
  }[lang];

  return (
    <div className="kv3-atmosphere" aria-hidden="true">
      <div className="kv3-vignette" />
      <div className="kv3-grid-floor" />
      <div className="kv3-horizon-glow" />

      <motion.div className="kv3-neon-beam kv3-neon-beam-a" animate={{ x: ["-20vw", "18vw", "-20vw"], opacity: [.24, .62, .24] }} transition={{ duration: 9.5, repeat: Infinity, ease: "easeInOut" }} />
      <motion.div className="kv3-neon-beam kv3-neon-beam-b" animate={{ x: ["14vw", "-14vw", "14vw"], opacity: [.2, .52, .2] }} transition={{ duration: 12, repeat: Infinity, ease: "easeInOut" }} />

      <div className="kv3-smoke kv3-smoke-a" />
      <div className="kv3-smoke kv3-smoke-b" />
      <div className="kv3-smoke kv3-smoke-c" />
      <div className="kv3-smoke kv3-smoke-d" />
      <div className="kv3-neon-orbit kv3-neon-orbit-a" />
      <div className="kv3-neon-orbit kv3-neon-orbit-b" />

      <motion.div className="kv3-lightning-stage" animate={{ y: [0, -5, 0], rotateZ: [-1.2, 1.2, -1.2] }} transition={{ duration: 6.8, repeat: Infinity, ease: "easeInOut" }}>
        <div className="kv3-lightning-halo" />
        <div className="kv3-lightning-shape"><i /><b /><span /></div>
        <div className="kv3-lightning-pedestal"><strong>chargeurs.ch</strong></div>
        <div className="kv3-lightning-ring" />
      </motion.div>

      <motion.div className="kv3-station-hero" animate={{ y: [0, -7, 0], rotateY: [-10, -6, -10], rotateX: [3, 1.5, 3] }} transition={{ duration: 7.2, repeat: Infinity, ease: "easeInOut" }}>
        <div className="kv3-station-floor-light" />
        <div className="kv3-station-shadow" />
        <div className="kv3-station-body">
          <div className="kv3-station-top" />
          <div className="kv3-station-side" />
          <div className="kv3-station-face">
            <div className="kv3-station-screen">
              <strong>{display.title}</strong>
              <span>{display.subtitle}</span>
              <small>{display.status}</small>
            </div>
            <div className="kv3-station-brand"><span className="kv3-station-brand-mark" /> <strong>Chargeurs.ch</strong></div>
            <div className="kv3-station-slots">
              {[1, 2, 3, 4].map((slot) => <div className="kv3-station-slot" key={slot}><span className="kv3-station-slot-led" /><i>{slot}</i></div>)}
            </div>
          </div>
          <div className="kv3-station-base" />
          <div className="kv3-station-rim" />
        </div>
      </motion.div>

      <div className="kv3-particles">
        {Array.from({ length: 20 }).map((_, i) => <i key={i} style={{ "--i": i } as CSSProperties} />)}
      </div>
    </div>
  );
}
