import { AnimatePresence, motion } from "framer-motion";
import { MessageCircle, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { useCustomer } from "@/hooks/useCustomer";
import { VoltAssistantV2 } from "@/components/support/VoltAssistantV2";

function VoltMascot({ compact = false }: { compact?: boolean }) {
  const size = compact ? 46 : 72;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 84 92"
      aria-hidden="true"
      className="drop-shadow-[0_14px_24px_rgba(37,126,255,0.38)]"
    >
      <defs>
        <linearGradient id="volt-body" x1="12" y1="9" x2="72" y2="82" gradientUnits="userSpaceOnUse">
          <stop stopColor="#87E8FF" />
          <stop offset="0.46" stopColor="#28B7FF" />
          <stop offset="1" stopColor="#705FFF" />
        </linearGradient>
        <linearGradient id="volt-bolt" x1="29" y1="24" x2="54" y2="66" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FFF8B4" />
          <stop offset="1" stopColor="#FFD447" />
        </linearGradient>
      </defs>

      <rect x="30" y="3" width="24" height="10" rx="5" fill="#DDF7FF" />
      <rect x="8" y="10" width="68" height="76" rx="23" fill="url(#volt-body)" stroke="rgba(255,255,255,.78)" strokeWidth="2" />
      <ellipse cx="25" cy="51" rx="6" ry="4" fill="#FFB5CF" fillOpacity=".72" />
      <ellipse cx="59" cy="51" rx="6" ry="4" fill="#FFB5CF" fillOpacity=".72" />
      <ellipse cx="29" cy="39" rx="6" ry="7.5" fill="#071B3B" />
      <ellipse cx="55" cy="39" rx="6" ry="7.5" fill="#071B3B" />
      <circle cx="31" cy="36.5" r="2" fill="white" />
      <circle cx="57" cy="36.5" r="2" fill="white" />
      <path d="M31 55c3.2 5 6.7 7.5 11 7.5S49.8 60 53 55" fill="none" stroke="#071B3B" strokeWidth="3.2" strokeLinecap="round" />
      <path d="M43 18 31 43h10l-3 20 15-27H43l0-18Z" fill="url(#volt-bolt)" stroke="rgba(255,255,255,.65)" strokeWidth="1" opacity=".92" />
    </svg>
  );
}

export function VoltWidget() {
  const location = useLocation();
  const hidden = location.pathname.startsWith("/kiosk") || location.pathname.startsWith("/admin");
  if (hidden) return null;
  return <VoltWidgetActive />;
}

function VoltWidgetActive() {
  const location = useLocation();
  const { user } = useCustomer();
  const [open, setOpen] = useState(false);
  const [introVisible, setIntroVisible] = useState(false);
  const isClient = Boolean(user);

  const context = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return {
      stationId: params.get("station")?.trim().toUpperCase() ?? "",
      rentalId: params.get("rental")?.trim() ?? "",
    };
  }, [location.search]);

  useEffect(() => {
    if (open) return;
    const timer = window.setTimeout(() => setIntroVisible(true), 900);
    const closeTimer = window.setTimeout(() => setIntroVisible(false), 6500);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(closeTimer);
    };
  }, [open]);

  useEffect(() => {
    const openVolt = () => setOpen(true);
    window.addEventListener("volt:open", openVolt);
    return () => window.removeEventListener("volt:open", openVolt);
  }, []);

  useEffect(() => {
    if (open) setIntroVisible(false);
  }, [open]);

  const displayName = String(user?.user_metadata?.display_name ?? user?.user_metadata?.full_name ?? "");

  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.aside
            initial={{ opacity: 0, y: 18, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 14, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 360, damping: 30 }}
            className="fixed bottom-[calc(6.8rem+env(safe-area-inset-bottom))] right-3 z-[90] w-[calc(100vw-1.5rem)] max-w-[27rem] sm:right-5 sm:w-[27rem]"
            aria-label="Assistant Volt"
          >
            <div className="relative overflow-hidden rounded-[1.8rem] border border-white/15 bg-background/95 shadow-[0_28px_90px_rgba(0,0,0,0.48)] backdrop-blur-2xl">
              <div className="flex items-center justify-between gap-3 border-b border-border/70 bg-gradient-to-r from-primary/15 via-card/60 to-violet-500/10 px-4 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <VoltMascot compact />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-display text-lg font-extrabold">Volt</span>
                      <span className="rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-[0.62rem] font-bold uppercase tracking-wide text-success">en ligne</span>
                    </div>
                    <p className="truncate text-xs text-muted-foreground">Assistant Chargeurs.ch</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-border bg-background/70 text-muted-foreground transition hover:text-foreground"
                  aria-label="Fermer Volt"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="max-h-[min(72vh,44rem)] overflow-y-auto p-2 sm:p-3 [&>section]:rounded-[1.35rem] [&>section]:border-white/10 [&>section>header]:hidden">
                <VoltAssistantV2
                  mode={isClient ? "client" : "public"}
                  userName={displayName}
                  userEmail={user?.email ?? ""}
                  stationId={context.stationId}
                  rentalId={context.rentalId}
                />
              </div>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      <div className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] right-3 z-[91] flex items-end gap-2 sm:right-5 sm:gap-3">
        <AnimatePresence>
          {introVisible && !open && (
            <motion.button
              type="button"
              initial={{ opacity: 0, x: 12, y: 4 }}
              animate={{ opacity: 1, x: 0, y: 0 }}
              exit={{ opacity: 0, x: 8 }}
              onClick={() => setOpen(true)}
              className="mb-2 max-w-[12rem] rounded-2xl rounded-br-md border border-white/15 bg-background/95 px-3.5 py-2.5 text-left text-xs leading-5 text-foreground shadow-2xl backdrop-blur-xl"
            >
              <span className="font-bold">Salut, moi c’est Volt ⚡</span><br />
              Besoin d’un coup de main ?
            </motion.button>
          )}
        </AnimatePresence>

        <motion.button
          type="button"
          whileHover={{ scale: 1.04, y: -2 }}
          whileTap={{ scale: 0.94 }}
          onClick={() => setOpen((current) => !current)}
          className="group relative grid h-[5.25rem] w-[5.25rem] place-items-center rounded-[1.7rem] border border-white/20 bg-gradient-to-br from-sky-400/25 via-primary/20 to-violet-500/25 shadow-[0_18px_45px_rgba(36,122,255,0.38)] backdrop-blur-xl focus:outline-none focus-visible:ring-4 focus-visible:ring-primary/30"
          aria-expanded={open}
          aria-label={open ? "Fermer Volt" : "Ouvrir Volt, assistant Chargeurs.ch"}
        >
          <motion.div
            animate={open ? { rotate: [0, -4, 4, 0] } : { y: [0, -2, 0] }}
            transition={open ? { duration: 0.3 } : { duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
          >
            <VoltMascot />
          </motion.div>
          <span className="absolute -bottom-5 rounded-full bg-background/90 px-2 py-0.5 text-[0.66rem] font-extrabold tracking-wide text-primary shadow-lg">Volt</span>
          {!open && <span className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full border border-white/20 bg-success text-success-foreground shadow-lg"><MessageCircle className="h-3.5 w-3.5" /></span>}
        </motion.button>
      </div>
    </>
  );
}
