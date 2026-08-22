import { useEffect } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useCustomer } from "@/hooks/useCustomer";
import { LiquidBackground } from "@/components/LiquidBackground";
import { BrandLogo } from "@/components/BrandLogo";
import { Button } from "@/components/ui/button";
import { Loader2, LogOut } from "lucide-react";
import { ACCOUNT_NAV_ITEMS } from "./accountNavigation";

const MEMBERSHIP_INTENT_KEY = "chargeurs:membership-intent";

function AccountNavigation({ mobile = false }: { mobile?: boolean }) {
  return (
    <nav
      aria-label="Navigation du compte"
      className={mobile
        ? "fixed inset-x-3 bottom-3 z-30 grid grid-cols-6 rounded-2xl border border-border bg-background/95 p-1.5 shadow-2xl backdrop-blur-xl md:hidden"
        : "glass mx-auto hidden w-full max-w-5xl items-center gap-1 rounded-2xl p-1.5 md:flex"}
      style={mobile ? { paddingBottom: "max(0.375rem, env(safe-area-inset-bottom))" } : undefined}
    >
      {ACCOUNT_NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) => `${mobile
            ? "flex min-w-0 flex-col items-center gap-1 rounded-xl px-0.5 py-2 text-[9px] font-semibold"
            : "flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold"} ${isActive
            ? "bg-gradient-primary text-primary-foreground shadow-glow"
            : "text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"}`}
        >
          <Icon className={mobile ? "h-5 w-5" : "h-4 w-4"} aria-hidden="true" />
          <span className="truncate">{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

export default function AccountLayout() {
  const { user, loading } = useCustomer();
  const nav = useNavigate();

  useEffect(() => {
    if (!loading && !user) {
      try {
        if (window.location.pathname === "/compte/pass") {
          sessionStorage.setItem(MEMBERSHIP_INTENT_KEY, "1");
        }
      } catch { /* navigation still works without sessionStorage */ }
      nav("/compte/login", { replace: true });
    }
  }, [loading, user, nav]);

  useEffect(() => {
    if (loading || !user || window.location.pathname !== "/compte") return;
    try {
      if (sessionStorage.getItem(MEMBERSHIP_INTENT_KEY) !== "1") return;
      sessionStorage.removeItem(MEMBERSHIP_INTENT_KEY);
      nav("/compte/pass", { replace: true });
    } catch { /* ordinary account landing remains available */ }
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
      <header className="sticky top-0 z-20 border-b border-border/60 bg-background/75 px-4 py-3 backdrop-blur-xl sm:px-6">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3">
          <BrandLogo size="sm" />
          <div className="flex items-center gap-2 sm:gap-3">
            <span className="hidden text-sm text-muted-foreground sm:inline">{user.email}</span>
            <Button variant="outline" size="sm" onClick={logout} className="rounded-full" aria-label="Se déconnecter">
              <LogOut className="h-4 w-4 sm:mr-1.5" /> <span className="hidden sm:inline">Déconnexion</span>
            </Button>
          </div>
        </div>
      </header>
      <div className="px-4 pt-4 sm:px-6"><AccountNavigation /></div>
      <main className="mx-auto w-full max-w-5xl px-4 pb-28 sm:px-6 md:pb-16">
        <Outlet />
      </main>
      <AccountNavigation mobile />
    </div>
  );
}
