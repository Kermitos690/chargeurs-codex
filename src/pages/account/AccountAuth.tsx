import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { passwordRecoveryAuth, supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { LiquidBackground } from "@/components/LiquidBackground";
import { BrandLogo } from "@/components/BrandLogo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { canView } from "@/lib/roles";
import { CUSTOMER_PASSWORD_MIN_LENGTH, signupNeedsEmailConfirmation } from "@/lib/customerAccount";
import { Checkbox } from "@/components/ui/checkbox";

type Mode = "login" | "signup" | "forgot";

export default function AccountAuth() {
  const nav = useNavigate();
  const [mode, setMode] = useState<Mode>(() => {
    const requestedMode = new URLSearchParams(window.location.search).get("mode");
    return requestedMode === "forgot" || requestedMode === "signup" ? requestedMode : "login";
  });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [legalAccepted, setLegalAccepted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [confirmationEmail, setConfirmationEmail] = useState<string | null>(null);
  const googleAuthEnabled = import.meta.env.VITE_ENABLE_GOOGLE_AUTH === "true";

  /**
   * Customer and back-office authentication share Supabase Auth.  The
   * destination must nevertheless be based on the server-managed role, not on
   * the URL from which the person happened to sign in.
   */
  const navigateAfterPasswordSignIn = async (userId: string) => {
    const { data: roleRows, error: roleError } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);

    // A role lookup failure must not turn a normal customer login into an
    // access failure.  Backend/RLS remain the authority for /admin.
    if (!roleError && canView((roleRows ?? []).map((row) => row.role))) {
      nav("/admin", { replace: true });
      return;
    }
    nav("/compte", { replace: true });
  };

  const signInWithGoogle = async () => {
    try {
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: `${window.location.origin}/compte`,
      });
      if (result.error) {
        toast.error("Connexion Google indisponible. Réessayez.");
        return;
      }
      if (result.redirected) return;
      nav("/compte");
    } catch {
      toast.error("Connexion Google indisponible. Réessayez.");
    }
  };


  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "forgot") {
        const { error } = await passwordRecoveryAuth.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/compte/reset-password`,
        });
        if (error) throw error;
        toast.success("Email de réinitialisation envoyé (si le compte existe).");
        setMode("login");
        return;
      }
      if (mode === "signup") {
        if (!legalAccepted) throw new Error("Vous devez accepter les conditions et la politique de confidentialité.");
        const acceptedAt = new Date().toISOString();
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/compte`,
            data: {
              display_name: displayName.trim(),
              terms_accepted_at: acceptedAt,
              privacy_acknowledged_at: acceptedAt,
            },
          },
        });
        if (error) throw error;
        if (signupNeedsEmailConfirmation(data.session)) {
          setConfirmationEmail(email);
          return;
        }
        toast.success("Compte créé.");
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        if (!data.user) throw new Error("Connexion incomplète. Réessayez.");
        await navigateAfterPasswordSignIn(data.user.id);
        return;
      }
      nav("/compte", { replace: true });
    } catch (err) {
      toast.error((err as Error).message ?? "Erreur");
    } finally { setLoading(false); }
  };

  const title = mode === "forgot" ? "Mot de passe oublié" : mode === "signup" ? "Créer un compte" : "Mon compte";
  const subtitle =
    mode === "login" ? "Retrouvez vos locations et vos reçus."
    : mode === "signup" ? "Suivez vos locations de batteries en un coup d'œil."
    : "Recevez un lien pour réinitialiser votre mot de passe.";

  if (confirmationEmail) {
    return (
      <div className="relative grid min-h-screen place-items-center px-5">
        <LiquidBackground />
        <section className="glass-strong liquid-border w-full max-w-md rounded-3xl p-8 text-center">
          <div className="mb-8 flex justify-center"><BrandLogo /></div>
          <h1 className="font-display text-2xl font-bold">Vérifiez votre adresse email</h1>
          <p className="mt-3 text-sm text-muted-foreground">Si <strong className="text-foreground">{confirmationEmail}</strong> ne possède pas encore de compte, un lien de confirmation vient d’être envoyé. Si un compte existe déjà, connectez-vous ou utilisez «&nbsp;Mot de passe oublié&nbsp;» pour retrouver l’accès.</p>
          <Button type="button" onClick={() => nav("/compte/login", { replace: true })} className="mt-6 w-full rounded-full bg-gradient-primary py-6 text-lg font-bold">Revenir à la connexion</Button>
        </section>
      </div>
    );
  }

  return (
    <div className="relative grid min-h-screen place-items-center px-5">
      <LiquidBackground />
      <form onSubmit={submit} className="glass-strong liquid-border w-full max-w-md rounded-3xl p-8">
        <div className="mb-8 flex justify-center"><BrandLogo /></div>
        <h1 className="mb-1 text-center font-display text-2xl font-bold">{title}</h1>
        <p className="mb-6 text-center text-sm text-muted-foreground">{subtitle}</p>
        <div className="space-y-3">
          <Input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          {mode === "signup" && <Input placeholder="Nom (facultatif)" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={120} autoComplete="name" />}
          {mode !== "forgot" && (
            <Input type="password" placeholder={mode === "signup" ? `Mot de passe (${CUSTOMER_PASSWORD_MIN_LENGTH} caractères minimum)` : "Mot de passe"} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={mode === "signup" ? CUSTOMER_PASSWORD_MIN_LENGTH : 1} autoComplete={mode === "signup" ? "new-password" : "current-password"} />
          )}
        </div>
        {mode === "signup" && (
          <label className="mt-4 flex items-start gap-3 rounded-2xl border border-border p-4 text-sm">
            <Checkbox checked={legalAccepted} onCheckedChange={(checked) => setLegalAccepted(checked === true)} />
            <span>J’accepte les <a className="font-semibold text-primary underline" href="/legal/terms" target="_blank" rel="noreferrer">conditions d’utilisation</a> et reconnais avoir lu la <a className="font-semibold text-primary underline" href="/legal/privacy" target="_blank" rel="noreferrer">politique de confidentialité</a>.</span>
          </label>
        )}
        <Button type="submit" disabled={loading} className="mt-6 w-full rounded-full bg-gradient-primary py-6 text-lg font-bold shadow-glow">
          {loading ? <Loader2 className="h-5 w-5 animate-spin" />
            : mode === "login" ? "Se connecter"
            : mode === "signup" ? "Créer le compte"
            : "Envoyer le lien"}
        </Button>

        {mode !== "forgot" && googleAuthEnabled && (
          <>
            <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
              <span className="h-px flex-1 bg-border" />ou<span className="h-px flex-1 bg-border" />
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={signInWithGoogle}
              className="w-full gap-2 rounded-full py-6 text-base font-semibold"
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"/><path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"/></svg>
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
