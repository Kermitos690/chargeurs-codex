import { useEffect, useState } from "react";
import type { CommandCenterMode } from "./types";

export const LARGE_VIEWPORT_MIN_WIDTH = 768;
export const LANDSCAPE_LARGE_MIN_WIDTH = 640;

export function resolveCommandCenterMode(width: number, height: number): CommandCenterMode {
  const safeWidth = Number.isFinite(width) ? Math.max(0, width) : 0;
  const safeHeight = Number.isFinite(height) ? Math.max(0, height) : 0;
  const isLandscape = safeWidth > safeHeight;

  if (safeWidth >= LARGE_VIEWPORT_MIN_WIDTH) return "large";
  if (isLandscape && safeWidth >= LANDSCAPE_LARGE_MIN_WIDTH) return "large";
  return "mobile";
}

function currentMode(): CommandCenterMode {
  if (typeof window === "undefined") return "large";
  return resolveCommandCenterMode(window.innerWidth, window.innerHeight);
}

export function useCommandCenterMode(): CommandCenterMode {
  const [mode, setMode] = useState<CommandCenterMode>(() => currentMode());

  useEffect(() => {
    const update = () => setMode(currentMode());
    update();
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);

  return mode;
}
