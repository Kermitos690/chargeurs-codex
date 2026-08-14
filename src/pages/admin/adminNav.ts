import {
  LayoutDashboard, Server, BatteryCharging, ShoppingCart, CreditCard, Tag,
  Store, Wrench, Activity, ListChecks, ClipboardCheck, HeartPulse, Radio, Settings,
  Building2, Users, TabletSmartphone, KeyRound, Gauge, Crown, Megaphone, Boxes,
  type LucideIcon,
} from "lucide-react";

export type AdminNavItem = {
  to: string;
  icon: LucideIcon;
  label: string;
  end?: boolean;
  roles?: readonly string[];
};
export type AdminNavGroup = { label: string; items: AdminNavItem[] };

const ALL_INTERNAL = [
  "super_admin", "admin", "operations_admin", "finance_admin", "support_agent",
  "maintenance_technician", "staff", "operator", "viewer",
] as const;
const OPERATIONS = ["super_admin", "admin", "operations_admin", "operator"] as const;
const OPERATIONS_ADMIN = ["super_admin", "admin", "operations_admin"] as const;
const OPERATIONS_READ = [...OPERATIONS, "support_agent", "maintenance_technician", "staff", "viewer"] as const;
const FINANCE = ["super_admin", "admin", "finance_admin"] as const;
const FINANCE_READ = [...FINANCE, "support_agent", "operations_admin", "staff", "viewer"] as const;
const SUPPORT = ["super_admin", "admin", "operations_admin", "support_agent", "maintenance_technician", "operator"] as const;
const ADVERTISING = ["super_admin", "admin", "operations_admin", "advertising_manager"] as const;
const SUPER_ONLY = ["super_admin"] as const;

export const ADMIN_NAV: AdminNavGroup[] = [
  {
    label: "Pilotage",
    items: [
      { to: "/admin", icon: LayoutDashboard, label: "Vue d'ensemble", end: true, roles: ALL_INTERNAL },
      { to: "/admin/network-overview", icon: Activity, label: "Réseau détaillé", roles: OPERATIONS_READ },
    ],
  },
  {
    label: "Exploitation",
    items: [
      { to: "/admin/stations", icon: Server, label: "Bornes", roles: OPERATIONS_READ },
      { to: "/admin/kiosk-devices", icon: TabletSmartphone, label: "Tablettes kiosque", roles: OPERATIONS_READ },
      { to: "/admin/remote-kiosk", icon: TabletSmartphone, label: "Écran à distance", roles: OPERATIONS },
      { to: "/admin/battery-qualification", icon: Gauge, label: "Qualification batteries", roles: OPERATIONS_ADMIN },
      { to: "/admin/orders", icon: ShoppingCart, label: "Locations / Commandes", roles: FINANCE_READ },
      { to: "/admin/rentals", icon: BatteryCharging, label: "Locations (legacy)", roles: FINANCE_READ },
    ],
  },
  {
    label: "Inventaire",
    items: [
      { to: "/admin/inventory", icon: Boxes, label: "Inventory & fournisseurs", roles: SUPER_ONLY },
    ],
  },
  {
    label: "Finance",
    items: [
      { to: "/admin/payments", icon: CreditCard, label: "Paiements", roles: FINANCE_READ },
      { to: "/admin/pricing", icon: Tag, label: "Tarification", roles: FINANCE_READ },
      { to: "/admin/customer-program", icon: Crown, label: "Client Chargeurs", roles: FINANCE_READ },
    ],
  },
  {
    label: "Réseau",
    items: [
      { to: "/admin/partners", icon: Building2, label: "Partenaires", roles: OPERATIONS },
      { to: "/admin/shops", icon: Store, label: "Établissements", roles: OPERATIONS },
      { to: "/admin/advertising", icon: Megaphone, label: "Publicités", roles: ADVERTISING },
    ],
  },
  {
    label: "Support",
    items: [{ to: "/admin/maintenance", icon: Wrench, label: "Maintenance", roles: SUPPORT }],
  },
  {
    label: "Technique",
    items: [
      { to: "/admin/rental-flow-health", icon: HeartPulse, label: "Santé parcours", roles: SUPPORT },
      { to: "/admin/api-health", icon: Activity, label: "Santé API", roles: OPERATIONS_READ },
      { to: "/admin/api-coverage", icon: ListChecks, label: "Couverture API", roles: OPERATIONS_ADMIN },
      { to: "/admin/test-monitor", icon: ClipboardCheck, label: "Contrôle de test", roles: OPERATIONS_ADMIN },
      { to: "/admin/events", icon: Radio, label: "Événements", roles: SUPPORT },
    ],
  },
  {
    label: "Configuration",
    items: [
      { to: "/admin/users", icon: Users, label: "Utilisateurs & rôles", roles: SUPER_ONLY },
      { to: "/admin/api-clients", icon: KeyRound, label: "Clients API", roles: SUPER_ONLY },
      { to: "/admin/settings", icon: Settings, label: "Réglages", roles: OPERATIONS },
    ],
  },
];

export function canAccessAdminPath(pathname: string, roles: string[]): boolean {
  if (!roles.length) return false;
  const items = ADMIN_NAV.flatMap((group) => group.items)
    .filter((item) => item.end ? pathname === item.to : pathname === item.to || pathname.startsWith(`${item.to}/`))
    .sort((left, right) => right.to.length - left.to.length);
  const match = items[0];
  if (!match) return false;
  return !match.roles || roles.some((role) => match.roles?.includes(role));
}
