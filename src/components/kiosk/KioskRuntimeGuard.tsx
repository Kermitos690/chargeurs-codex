import { Component, type ErrorInfo, type ReactNode, useEffect, useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";
import { LiquidBackground } from "@/components/LiquidBackground";
import { Button } from "@/components/ui/button";

const BLANK_SCREEN_DELAY_MS = 4_000;
const RECHECK_INTERVAL_MS = 4_000;

export function currentKioskStation(): string | null {
  const hashPath = window.location.hash.replace(/^#/, "");
  const path = hashPath.startsWith("/kiosk") ? hashPath : window.location.pathname;
  const match = path.match(/^\/kiosk\/([^/?#]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export function hasMeaningfulKioskContent(root: ParentNode = document): boolean {
  // The kiosk has several legitimate top-level surfaces. The premium customer
  // gate intentionally does not render a <main>, so checking <main> alone made
  // the blank-screen guard replace a perfectly healthy member QR / connected
  // screen after four seconds. Treat any known kiosk surface with actual text
  // or visible/interactive content as rendered.
  const selectors = [
    ".kiosk-quarantine",
    ".premium-kiosk",
    ".cinematic-home",
    ".kiosk-root",
    "main",
  ];

  for (const selector of selectors) {
    const surface = root.querySelector(selector);
    if (!surface) continue;

    const content = surface.textContent?.replace(/\s+/g, "").trim() ?? "";
    if (content.length >= 5) return true;

    // Loading states can be intentionally text-light but still render a real
    // spinner/visual. A genuine empty React mount has none of these descendants.
    if (surface.querySelector("button, a, svg, img, canvas, [role='status'], [role='dialog']")) {
      return true;
    }
  }

  return false;
}

function RecoveryScreen({ reason }: { reason: "blank" | "crash" }) {
  const station = currentKioskStation();
  return (
    <div className="fixed inset-0 z-[200] grid place-items-center bg-background px-6 text-center">
      <LiquidBackground />
      <div className="glass-strong liquid-border relative flex w-full max-w-lg flex-col items-center gap-5 rounded-3xl p-8">
        <BrandLogo size="md" />
        <div className="grid h-20 w-20 place-items-center rounded-full bg-warning/20">
          <AlertTriangle className="h-10 w-10 text-warning" />
        </div>
        <h1 className="font-display text-3xl font-bold">Borne temporairement indisponible</h1>
        <p className="max-w-md text-muted-foreground">
          {reason === "crash"
            ? "L’interface de la borne a rencontré une erreur et a été arrêtée par sécurité."
            : "Les informations de la borne n’ont pas pu être affichées. Aucun paiement ne peut être lancé dans cet état."}
        </p>
        {station && (
          <p className="font-mono text-sm text-foreground">Borne : {station}</p>
        )}
        <Button
          type="button"
          onClick={() => window.location.reload()}
          className="gap-2 rounded-full bg-gradient-primary px-8 py-5 text-lg font-bold"
        >
          <RefreshCw className="h-5 w-5" />Réessayer
        </Button>
        <p className="text-xs text-muted-foreground">
          Pour ouvrir le diagnostic, rechargez puis touchez cinq fois rapidement le logo Chargeurs.ch.
        </p>
      </div>
    </div>
  );
}

export function KioskBlankScreenGuard() {
  const [blank, setBlank] = useState(false);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;

    const inspect = () => setBlank(!hasMeaningfulKioskContent());
    const firstCheck = setTimeout(() => {
      inspect();
      interval = setInterval(inspect, RECHECK_INTERVAL_MS);
    }, BLANK_SCREEN_DELAY_MS);

    return () => {
      clearTimeout(firstCheck);
      if (interval) clearInterval(interval);
    };
  }, []);

  return blank ? <RecoveryScreen reason="blank" /> : null;
}

type BoundaryProps = { children: ReactNode };
type BoundaryState = { failed: boolean };

export class KioskErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { failed: false };

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep logs free of kiosk tokens and provider payloads. React supplies only
    // the component stack here; no backend response body is persisted.
    console.error("KIOSK_RENDER_FAILED", error.name, info.componentStack);
  }

  render() {
    if (this.state.failed) return <RecoveryScreen reason="crash" />;
    return this.props.children;
  }
}
