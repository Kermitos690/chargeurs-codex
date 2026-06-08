import { useState } from "react";
import { X, RefreshCw, Lock, LogOut, KeyRound, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { forceSetStation } from "@/lib/kioskLock";

const KIOSK_TOKEN_KEY = "kiosk_token";

function readToken(): string {
  try {
    return localStorage.getItem(KIOSK_TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

// Non-secret masked preview: prefix + length only (never the full token).
function maskToken(t: string): string {
  if (!t) return "aucun token enregistré";
  const head = t.slice(0, 10);
  return `${head}… (${t.length} car.)`;
}

type Props = {
  stationId: string | undefined;
  lockedStation: string | null;
  lastSync: string | null;
  net: "online" | "offline";
  chargenowConfigured: boolean | null;
  stationOnline: boolean | null;
  swUrl: string | null;
  needRefresh: boolean;
  onApplyUpdate: () => void;
  onClose: () => void;
};

function Row({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" | "bad" }) {
  const color = tone === "ok" ? "text-success" : tone === "warn" ? "text-warning" : tone === "bad" ? "text-destructive" : "text-foreground";
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border/40 py-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={`font-mono text-sm ${color}`}>{value}</span>
    </div>
  );
}

// Protected diagnostics overlay. Reached only via the hidden trigger (5 taps on
// the logo). Shows operational state — never any secret or admin token.
export function KioskDiagnostics(props: Props) {
  const { stationId, lockedStation, lastSync, net, chargenowConfigured, stationOnline, swUrl, needRefresh, onApplyUpdate, onClose } = props;
  const [relocked, setRelocked] = useState(false);

  const relock = () => {
    if (stationId) {
      forceSetStation(stationId);
      setRelocked(true);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-background/90 p-6 backdrop-blur-xl">
      <div className="glass-strong liquid-border w-full max-w-md rounded-3xl p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-xl font-bold">Diagnostic borne</h2>
          <Button variant="ghost" size="icon" onClick={onClose}><X className="h-5 w-5" /></Button>
        </div>

        <Row label="Version frontend" value={typeof __APP_BUILD__ !== "undefined" ? __APP_BUILD__ : "dev"} />
        <Row label="Service Worker" value={swUrl ? swUrl.split("/").pop() ?? "actif" : "inactif (dev/preview)"} tone={swUrl ? "ok" : "warn"} />
        <Row label="Cabinet (URL)" value={stationId ?? "—"} />
        <Row
          label="Cabinet verrouillé"
          value={lockedStation ?? "non verrouillé"}
          tone={lockedStation && lockedStation === stationId ? "ok" : lockedStation ? "bad" : "warn"}
        />
        <Row label="Dernière synchro" value={lastSync ? new Date(lastSync).toLocaleString("fr-CH") : "—"} />
        <Row label="Réseau Internet" value={net === "online" ? "connecté" : "indisponible"} tone={net === "online" ? "ok" : "bad"} />
        <Row
          label="API ChargeNow"
          value={chargenowConfigured == null ? "vérification…" : chargenowConfigured ? "configurée" : "non configurée"}
          tone={chargenowConfigured == null ? "warn" : chargenowConfigured ? "ok" : "bad"}
        />
        <Row label="Borne physique" value={stationOnline == null ? "—" : stationOnline ? "en ligne" : "hors ligne"} tone={stationOnline ? "ok" : stationOnline === false ? "bad" : "warn"} />
        <Row label="Stripe" value="vérifié côté serveur au paiement" />

        <div className="mt-5 flex flex-col gap-2">
          {needRefresh && (
            <Button onClick={onApplyUpdate} className="gap-2 rounded-full bg-gradient-primary">
              <RefreshCw className="h-4 w-4" />Appliquer la mise à jour
            </Button>
          )}
          <Button variant="outline" onClick={relock} className="gap-2 rounded-full">
            <Lock className="h-4 w-4" />{relocked ? "Borne verrouillée ✓" : `Verrouiller sur ${stationId ?? "—"}`}
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              const d = document as Document & { webkitExitFullscreen?: () => void };
              if (document.fullscreenElement) (document.exitFullscreen?.() ?? d.webkitExitFullscreen?.());
              onClose();
            }}
            className="gap-2 rounded-full text-muted-foreground"
          >
            <LogOut className="h-4 w-4" />Quitter le plein écran
          </Button>
        </div>
        <p className="mt-4 text-center text-xs text-muted-foreground">
          Aucun secret ChargeNow / Stripe n'est exposé ici. Les opérations sensibles restent côté serveur.
        </p>
      </div>
    </div>
  );
}
