import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";

type Pulse = {
  id: number;
  x: number;
  y: number;
  journey: "express" | "client" | "neutral";
};

function currentJourney(): Pulse["journey"] {
  const value = document.documentElement.dataset.kioskJourney;
  if (value === "express" || value === "client") return value;
  return "neutral";
}

/**
 * Decorative pointer feedback only.
 * It observes taps on enabled buttons and paints a short-lived visual pulse.
 * The layer never intercepts pointer events and never invokes product actions.
 */
export function KioskV3TouchFeedback() {
  const reducedMotion = useReducedMotion();
  const [pulse, setPulse] = useState<Pulse | null>(null);

  useEffect(() => {
    if (reducedMotion) return;
    let counter = 0;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target.closest("button") : null;
      if (!(target instanceof HTMLButtonElement) || target.disabled) return;
      if (!target.closest(".kv3-runtime")) return;
      counter += 1;
      setPulse({ id: counter, x: event.clientX, y: event.clientY, journey: currentJourney() });
    };
    window.addEventListener("pointerdown", onPointerDown, { capture: true, passive: true });
    return () => window.removeEventListener("pointerdown", onPointerDown, true);
  }, [reducedMotion]);

  if (reducedMotion) return null;

  return (
    <div className="kv3-touch-feedback-layer" aria-hidden="true">
      <AnimatePresence>
        {pulse && (
          <motion.span
            key={pulse.id}
            className={`kv3-touch-feedback is-${pulse.journey}`}
            style={{ left: pulse.x, top: pulse.y }}
            initial={{ opacity: .9, scale: .25 }}
            animate={{ opacity: [0.9, .48, 0], scale: [0.25, .9, 1.45] }}
            exit={{ opacity: 0 }}
            transition={{ duration: .46, ease: [0.18, 0.82, 0.22, 1] }}
            onAnimationComplete={() => setPulse((current) => current?.id === pulse.id ? null : current)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
