import {
  LayoutDashboard, Server, BatteryCharging, ShoppingCart, CreditCard, Tag,
  Store, Wrench, Activity, ListChecks, ClipboardCheck, HeartPulse, Radio, Settings,
  Building2, Users, TabletSmartphone,
  type LucideIcon,
} from "lucide-react";

export type AdminNavItem = { to: string; icon: LucideIcon; label: string; end?: boolean };
export type AdminNavGroup = { label: string; items: AdminNavItem[] };

// Grouped back-office navigation. Shared by the desktop sidebar and the
// mobile hamburger sheet so labels and order stay perfectly in sync.
export const ADMIN_NAV: AdminNavGroup[] = [
  {
    label: "Pilotage",
    items: [{ to: "/admin", icon: LayoutDashboard, label: "Vue d'ensemble", end: true }],
  },
  {
    label: "Exploitation",
    items: [
      { to: "/admin/stations", icon: Server, label: "Bornes" },
      { to: "/admin/kiosk-devices", icon: TabletSmartphone, label: "Tablettes kiosque" },
      { to: "/admin/orders", icon: ShoppingCart, label: "Locations / Commandes" },
      { to: "/admin/rentals", icon: BatteryCharging, label: "Locations (legacy)" },
    ],
  },
  {
    label: "Finance",
    items: [
      { to: "/admin/payments", icon: CreditCard, label: "Paiements" },
      { to: "/admin/pricing", icon: Tag, label: "Tarification" },
    ],
  },
  {
    label: "Réseau",
    items: [
      { to: "/admin/partners", icon: Building2, label: "Partenaires" },
      { to: "/admin/shops", icon: Store, label: "Établissements" },
    ],
  },
  {
    label: "Support",
    items: [{ to: "/admin/maintenance", icon: Wrench, label: "Maintenance" }],
  },
  {
    label: "Technique",
    items: [
      { to: "/admin/rental-flow-health", icon: HeartPulse, label: "Santé parcours" },
      { to: "/admin/api-health", icon: Activity, label: "Santé API" },
      { to: "/admin/api-coverage", icon: ListChecks, label: "Couverture API" },
      { to: "/admin/test-monitor", icon: ClipboardCheck, label: "Contrôle de test" },
      { to: "/admin/events", icon: Radio, label: "Événements" },
    ],
  },
  {
    label: "Configuration",
    items: [
      { to: "/admin/users", icon: Users, label: "Utilisateurs & rôles" },
      { to: "/admin/settings", icon: Settings, label: "Réglages" },
    ],
  },
];
