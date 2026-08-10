import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Camera, ChevronLeft, Loader2, QrCode, TriangleAlert } from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";
import { LiquidBackground } from "@/components/LiquidBackground";
import { Button } from "@/components/ui/button";

type DetectorResult = { rawValue?: string };
type Detector = { detect(source: CanvasImageSource): Promise<DetectorResult[]> };
type DetectorCtor = new (options?: { formats?: string[] }) => Detector;

function pairingPathFromValue(rawValue: string): string | null {
  try {
    const url = new URL(rawValue, window.location.origin);
    const match = url.pathname.match(/^\/compte\/connect\/([A-Za-z0-9_-]{40,80})$/);
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

  const stop = () => {
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setActive(false);
  };

  useEffect(() => stop, []);

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
            const path = result.rawValue ? pairingPathFromValue(result.rawValue) : null;
            if (!path) continue;
            stop();
            navigate(path);
            return;
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

          <div className="relative mt-6 aspect-square overflow-hidden rounded-3xl border border-success/25 bg-black/60">
            <video ref={videoRef} muted playsInline className={`h-full w-full object-cover ${active ? "opacity-100" : "opacity-20"}`} />
            {!active && (
              <div className="absolute inset-0 grid place-items-center p-8">
                <Camera className="h-16 w-16 text-white/60" />
              </div>
            )}
            {active && <div className="pointer-events-none absolute inset-[12%] rounded-3xl border-2 border-success shadow-glow-success" />}
          </div>

          {unsupported && (
            <div className="mt-5 rounded-2xl border border-warning/25 bg-warning/10 p-4 text-left">
              <p className="font-semibold text-warning">Scanner intégré non disponible sur ce navigateur</p>
              <p className="mt-1 text-sm text-muted-foreground">Utilisez l’appareil photo du téléphone pour scanner le QR vert. Le lien ouvrira directement votre compte Chargeurs et conservera la liaison à la borne.</p>
            </div>
          )}

          {error && (
            <div className="mt-5 flex items-start gap-3 rounded-2xl border border-warning/25 bg-warning/10 p-4 text-left">
              <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
              <div><p className="font-semibold">Caméra indisponible</p><p className="text-sm text-muted-foreground">Autorisez la caméra puis réessayez.</p></div>
            </div>
          )}

          {!active ? (
            <Button onClick={() => void start()} disabled={starting} className="mt-6 w-full rounded-full bg-gradient-success py-6 text-lg font-bold text-success-foreground">
              {starting ? <Loader2 className="h-5 w-5 animate-spin" /> : <><Camera className="mr-2 h-5 w-5" />Ouvrir le scanner</>}
            </Button>
          ) : (
            <Button onClick={stop} variant="outline" className="mt-6 w-full rounded-full py-6">Fermer la caméra</Button>
          )}
        </section>
      </div>
    </div>
  );
}
