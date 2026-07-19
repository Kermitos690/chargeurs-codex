import { useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { BrandLogo } from "@/components/BrandLogo";
import { LiquidBackground } from "@/components/LiquidBackground";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { LogOut, Loader2, Menu } from "lucide-react";
import { cn } from "@/lib/utils";
import { ADMIN_NAV, canAccessAdminPath } from "./adminNav";

function NavGroups({ roles, onNavigate }: { roles: string[]; onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-5">
      {ADMIN_NAV.map((group) => ({
        ...group,
        items: group.items.filter((item) => !item.roles || roles.some((role) => item.roles?.includes(role))),
      })).filter((group) => group.items.length > 0).map((group) => (
        <div key={group.label} className="flex flex-col gap-1">
          <p className="px-4 pb-1 text-[0.68rem] font-semibold uppercase tracking-wider text-muted-foreground/70">
            {group.label}
          </p>
          {group.items.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              onClick={onNavigate}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 rounded-xl px-4 py-2.5 text-sm font-medium transition-all",
                  isActive
                    ? "bg-gradient-primary text-primary-foreground shadow-glow"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )
              }
            >
              <n.icon className="h-5 w-5 shrink-0" />
              <span>{n.label}</span>
            </NavLink>
          ))}
        </div>
      ))}
    </nav>
  );
}

export default function AdminLayout() {
  const { user, roles, isAdmin, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate("/admin/login");
  };

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
        <LiquidBackground />
      </div>
    );
  }
  if (!user) {
    navigate("/admin/login", { replace: true });
    return null;
  }
  if (!isAdmin) {
    return (
      <div className="relative grid min-h-screen place-items-center px-5 text-center">
        <LiquidBackground />
        <div className="glass-strong rounded-3xl p-10">
          <p className="mb-4 text-lg">Votre compte n'a pas les droits administrateur.</p>
          <Button onClick={signOut} variant="ghost">Se déconnecter</Button>
        </div>
      </div>
    );
  }
  if (!canAccessAdminPath(location.pathname, roles)) {
    return (
      <div className="relative grid min-h-screen place-items-center px-5 text-center">
        <LiquidBackground />
        <div className="glass-strong rounded-3xl p-10">
          <p className="mb-4 text-lg">Votre rôle ne permet pas d'accéder à cette section.</p>
          <Button onClick={() => navigate("/admin", { replace: true })} variant="outline">Retour au tableau de bord</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen">
      <LiquidBackground />
      <div className="flex min-h-screen">
        {/* Desktop sidebar */}
        <aside className="glass-strong sticky top-0 hidden h-screen w-64 flex-col p-5 lg:flex">
          <div className="mb-6"><BrandLogo size="sm" /></div>
          <ScrollArea className="-mx-2 flex-1 px-2">
            <NavGroups roles={roles} />
          </ScrollArea>
          <Button onClick={signOut} variant="ghost" className="mt-4 justify-start gap-2">
            <LogOut className="h-4 w-4" />Déconnexion
          </Button>
        </aside>

        {/* Mobile top bar with hamburger sheet */}
        <header className="glass-strong fixed inset-x-0 top-0 z-30 flex items-center justify-between px-4 py-3 lg:hidden">
          <BrandLogo size="sm" />
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Ouvrir le menu" className="border border-border">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="glass-strong w-[85vw] max-w-sm border-border p-0">
              <div className="flex h-full flex-col p-5">
                <div className="mb-6"><BrandLogo size="sm" /></div>
                <ScrollArea className="-mx-2 flex-1 px-2">
                  <NavGroups roles={roles} onNavigate={() => setOpen(false)} />
                </ScrollArea>
                <Button onClick={signOut} variant="ghost" className="mt-4 justify-start gap-2">
                  <LogOut className="h-4 w-4" />Déconnexion
                </Button>
              </div>
            </SheetContent>
          </Sheet>
        </header>

        <main className="flex-1 overflow-x-hidden p-5 pt-20 sm:p-8 lg:pt-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
