import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { LiquidBackground } from "@/components/LiquidBackground";
import { BrandLogo } from "@/components/BrandLogo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

export default function ResetPassword() {
  const nav = useNavigate();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);

  // A recovery link establishes a temporary session via the URL hash.
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") setReady(true);
    });
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) { toast.error("Les mots de passe ne correspondent pas."); return; }
    if (password.length < 6) { toast.error("Minimum 6 caractères."); return; }
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      toast.success("Mot de passe mis à jour.");
      nav("/admin");
    } catch (err) {
      toast.error((err as Error).message ?? "Erreur");
    } finally { setLoading(false); }
  };

  return (
    <div className="relative grid min-h-screen place-items-center px-5">
      <LiquidBackground />
      <form onSubmit={submit} className="glass-strong liquid-border w-full max-w-md rounded-3xl p-8">
        <div className="mb-8 flex justify-center"><BrandLogo /></div>
        <h1 className="mb-1 text-center font-display text-2xl font-bold">Nouveau mot de passe</h1>
        <p className="mb-6 text-center text-sm text-muted-foreground">
          {ready ? "Choisissez un nouveau mot de passe sécurisé." : "Validez le lien reçu par email pour continuer."}
        </p>
        <div className="space-y-3">
          <Input type="password" placeholder="Nouveau mot de passe" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} disabled={!ready} />
          <Input type="password" placeholder="Confirmer le mot de passe" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={6} disabled={!ready} />
        </div>
        <Button type="submit" disabled={loading || !ready} className="mt-6 w-full rounded-full bg-gradient-primary py-6 text-lg font-bold shadow-glow">
          {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : "Mettre à jour"}
        </Button>
        <button type="button" onClick={() => nav("/admin/login")} className="mt-4 w-full text-center text-sm text-muted-foreground hover:text-foreground">
          Retour à la connexion
        </button>
      </form>
    </div>
  );
}
