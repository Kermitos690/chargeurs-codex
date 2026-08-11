import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { KioskScene } from "@/components/kiosk/KioskV3JourneyChrome";

type Journey = "express" | "client" | "";

type VisualProfile = {
  accent: string;
  accentSoft: string;
  secondary: string;
  intensity: number;
  sweep: boolean;
  focus: "wide" | "right" | "center" | "slot";
};

function currentScene(): KioskScene {
  return (document.documentElement.dataset.kioskScene as KioskScene | undefined) ?? "other";
}

function currentJourney(): Journey {
  const value = document.documentElement.dataset.kioskJourney;
  return value === "express" || value === "client" ? value : "";
}

function profileFor(scene: KioskScene, journey: Journey): VisualProfile {
  const client = journey === "client" || scene === "member" || scene === "connected";
  const action = client ? "58,167,255" : "131,255,79";
  const actionSoft = client ? "28,116,255" : "62,215,43";

  switch (scene) {
    case "home":
      return { accent: "80,185,255", accentSoft: "57,114,255", secondary: "131,255,79", intensity: .62, sweep: false, focus: "wide" };
    case "member":
    case "connected":
      return { accent: "58,167,255", accentSoft: "26,103,255", secondary: "94,214,255", intensity: .68, sweep: true, focus: "right" };
    case "selection":
    case "pricing":
      return { accent: action, accentSoft: actionSoft, secondary: client ? "111,217,255" : "171,255,133", intensity: .56, sweep: scene === "pricing", focus: "center" };
    case "starting":
    case "payment":
      return { accent: action, accentSoft: actionSoft, secondary: "72,205,255", intensity: .64, sweep: scene === "starting", focus: "right" };
    case "release":
      return { accent: "61,194,255", accentSoft: client ? "29,110,255" : "77,224,82", secondary: client ? "89,212,255" : "151,255,95", intensity: .92, sweep: true, focus: "slot" };
    case "active":
      return { accent: "110,231,183", accentSoft: "44,190,142", secondary: client ? "81,188,255" : "151,255,95", intensity: .88, sweep: true, focus: "slot" };
    case "return":
      return { accent: "75,205,255", accentSoft: "41,138,211", secondary: "110,231,183", intensity: .54, sweep: false, focus: "center" };
    case "expired":
    case "support":
      return { accent: "255,197,109", accentSoft: "180,119,43", secondary: "255,226,170", intensity: .30, sweep: false, focus: "center" };
    case "error":
      return { accent: "255,107,120", accentSoft: "169,55,69", secondary: "255,177,185", intensity: .26, sweep: false, focus: "center" };
    default:
      return { accent: "80,185,255", accentSoft: "57,114,255", secondary: "124,211,255", intensity: .32, sweep: false, focus: "wide" };
  }
}

/**
 * Presentation-only cinematic layer.
 *
 * It observes the scene already chosen by the kiosk state machine/chrome and
 * paints light, depth and scene-transition energy. It has no interaction,
 * timer-to-success logic, network access, payment logic or hardware authority.
 */
export function KioskV3CinematicDirector() {
  const reducedMotion = useReducedMotion();
  const [scene, setScene] = useState<KioskScene>(() => currentScene());
  const [journey, setJourney] = useState<Journey>(() => currentJourney());

  useEffect(() => {
    const detect = () => {
      const nextScene = currentScene();
      const nextJourney = currentJourney();
      setScene((value) => value === nextScene ? value : nextScene);
      setJourney((value) => value === nextJourney ? value : nextJourney);
    };
    detect();
    const observer = new MutationObserver(detect);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-kiosk-scene", "data-kiosk-journey", "data-kiosk-return-stage"],
    });
    return () => observer.disconnect();
  }, []);

  const profile = useMemo(() => profileFor(scene, journey), [journey, scene]);
  const style = {
    "--kc-accent": profile.accent,
    "--kc-accent-soft": profile.accentSoft,
    "--kc-secondary": profile.secondary,
    "--kc-intensity": String(profile.intensity),
  } as CSSProperties;

  if (scene === "other" || scene === "loading") return null;

  return (
    <div
      className={`kv3-cinema kv3-cinema-${scene} is-focus-${profile.focus}`}
      style={style}
      aria-hidden="true"
    >
      <motion.div
        className="kv3-cinema-depth"
        animate={reducedMotion ? undefined : { opacity: [0.68, 1, 0.68], scale: [1, 1.018, 1] }}
        transition={{ duration: scene === "release" ? 3.2 : 6.5, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="kv3-cinema-horizon"
        animate={reducedMotion ? undefined : { opacity: [.48, .82, .48], scaleX: [.96, 1.035, .96] }}
        transition={{ duration: 5.2, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="kv3-cinema-energy-path"
        animate={reducedMotion ? undefined : {
          opacity: scene === "release" ? [.22, .95, .22] : [.14, .48, .14],
          scaleX: scene === "release" ? [.76, 1.04, .76] : [.9, 1.02, .9],
        }}
        transition={{ duration: scene === "release" ? 1.45 : 4.8, repeat: Infinity, ease: "easeInOut" }}
      />
      {(scene === "release" || scene === "active") && (
        <>
          <motion.div
            className="kv3-cinema-slot-ring kv3-cinema-slot-ring-a"
            animate={reducedMotion ? undefined : { scale: [.72, 1.12], opacity: [.42, 0] }}
            transition={{ duration: scene === "release" ? 1.2 : 1.65, repeat: Infinity, ease: "easeOut" }}
          />
          <motion.div
            className="kv3-cinema-slot-ring kv3-cinema-slot-ring-b"
            animate={reducedMotion ? undefined : { scale: [.66, 1.2], opacity: [.32, 0] }}
            transition={{ duration: scene === "release" ? 1.45 : 1.9, repeat: Infinity, delay: .22, ease: "easeOut" }}
          />
        </>
      )}
      <AnimatePresence mode="wait">
        {!reducedMotion && profile.sweep && (
          <motion.div
            key={`${scene}:${journey}`}
            className="kv3-cinema-transition-sweep"
            initial={{ x: "-72vw", opacity: 0, rotate: -12 }}
            animate={{ x: "78vw", opacity: [0, .88, .16, 0], rotate: -12 }}
            exit={{ opacity: 0 }}
            transition={{ duration: scene === "release" ? .82 : .68, ease: [0.2, 0.8, 0.2, 1] }}
          />
        )}
      </AnimatePresence>
      {scene === "active" && !reducedMotion && (
        <motion.div
          key={`active-confirmation:${journey}`}
          className="kv3-cinema-success-bloom"
          initial={{ opacity: 0, scale: .4 }}
          animate={{ opacity: [0, .82, .28, 0], scale: [.4, 1, 1.42, 1.72] }}
          transition={{ duration: 1.35, ease: "easeOut" }}
        />
      )}
      {scene === "return" && (
        <motion.div
          className="kv3-cinema-return-close"
          animate={reducedMotion ? undefined : { opacity: [.15, .38, .15], scale: [1.08, .96, 1.08] }}
          transition={{ duration: 4.2, repeat: Infinity, ease: "easeInOut" }}
        />
      )}
    </div>
  );
}
