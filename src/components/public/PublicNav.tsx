import { useState } from "react";
import { motion } from "framer-motion";
import { Menu } from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";

// Public / client navigation. Intentionally contains NO administrative links —
// the back-office entry lives discreetly in the footer / direct URL only.
export const PUBLIC_LINKS: { href: string; label: string }[] = [
  { href: "#accueil", label: "Accueil" },
  { href: "#bornes", label: "Bornes / Carte" },
  { href: "#comment", label: "Comment ça marche" },
  { href: "#tarifs", label: "Tarifs" },
  { href: "#paiement", label: "Paiements" },
  { href: "#faq", label: "FAQ" },
  { href: "#contact", label: "Aide / Contact" },
];

export function PublicNav() {
  const [open, setOpen] = useState(false);

  return (
    <motion.header
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-strong fixed inset-x-0 top-0 z-40 mx-auto flex max-w-7xl items-center justify-between gap-4 rounded-b-2xl px-4 py-3 sm:px-6"
    >
      <a href="#accueil" aria-label="Chargeurs.ch — accueil"><BrandLogo /></a>

      {/* Desktop links */}
      <nav className="hidden items-center gap-1 lg:flex">
        {PUBLIC_LINKS.map((l) => (
          <a
            key={l.href}
            href={l.href}
            className="rounded-full px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            {l.label}
          </a>
        ))}
      </nav>

      <div className="flex items-center gap-2">
        <a
          href="/compte"
          className="hidden rounded-full bg-gradient-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-glow sm:inline-flex"
        >
          Mon compte
        </a>
        <div className="hidden sm:block"><LanguageSwitcher /></div>


        {/* Mobile / tablet hamburger */}
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Ouvrir le menu" className="border border-border lg:hidden">
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="right" className="glass-strong flex w-[85vw] max-w-sm flex-col gap-6 border-border p-6">
            <BrandLogo />
            <nav className="flex flex-col gap-1">
              {PUBLIC_LINKS.map((l) => (
                <a
                  key={l.href}
                  href={l.href}
                  onClick={() => setOpen(false)}
                  className="rounded-xl px-4 py-3 text-base font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  {l.label}
                </a>
              ))}
            </nav>
            <div className="mt-auto"><LanguageSwitcher /></div>
          </SheetContent>
        </Sheet>
      </div>
    </motion.header>
  );
}
