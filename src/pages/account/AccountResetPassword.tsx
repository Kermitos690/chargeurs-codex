import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { passwordRecoveryAuth } from "@/integrations/supabase/client";
import { LiquidBackground } from "@/components/LiquidBackground";
import { BrandLogo } from "@/components/BrandLogo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { recoveryLinkErrorMessage } from "@/lib/passwordRecovery";

type RecoveryStatus = "checking" | "ready" | "invalid";

export default function AccountResetPassword() {
  const nav = useNavigate();
  const [status, setStatus] = useState<RecoveryStatus>("checking");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;

    const markReady = () => {
      if (!active) return;
      setErrorMessage(null);
      setStatus("ready");
    };

    const markInvalid = (message?: string) => {
      if (!active) return;
      setErrorMessage(recoveryLinkErrorMessage(message));
      setStatus("invalid");
    };

    const clearAuthParameters = () => {
      const cleanUrl = new URL(window.location.href);
      ["code", "error", "error_code", "error_description"].forEach((key) => {
        cleanUrl.searchParams.delete(key);
      });
      cleanUrl.hash = "";
      window.history.replaceState({}, document.title, `${cleanUrl.pathname}${cleanUrl.search}`);
    };

    const { data: subscription } = passwordRecoveryAuth.auth.onAuthStateChange((event, session) => {
      if (
        session &&
        (event === "INITIAL_SESSION" ||
          event === "PASSWORD_RECOVERY" ||
          event === "SIGNED_IN" ||
          event === "TOKEN_REFRESHED")
      ) {
        markReady();
      }
    });

    const establishRecoverySession = async () => {
      const url = new URL(window.location.href);
      const hashParameters = new URLSearchParams(url.hash.replace(/^#/, ""));
      const authError =
        url.searchParams.get("error_description") ||
        hashParameters.get("error_description") ||
        url.searchParams.get("error") ||
        hashParameters.get("error");

      if (authError) {
        markInvalid(authError);
        return;
      }

      const code = url.searchParams.get("code");
      if (code) {
        const { data, error } = await passwordRecoveryAuth.auth.exchangeCodeForSession(code);
        if (!active) return;
        if (error || !data.session) {
          markInvalid(error?.message);
          return;
        }
        clearAuthParameters();
        markReady();
        return;
      }

      const accessToken = hashParameters.get("access_token");
      const refreshToken = hashParameters.get("refresh_token");
      if (accessToken && refreshToken) {
        const { data, error } = await passwordRecoveryAuth.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (!active) return;
        if (error || !data.session) {
          markInvalid(error?.message);
          return;
        }
        clearAuthParameters();
        markReady();
        return;
      }

      const { data, error } = await passwordRecoveryAuth.auth.getSession();
      if (!active) return;
      if (error) {
        markInvalid(error.message);
        return;
      }
      if (data.session) {
        markReady();
        return;
      }

      markInvalid();
    };

    void establishRecoverySession();

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      toast.error("Les mots de passe ne correspondent pas.");
      return;
    }
    if (password.length < 6) {
      toast.error("Minimum 6 caractères.");
      return;
    }
    setLoading(true);
    try {
      const { error } = await passwordRecoveryAuth.auth.updateUser({ password });
      if (error) throw error;
      await passwordRecoveryAuth.auth.signOut({ scope: "local" });
      toast.success("Mot de passe mis à jour.");
      nav("/compte/login");
    } catch (err) {
      toast.error((err as Error).message ?? "Erreur");
    } finally {
      setLoading(false);
    }
  };

  const ready = status === "ready";
  const subtitle =
    status === "checking"
      ? "Validation sécurisée du lien en cours…"
      : ready
        ? "Choisissez un nouveau mot de passe sécurisé."
        : "Le lien ne permet pas d’ouvrir une session de récupération valide.";

  return (
    <div className="relative grid min-h-screen place-items-center px-5">
      <LiquidBackground />
      <form onSubmit={submit} className="glass-strong liquid-border w-full max-w-md rounded-3xl p-8">
        <div className="mb-8 flex justify-center"><BrandLogo /></div>
        <h1 className="mb-1 text-center font-display text-2xl font-bold">Nouveau mot de passe</h1>
        <p className="mb-6 text-center text-sm text-muted-foreground">{subtitle}</p>

        {status === "checking" && (
          <div className="mb-5 flex justify-center" aria-label="Validation du lien">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        )}

        {status === "invalid" && (
          <p className="mb-5 rounded-2xl border border-destructive/30 bg-destructive/10 p-3 text-center text-sm text-destructive">
            {errorMessage}
          </p>
        )}

        <div className="space-y-3">
          <Input type="password" placeholder="Nouveau mot de passe" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} disabled={!ready} />
          <Input type="password" placeholder="Confirmer le mot de passe" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={6} disabled={!ready} />
        </div>
        <Button type="submit" disabled={loading || !ready} className="mt-6 w-full rounded-full bg-gradient-primary py-6 text-lg font-bold shadow-glow">
          {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : "Mettre à jour"}
        </Button>

        {status === "invalid" && (
          <Button type="button" variant="outline" onClick={() => nav("/compte/login?mode=forgot")} className="mt-3 w-full rounded-full">
            Recevoir un nouveau lien
          </Button>
        )}

        <button type="button" onClick={() => nav("/compte/login")} className="mt-4 w-full text-center text-sm text-muted-foreground hover:text-foreground">
          Retour à la connexion
        </button>
      </form>
    </div>
  );
}
