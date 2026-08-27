import { useEffect, useState } from "react";
import { passwordRecoveryAuth, supabase } from "@/integrations/supabase/client";
import { LiquidBackground } from "@/components/LiquidBackground";
import { BrandLogo } from "@/components/BrandLogo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

type Mode = "login" | "forgot";

const AUTH_REQUEST_TIMEOUT_MS = 15_000;

async function withTimeout<T>(promise: PromiseLike<T>, ms = AUTH_REQUEST_TIMEOUT_MS): Promise<T> {
  let timer: number | undefined;
  try {
    return await Promise.race([
      Promise.resolve(promise),
      new Promise<T>((_, reject) => {
        timer = window.setTimeout(() => reject(new Error("AUTH_REQUEST_TIMEOUT")), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) window.clearTimeout(timer);
  }
}

function loginErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (message === "AUTH_REQUEST_TIMEOUT") return "Le serveur de connexion ne répond pas. Réessayez dans quelques secondes.";
  if (/load failed|failed to fetch|network/i.test(message)) return "Impossible de joindre le serveur de connexion. Vérifiez le réseau puis réessayez.";
  if (/invalid login credentials/i.test(message)) return "Email ou mot de passe incorrect.";
  if (/AUTH_SESSION_MISSING/i.test(message)) return "La connexion a été acceptée mais la session n'a pas pu être créée. Rechargez la page puis réessayez.";
  return message || "Erreur de connexion";
}

export default function AdminAuth() {
  const [mode, setMode] = useState<Mode>(() =>
    new URLSearchParams(window.location.search).get("mode") === "forgot" ? "forgot" : "login",
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Recovery mode must remain visible and user-driven. Do not auto-redirect
    // because of a stale/reusable session while the user is trying to reset
    // their password.
    if (mode !== "login") return;

    let cancelled = false;
    void (async () => {
      try {
        const { data, error } = await withTimeout(supabase.auth.getUser(), 8_000);
        if (!cancelled && !error && data.user) window.location.replace("/admin/api-coverage");
      } catch {
        // No valid reusable session: keep the login form visible.
      }
    })();
    return () => { cancelled = true; };
  }, [mode]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    const normalizedEmail = email.trim().toLowerCase();

    try {
      if (mode === "forgot") {
        const { error } = await withTimeout(passwordRecoveryAuth.auth.resetPasswordForEmail(normalizedEmail, {
          redirectTo: `${window.location.origin}/admin/reset-password`,
        }));
        if (error) throw error;
        toast.success("Email de réinitialisation envoyé (si le compte existe).");
        return;
      }

      const { error } = await withTimeout(
        supabase.auth.signInWithPassword({ email: normalizedEmail, password }),
      );
      if (error) throw error;

      const { data: verified, error: verifyError } = await withTimeout(supabase.auth.getUser(), 8_000);
      if (verifyError) throw verifyError;
      if (!verified.user) throw new Error("AUTH_SESSION_MISSING");

      toast.success("Connecté");
      window.location.replace("/admin/api-coverage");
    } catch (error) {
      toast.error(loginErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  const title = mode === "forgot" ? "Mot de passe oublié" : "Admin";
  const subtitle = mode === "login"
    ? "Connectez-vous au tableau de bord"
    : "Recevez un lien pour réinitialiser votre mot de passe";

  return (
    <div className="relative grid min-h-screen place-items-center px-5">
      <LiquidBackground />
      <form onSubmit={submit} className="glass-strong liquid-border w-full max-w-md rounded-3xl p-8">
        <div className="mb-8 flex justify-center"><BrandLogo /></div>
        <h1 className="mb-1 text-center font-display text-2xl font-bold">{title}</h1>
        <p className="mb-6 text-center text-sm text-muted-foreground">{subtitle}</p>
        <div className="space-y-3">
          <Input
            type="email"
            name="email"
            autoComplete="username"
            inputMode="email"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="Email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
          {mode !== "forgot" && (
            <Input
              type="password"
              name="password"
              autoComplete="current-password"
              placeholder="Mot de passe"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              minLength={6}
            />
          )}
        </div>
        <Button type="submit" disabled={loading} className="mt-6 w-full rounded-full bg-gradient-primary py-6 text-lg font-bold shadow-glow">
          {loading ? <Loader2 className="h-5 w-5 animate-spin" />
            : mode === "login" ? "Se connecter"
            : "Envoyer le lien"}
        </Button>

        {mode === "login" && (
          <button type="button" onClick={() => setMode("forgot")} className="mt-4 w-full text-center text-sm text-muted-foreground hover:text-foreground">
            Mot de passe oublié ?
          </button>
        )}
        {mode === "forgot" && (
          <button type="button" onClick={() => setMode("login")} className="mt-2 w-full text-center text-sm text-muted-foreground hover:text-foreground">
            J'ai déjà un compte
          </button>
        )}
      </form>
    </div>
  );
}
