import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Camera, ChevronLeft, ClipboardPaste, Loader2, QrCode, TriangleAlert } from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";
import { LiquidBackground } from "@/components/LiquidBackground";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type DetectorResult = { rawValue?: string };
type Detector = { detect(source: CanvasImageSource): Promise<DetectorResult[]> };
type DetectorCtor = new (options?: { formats?: string[] }) => Detector;

function pairingPathFromValue(rawValue: string): string | null {
  try {
    const url = new URL(rawValue.trim(), window.location.origin);
    const match = url.pathname.match(/^\/compte\/connect\/([A-Za-z0-9_-]{40,80})\/?$/);
    return match ? `/compte/connect/${match[1]}` : null;
  } catch {
    return null;
  }
}

export default function AccountScanner() {
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const [starting, setStarting] = useState(false);
  const [active, setActive] = useState(false);
  const [unsupported, setUnsupported] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manualLink, setManualLink] = useState("");

  const stop = () => {
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setActive(false);
  };

  useEffect(() => {
    const DetectorClass = (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
    setUnsupported(!DetectorClass);
    return stop;
  }, []);

  const openPairingValue = (value: string) => {
    const path = pairingPathFromValue(value);
    if (!path) {
      setError("INVALID_PAIRING_LINK");
      return false;
    }
    stop();
    navigate(path);
    return true;
  };

  const pasteLink = async () => {
    setError(null);
    try {
      const value = await navigator.clipboard.readText();
      setManualLink(value);
      openPairingValue(value);
    } catch {
      setError("CLIPBOARD_UNAVAILABLE");
    }
  };

  const start = async () => {
    setError(null);
    setStarting(true);
    const DetectorClass = (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
    if (!DetectorClass) {
      setUnsupported(true);
      setStarting(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      streamRef.current = stream;
      if (!videoRef.current) throw new Error("CAMERA_NOT_READY");
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      const detector = new DetectorClass({ formats: ["qr_code"] });
      setActive(true);
      timerRef.current = window.setInterval(async () => {
        const video = videoRef.current;
        if (!video || video.readyState < 2) return;
        try {
          const results = await detector.detect(video);
          for (const result of results) {
            if (result.rawValue && openPairingValue(result.rawValue)) return;
          }
        } catch {
          // A single decode miss is normal while the camera is moving.
        }
      }, 350);
    } catch (err) {
      setError(err instanceof Error ? err.message : "CAMERA_UNAVAILABLE");
      stop();
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="relative min-h-screen px-5 py-7">
      <LiquidBackground />
      <div className="relative mx-auto w-full max-w-xl">
        <div className="flex items-center justify-between">
          <Button asChild variant="ghost" className="rounded-full"><Link to="/compte"><ChevronLeft className="mr-2 h-4 w-4" />Retour</Link></Button>
          <BrandLogo size="sm" />
        </div>

        <section className="glass-strong liquid-border mt-6 overflow-hidden rounded-[2rem] p-6 text-center sm:p-8">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-success/15">
            <QrCode className="h-8 w-8 text-success" />
          </div>
          <h1 className="mt-5 font-display text-3xl font-extrabold">Scanner une borne</h1>
          <p className="mt-2 text-muted-foreground">Scannez le QR vert affiché sur la borne. Votre compte sera relié à cette location, jamais à une autre borne.</p>

          {!unsupported && (
            <div className="relative mt-6 aspect-square overflow-hidden rounded-3xl border border-success/25 bg-black/60">
              <video ref={videoRef} muted playsInline className={`h-full w-full object-cover ${active ? "opacity-100" : "opacity-20"}`} />
              {!active && (
                <div className="absolute inset-0 grid place-items-center p-8">
                  <Camera className="h-16 w-16 text-white/60" />
                </div>
              )}
              {active && <div className="pointer-events-none absolute inset-[12%] rounded-3xl border-2 border-success shadow-glow-success" />}
            </div>
          )}

          {unsupported && (
            <div className="mt-6 rounded-2xl border border-warning/25 bg-warning/10 p-5 text-left">
              <p className="font-semibold text-warning">Sur iPhone, utilisez l’app Appareil photo</p>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Safari ne fournit pas le décodeur QR intégré utilisé par cette page. Ouvrez l’appareil photo de l’iPhone, visez le QR vert de la borne puis touchez la bannière Chargeurs.ch : le lien ouvre directement la connexion à cette location.</p>
              <div className="mt-4 rounded-xl border border-white/10 bg-black/10 p-3 text-xs leading-relaxed text-muted-foreground">Si vous avez déjà copié le lien du QR, collez-le ci-dessous. Ce fallback reste entièrement lié au jeton de cette borne.</div>
              <div className="mt-4 space-y-2">
                <Input value={manualLink} onChange={(event) => setManualLink(event.target.value)} placeholder="https://…/compte/connect/…" autoCapitalize="off" autoCorrect="off" />
                <div className="grid gap-2 sm:grid-cols-2">
                  <Button type="button" variant="outline" onClick={() => void pasteLink()} className="gap-2"><ClipboardPaste className="h-4 w-4" />Coller le lien</Button>
                  <Button type="button" onClick={() => openPairingValue(manualLink)} disabled={!manualLink.trim()} className="bg-gradient-success font-bold text-success-foreground">Continuer</Button>
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="mt-5 flex items-start gap-3 rounded-2xl border border-warning/25 bg-warning/10 p-4 text-left">
              <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
              <div>
                <p className="font-semibold">{error === "INVALID_PAIRING_LINK" ? "Lien de connexion non reconnu" : error === "CLIPBOARD_UNAVAILABLE" ? "Presse-papiers non disponible" : "Caméra indisponible"}</p>
                <p className="text-sm text-muted-foreground">{error === "INVALID_PAIRING_LINK" ? "Utilisez uniquement le lien du QR vert affiché par la borne." : error === "CLIPBOARD_UNAVAILABLE" ? "Collez le lien manuellement dans le champ ci-dessus." : "Autorisez la caméra puis réessayez."}</p>
              </div>
            </div>
          )}

          {!unsupported && (!active ? (
            <Button onClick={() => void start()} disabled={starting} className="mt-6 w-full rounded-full bg-gradient-success py-6 text-lg font-bold text-success-foreground">
              {starting ? <Loader2 className="h-5 w-5 animate-spin" /> : <><Camera className="mr-2 h-5 w-5" />Ouvrir le scanner</>}
            </Button>
          ) : (
            <Button onClick={stop} variant="outline" className="mt-6 w-full rounded-full py-6">Fermer la caméra</Button>
          ))}
        </section>
      </div>
    </div>
  );
}
