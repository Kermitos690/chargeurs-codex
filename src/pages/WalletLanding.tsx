import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { LiquidBackground } from "@/components/LiquidBackground";
import { BrandLogo } from "@/components/BrandLogo";
import { Button } from "@/components/ui/button";
import { Loader2, ShieldCheck } from "lucide-react";

export default function WalletLanding() {
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const [state, setState] = useState<"loading" | "neutral">("loading");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/wallet-link`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(sessionData.session?.access_token ? { Authorization: `Bearer ${sessionData.session.access_token}` } : {}),
        },
        body: JSON.stringify({ token }),
      });
      const result = await response.json().catch(() => ({ state: "neutral" }));
      if (cancelled) return;
      if (result.state === "owner") {
        navigate(result.destination ?? "/compte", { replace: true });
      } else if (result.state === "authentication_required") {
        navigate(`/compte/login?next=${encodeURIComponent(`/wallet/${token}`)}`, { replace: true });
      } else {
        setState("neutral");
      }
    })();
    return () => { cancelled = true; };
  }, [navigate, token]);

  return (
    <div className="relative grid min-h-screen place-items-center px-5">
      <LiquidBackground />
      <div className="glass-strong liquid-border w-full max-w-md rounded-3xl p-8 text-center">
        <div className="mb-6 flex justify-center"><BrandLogo /></div>
        {state === "loading" ? (
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
        ) : (
          <>
            <ShieldCheck className="mx-auto h-10 w-10 text-primary" />
            <h1 className="mt-4 font-display text-2xl font-bold">Carte membre Chargeurs.ch</h1>
            <p className="mt-3 text-sm text-muted-foreground">
              Cette carte appartient à un autre compte ou n'est plus active. Aucune donnée personnelle n'est affichée.
            </p>
            <Button className="mt-6 w-full rounded-full" onClick={() => navigate("/compte/login")}>Se connecter à mon compte</Button>
            <Button variant="outline" className="mt-3 w-full rounded-full" onClick={() => navigate("/compte/login?mode=signup")}>Créer un compte</Button>
          </>
        )}
      </div>
    </div>
  );
}
