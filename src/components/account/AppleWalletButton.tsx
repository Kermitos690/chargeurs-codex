import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Loader2, Smartphone } from "lucide-react";
import { toast } from "sonner";

function isAppleWalletDevice() {
  const ua = navigator.userAgent;
  return /iPhone|iPod/i.test(ua) && /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS/i.test(ua);
}

export function AppleWalletButton() {
  const [loading, setLoading] = useState(false);
  const compatible = typeof navigator !== "undefined" && isAppleWalletDevice();

  const download = async () => {
    setLoading(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Connectez-vous pour ajouter votre carte.");
      const endpoint = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/apple-wallet-pass`;
      const response = await fetch(endpoint, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        if (response.status === 503) throw new Error("Apple Wallet sera disponible dès que le certificat Chargeurs.ch sera configuré.");
        throw new Error(body.error ?? "Impossible de générer la carte Wallet.");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "Chargeurs-ch.pkpass";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Impossible de générer la carte Wallet.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="glass-strong liquid-border rounded-3xl p-5">
      <div className="flex items-start gap-3">
        <Smartphone className="mt-1 h-6 w-6 text-primary" />
        <div className="flex-1">
          <h2 className="font-display text-lg font-bold">Carte membre Apple Wallet</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Votre statut, vos locations et votre crédit réel lorsqu'il existe dans votre compte.
          </p>
          <Button onClick={download} disabled={loading} className="mt-4 rounded-xl bg-black text-white hover:bg-black/90">
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <span className="mr-2 text-lg"></span>}
            Ajouter à Apple Wallet
          </Button>
          {!compatible && (
            <p className="mt-2 text-xs text-muted-foreground">
              Le fichier peut être préparé ici, mais l'ajout direct fonctionne sur iPhone avec Safari. Sur Android, utilisez votre compte Chargeurs.ch.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
