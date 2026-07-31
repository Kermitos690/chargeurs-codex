import { useEffect } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useCustomer } from "@/hooks/useCustomer";
import { LiquidBackground } from "@/components/LiquidBackground";
import { BrandLogo } from "@/components/BrandLogo";
import { Button } from "@/components/ui/button";
import { Loader2, LogOut, LayoutDashboard } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

export default function AccountLayout() {
  const { user, loading } = useCustomer();
  const { isAdmin, loading: rolesLoading } = useAuth();
  const nav = useNavigate();

  useEffect(() => {
    if (!loading && !user) nav("/compte/login", { replace: true });
  }, [loading, user, nav]);

  if (loading || !user) {
    return (
      <div className="relative grid min-h-screen place-items-center">
        <LiquidBackground />
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const logout = async () => {
    await supabase.auth.signOut();
    nav("/compte/login", { replace: true });
  };

  return (
    <div className="relative min-h-screen">
      <LiquidBackground />
      <header className="sticky top-0 z-10 flex items-center justify-between gap-4 px-5 py-4 backdrop-blur-xl">
        <BrandLogo size="sm" />
        <div className="flex items-center gap-3">
          <span className="hidden text-sm text-muted-foreground sm:inline">{user.email}</span>
          {!rolesLoading && isAdmin && (
            <Button variant="outline" size="sm" onClick={() => nav("/admin")} className="rounded-full">
              <LayoutDashboard className="mr-1.5 h-4 w-4" /> Back-office
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={logout} className="rounded-full">
            <LogOut className="mr-1.5 h-4 w-4" /> Déconnexion
          </Button>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl px-5 pb-16">
        <Outlet />
      </main>
    </div>
  );
}
