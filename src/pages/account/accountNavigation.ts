import { CircleDollarSign, HelpCircle, Home, MapPinned, UserRound } from "lucide-react";

export const ACCOUNT_NAV_ITEMS = [
  { to: "/compte", label: "Accueil", icon: Home, end: true },
  { to: "/compte/locations", label: "Locations", icon: MapPinned, end: false },
  { to: "/compte/paiements", label: "Paiements", icon: CircleDollarSign, end: false },
  { to: "/compte/support", label: "Support", icon: HelpCircle, end: false },
  { to: "/compte/profil", label: "Profil", icon: UserRound, end: false },
] as const;
