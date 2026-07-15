import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { LiquidBackground } from "@/components/LiquidBackground";
import { BrandLogo } from "@/components/BrandLogo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

type Mode = "login" | "signup" | "forgot";

function safeNext(raw: string | null): string {
  return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/compte";
}

export default function AccountAuth() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const next = useMemo(() => safeNext(params.get("next")), [params]);
  const [mode, setMode] = useState<Mode>(params.get("mode") === "signup" ? "signup" : "login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const signInWithGoogle = async () => {
    setGoogleLoading(true);
    const redirectTo = `${window.location.origin}${next}`;
    const { error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo } });
    if (error) {
      toast.error("Connexion Google indisponible. Réessayez.");
      setGoogleLoading(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "forgot") {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/compte/reset-password` });
        if (error) throw error;
        toast.success("Email de réinitialisation envoyé (si le compte existe).");
        setMode("login");
        return;
      }
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: `${window.location.origin}${next}` } });
        if (error) throw error;
        toast.success("Compte créé. Vérifiez votre email si une confirmation est requise.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      nav(next);
    } catch (err) {
      toast.error((err as Error).message ?? "Erreur");
    } finally { setLoading(false); }
  };

  const title = mode === "forgot" ? "Mot de passe oublié" : mode === "signup" ? "Créer un compte" : "Mon compte";
  const subtitle = mode === "login" ? "Retrouvez vos locations et votre carte membre."
    : mode === "signup" ? "Créez votre espace Chargeurs.ch et votre identité membre."
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
          {mode !== "forgot" && <Input type="password" placeholder="Mot de passe" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />}
        </div>
        <Button type="submit" disabled={loading} className="mt-6 w-full rounded-full bg-gradient-primary py-6 text-lg font-bold shadow-glow">
          {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : mode === "login" ? "Se connecter" : mode === "signup" ? "Créer le compte" : "Envoyer le lien"}
        </Button>
        {mode !== "forgot" && <><div className="my-5 flex items-center gap-3 text-xs text-muted-foreground"><span className="h-px flex-1 bg-border" />ou<span className="h-px flex-1 bg-border" /></div><Button type="button" variant="outline" onClick={signInWithGoogle} disabled={googleLoading} className="w-full gap-2 rounded-full py-6 text-base font-semibold">{googleLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : "Continuer avec Google"}</Button></>}
        {mode === "login" && <button type="button" onClick={() => setMode("forgot")} className="mt-4 w-full text-center text-sm text-muted-foreground hover:text-foreground">Mot de passe oublié ?</button>}
        <button type="button" onClick={() => setMode(mode === "signup" ? "login" : "signup")} className="mt-2 w-full text-center text-sm text-muted-foreground hover:text-foreground">{mode === "signup" ? "J'ai déjà un compte" : "Créer un compte"}</button>
      </form>
    </div>
  );
}
