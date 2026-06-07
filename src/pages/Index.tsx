import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { LiquidBackground } from "@/components/LiquidBackground";
import { BrandLogo } from "@/components/BrandLogo";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { Button } from "@/components/ui/button";
import { ArrowRight, MonitorSmartphone, ShieldCheck, Zap } from "lucide-react";

export default function Index() {
  const [stations, setStations] = useState<any[]>([]);
  useEffect(() => {
    supabase.from("stations").select("station_id, name, online").order("station_id").then(({ data }) => setStations(data ?? []));
  }, []);

  return (
    <div className="relative min-h-screen px-6 py-8 sm:px-12">
      <LiquidBackground />
      <header className="flex items-center justify-between">
        <BrandLogo />
        <div className="flex items-center gap-3">
          <LanguageSwitcher />
          <Button asChild variant="ghost" className="border border-border"><Link to="/admin">Admin</Link></Button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl pt-16 text-center sm:pt-24">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <span className="glass inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm text-secondary">
            <Zap className="h-4 w-4" />Location de batteries · Suisse
          </span>
          <h1 className="mx-auto mt-6 max-w-4xl font-display text-5xl font-extrabold leading-tight sm:text-7xl">
            Rechargez votre téléphone.<br /><span className="text-gradient">Continuez votre soirée.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-xl text-muted-foreground">
            Bornes self-service dans les bars, restaurants et hôtels. Paiement TWINT, Apple Pay, Google Pay et carte.
          </p>
        </motion.div>

        <div className="mt-12 grid gap-4 sm:grid-cols-3">
          {stations.map((s) => (
            <Link key={s.station_id} to={`/kiosk/${s.station_id}`}
              className="glass liquid-border group rounded-2xl p-6 text-left transition-transform hover:scale-[1.03]">
              <MonitorSmartphone className="mb-3 h-7 w-7 text-primary" />
              <div className="font-mono text-xs text-muted-foreground">{s.station_id}</div>
              <div className="text-lg font-bold">{s.name}</div>
              <div className={`mt-1 text-sm ${s.online ? "text-success" : "text-muted-foreground"}`}>
                {s.online ? "En ligne" : "Hors ligne"}
              </div>
              <div className="mt-4 inline-flex items-center gap-1 text-sm text-primary">
                Ouvrir le kiosque <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </div>
            </Link>
          ))}
        </div>

        <div className="mt-12 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <ShieldCheck className="h-4 w-4 text-success" />Paiements sécurisés par Stripe · API ChargeNow temps réel
        </div>
      </main>
    </div>
  );
}
