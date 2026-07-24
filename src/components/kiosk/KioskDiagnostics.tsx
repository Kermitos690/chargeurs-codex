import { useState } from "react";
import { X, RefreshCw, Lock, LogOut, KeyRound, Check, Cpu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { forceSetStation } from "@/lib/kioskLock";
import { readKioskToken } from "@/lib/kioskFetch";

const KIOSK_TOKEN_KEY = "kiosk_token";

type NativeDiagnosticsWindow = Window & {
  ChargeursNative?: {
    openDiagnostics?: () => void;
  };
};

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
      <span className={`text-right font-mono text-sm ${color}`}>{value}</span>
    </div>
  );
}

export function KioskDiagnostics(props: Props) {
  const { stationId, lockedStation, lastSync, net, chargenowConfigured, stationOnline, swUrl, needRefresh, onApplyUpdate, onClose } = props;
  const [relocked, setRelocked] = useState(false);
  const [tokenInput, setTokenInput] = useState("");
  const [savedToken, setSavedToken] = useState(() => readKioskToken() ?? "");
  const [tokenSaved, setTokenSaved] = useState(false);

  const nativeBridge = typeof window === "undefined"
    ? undefined
    : (window as NativeDiagnosticsWindow).ChargeursNative;
  const nativeDiagnosticsAvailable = typeof nativeBridge?.openDiagnostics === "function";

  const tokenReady = savedToken.length >= 24;
  const chargenowValue = !tokenReady
    ? "activation kiosk requise"
    : chargenowConfigured == null
      ? "vérification…"
      : chargenowConfigured
        ? "configurée"
        : "non configurée ou inaccessible";
  const chargenowTone = !tokenReady || chargenowConfigured == null
    ? "warn"
    : chargenowConfigured
      ? "ok"
      : "bad";

  const relock = () => {
    if (stationId) {
      forceSetStation(stationId);
      setRelocked(true);
    }
  };

  const saveToken = () => {
    const t = tokenInput.trim();
    if (t.length < 24) return;
    try {
      localStorage.setItem(KIOSK_TOKEN_KEY, t);
      setSavedToken(t);
      setTokenInput("");
      setTokenSaved(true);
      setTimeout(() => setTokenSaved(false), 2500);
    } catch {
      // Local storage can be unavailable in restricted kiosk mode.
    }
  };

  const exitFullscreen = async () => {
    if (document.fullscreenElement && document.exitFullscreen) {
      await document.exitFullscreen();
    } else {
      const legacyDocument = document as Document & { webkitExitFullscreen?: () => void };
      legacyDocument.webkitExitFullscreen?.();
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-background/90 p-6 backdrop-blur-xl">
      <div className="glass-strong liquid-border max-h-[90vh] w-full max-w-md overflow-y-auto rounded-3xl p-6">
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
        <Row label="API ChargeNow" value={chargenowValue} tone={chargenowTone} />
        <Row label="Borne physique" value={!tokenReady ? "activation requise" : stationOnline == null ? "—" : stationOnline ? "en ligne" : "hors ligne"} tone={!tokenReady ? "warn" : stationOnline ? "ok" : stationOnline === false ? "bad" : "warn"} />
        <Row label="Passerelle locale" value={nativeDiagnosticsAvailable ? "APK Chargeurs.ch détectée" : "navigateur web uniquement"} tone={nativeDiagnosticsAvailable ? "ok" : "warn"} />
        <Row label="Stripe" value="vérifié côté serveur au paiement" />
        <Row label="Token kiosk" value={maskToken(savedToken)} tone={tokenReady ? "ok" : "bad"} />

        <div className="mt-5 rounded-2xl border border-border/40 p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium">
            <KeyRound className="h-4 w-4" />
            {savedToken ? "Remplacer le token kiosk" : "Enregistrer le token kiosk"}
          </div>
          <p className="mb-3 text-xs text-muted-foreground">
            Collez le token fourni pour cette borne ({stationId ?? "—"}). Il est stocké uniquement sur cette tablette et n'est envoyé qu'aux fonctions serveur kiosk autorisées.
          </p>
          <Input
            type="password"
            inputMode="text"
            autoComplete="off"
            placeholder="kt_…"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            className="font-mono text-sm"
          />
          <Button
            onClick={saveToken}
            disabled={tokenInput.trim().length < 24}
            className="mt-3 w-full gap-2 rounded-full bg-gradient-primary"
          >
            {tokenSaved ? <><Check className="h-4 w-4" />Token enregistré ✓</> : <><KeyRound className="h-4 w-4" />Enregistrer le token</>}
          </Button>
        </div>

        <div className="mt-5 flex flex-col gap-2">
          {needRefresh && (
            <Button onClick={onApplyUpdate} className="gap-2 rounded-full bg-gradient-primary">
              <RefreshCw className="h-4 w-4" />Appliquer la mise à jour
            </Button>
          )}
          {nativeDiagnosticsAvailable && (
            <Button
              onClick={() => nativeBridge?.openDiagnostics?.()}
              className="gap-2 rounded-full bg-gradient-primary"
            >
              <Cpu className="h-4 w-4" />Analyser le matériel local
            </Button>
          )}
          <Button variant="outline" onClick={relock} className="gap-2 rounded-full">
            <Lock className="h-4 w-4" />{relocked ? "Borne verrouillée ✓" : `Verrouiller sur ${stationId ?? "—"}`}
          </Button>
          <Button variant="ghost" onClick={exitFullscreen} className="gap-2 rounded-full text-muted-foreground">
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
