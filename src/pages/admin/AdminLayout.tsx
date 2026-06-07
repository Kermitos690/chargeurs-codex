import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { BrandLogo } from "@/components/BrandLogo";
import { LiquidBackground } from "@/components/LiquidBackground";
import { Button } from "@/components/ui/button";
import {
  LayoutDashboard, Server, CreditCard, BatteryCharging, Radio, Settings, Wrench, Activity, LogOut, Loader2, ListChecks,
  ShoppingCart, Tag, Store, HeartPulse,
} from "lucide-react";
import { cn } from "@/lib/utils";

const nav = [
  { to: "/admin", icon: LayoutDashboard, label: "Vue d'ensemble", end: true },
  { to: "/admin/stations", icon: Server, label: "Bornes" },
  { to: "/admin/orders", icon: ShoppingCart, label: "Locations / Commandes" },
  { to: "/admin/rental-flow-health", icon: HeartPulse, label: "Santé parcours" },
  { to: "/admin/pricing", icon: Tag, label: "Tarifs" },
  { to: "/admin/shops", icon: Store, label: "Boutiques" },
  { to: "/admin/payments", icon: CreditCard, label: "Paiements" },
  { to: "/admin/rentals", icon: BatteryCharging, label: "Locations (legacy)" },
  { to: "/admin/events", icon: Radio, label: "Événements" },
  { to: "/admin/maintenance", icon: Wrench, label: "Maintenance" },
  { to: "/admin/api-health", icon: Activity, label: "Santé API" },
  { to: "/admin/api-coverage", icon: ListChecks, label: "Couverture API" },
  { to: "/admin/settings", icon: Settings, label: "Réglages" },
];

export default function AdminLayout() {
  const { user, isAdmin, loading } = useAuth();
  const navigate = useNavigate();

  if (loading) {
    return <div className="grid min-h-screen place-items-center"><Loader2 className="h-10 w-10 animate-spin text-primary" /><LiquidBackground /></div>;
  }
  if (!user) { navigate("/admin/login", { replace: true }); return null; }
  if (!isAdmin) {
    return (
      <div className="relative grid min-h-screen place-items-center px-5 text-center">
        <LiquidBackground />
        <div className="glass-strong rounded-3xl p-10">
          <p className="mb-4 text-lg">Votre compte n'a pas les droits administrateur.</p>
          <Button onClick={async () => { await supabase.auth.signOut(); navigate("/admin/login"); }} variant="ghost">Se déconnecter</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen">
      <LiquidBackground />
      <div className="flex min-h-screen">
        <aside className="glass-strong sticky top-0 hidden h-screen w-64 flex-col p-5 lg:flex">
          <div className="mb-8"><BrandLogo size="sm" /></div>
          <nav className="flex flex-1 flex-col gap-1">
            {nav.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end}
                className={({ isActive }) => cn(
                  "flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-all",
                  isActive ? "bg-gradient-primary text-primary-foreground shadow-glow" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}>
                <n.icon className="h-5 w-5" />{n.label}
              </NavLink>
            ))}
          </nav>
          <Button onClick={async () => { await supabase.auth.signOut(); navigate("/admin/login"); }} variant="ghost" className="mt-4 gap-2 justify-start">
            <LogOut className="h-4 w-4" />Déconnexion
          </Button>
        </aside>

        {/* Mobile top nav */}
        <div className="glass-strong fixed inset-x-0 top-0 z-20 flex gap-1 overflow-x-auto p-2 lg:hidden">
          {nav.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end}
              className={({ isActive }) => cn("flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-xs",
                isActive ? "bg-gradient-primary text-primary-foreground" : "text-muted-foreground")}>
              <n.icon className="h-4 w-4" />{n.label}
            </NavLink>
          ))}
        </div>

        <main className="flex-1 overflow-x-hidden p-5 pt-20 sm:p-8 lg:pt-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
