import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { getLockedStation } from "@/lib/kioskLock";
import { LiquidBackground } from "@/components/LiquidBackground";
import { BrandLogo } from "@/components/BrandLogo";

// PWA start_url target (/kiosk). Resolves the cabinet this tablet was installed
// for from the local lock, then re-opens that exact cabinet. This is what makes
// the installed app always return to its borne after reboot / update / restart.
export default function KioskHome() {
  const [locked, setLocked] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    setLocked(getLockedStation());
  }, []);

  if (locked === undefined) {
    return (
      <div className="relative grid min-h-screen place-items-center">
        <LiquidBackground />
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  if (locked) return <Navigate to={`/kiosk/${locked}`} replace />;

  return (
    <div className="relative grid min-h-screen place-items-center px-6 text-center">
      <LiquidBackground />
      <div className="flex flex-col items-center gap-5">
        <BrandLogo size="lg" />
        <h1 className="font-display text-3xl font-bold">Borne non configurée</h1>
        <p className="max-w-md text-muted-foreground">
          Cette tablette n'est liée à aucune borne. Ouvrez l'URL de la borne (par exemple
          <span className="font-mono"> /kiosk/DTA21269</span>) dans Chrome, puis installez l'application.
        </p>
      </div>
    </div>
  );
}
