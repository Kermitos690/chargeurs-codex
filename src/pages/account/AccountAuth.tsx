import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { LiquidBackground } from "@/components/LiquidBackground";
import { BrandLogo } from "@/components/BrandLogo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

type Mode = "login" | "signup" | "forgot";

export default function AccountAuth() {
  const nav = useNavigate();
  const [mode, setMode] = useState<Mode>(() => {
    const requestedMode = new URLSearchParams(window.location.search).get("mode");
    return requestedMode === "forgot" || requestedMode === "signup" ? requestedMode : "login";
  });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const signInWithGoogle = async () => {
    setGoogleLoading(true);
    try {
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: `${window.location.origin}/compte`,
      });
      if (result.error) {
        toast.error("Connexion Google indisponible. Réessayez.");
        setGoogleLoading(false);
        return;
      }
      if (result.redirected) return;
      nav("/compte");
    } catch {
      toast.error("Connexion Google indisponible. Réessayez.");
      setGoogleLoading(false);
    }
  };


  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "forgot") {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/compte/reset-password`,
        });
        if (error) throw error;
        toast.success("Email de réinitialisation envoyé (si le compte existe).");
        setMode("login");
        return;
      }
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email, password, options: { emailRedirectTo: `${window.location.origin}/compte` },
        });
        if (error) throw error;
        toast.success("Compte créé. Vérifiez votre email si une confirmation est requise.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      nav("/compte");
    } catch (err) {
      toast.error((err as Error).message ?? "Erreur");
    } finally { setLoading(false); }
  };

  const title = mode === "forgot" ? "Mot de passe oublié" : mode === "signup" ? "Créer un compte" : "Mon compte";
  const subtitle =
    mode === "login" ? "Retrouvez vos locations et vos reçus."
    : mode === "signup" ? "Suivez vos locations de batteries en un coup d'œil."
    : "Recevez un lien pour réinitialiser votre mot de passe.";

  return (
    <div className="relative grid min-h-screen place-items-center px-5">
      <LiquidBackground />
      <form onSubmit={submit} className="glass-strong liquid-border w-full max-w-md rounded-3xl p-8">
        <div className="mb-8 flex justify-center"><BrandLogo /></div>
        <h1 className="mb-1 text-center font-display text-2xl font-bold">{title}</h1>
        <p className="mb-6 text-center text-sm text-muted-foreground">{subtitle}</p>
        <div className="space-y-3">
          <Input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          {mode !== "forgot" && (
            <Input type="password" placeholder="Mot de passe" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
          )}
        </div>
        <Button type="submit" disabled={loading} className="mt-6 w-full rounded-full bg-gradient-primary py-6 text-lg font-bold shadow-glow">
          {loading ? <Loader2 className="h-5 w-5 animate-spin" />
            : mode === "login" ? "Se connecter"
            : mode === "signup" ? "Créer le compte"
            : "Envoyer le lien"}
        </Button>

        {mode !== "forgot" && (
          <>
            <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
              <span className="h-px flex-1 bg-border" />ou<span className="h-px flex-1 bg-border" />
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={signInWithGoogle}
              disabled={googleLoading}
              className="w-full gap-2 rounded-full py-6 text-base font-semibold"
            >
              {googleLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : (
                <svg className="h-5 w-5" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"/><path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"/></svg>
              )}
              Continuer avec Google
            </Button>
          </>
        )}

        {mode === "login" && (
          <button type="button" onClick={() => setMode("forgot")} className="mt-4 w-full text-center text-sm text-muted-foreground hover:text-foreground">
            Mot de passe oublié ?
          </button>
        )}
        <button
          type="button"
          onClick={() => setMode(mode === "signup" ? "login" : "signup")}
          className="mt-2 w-full text-center text-sm text-muted-foreground hover:text-foreground"
        >
          {mode === "signup" ? "J'ai déjà un compte" : "Créer un compte"}
        </button>
      </form>
    </div>
  );
}
