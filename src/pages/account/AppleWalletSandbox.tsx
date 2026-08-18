import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, ExternalLink, Loader2, RefreshCw, ShieldCheck, Smartphone, TriangleAlert, WalletCards } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, supabase } from "@/integrations/supabase/client";

type ConfigState = {
  loading: boolean;
  configured: boolean;
  missing: string[];
  error: boolean;
};

type SyncResult = {
  changed: boolean;
  revision: number;
  notified: boolean;
  notification: { devices: number; sent: number; failed: number };
  source: string;
};

const initialConfig: ConfigState = { loading: true, configured: false, missing: [], error: false };

export default function AppleWalletSandbox() {
  const [config, setConfig] = useState<ConfigState>(initialConfig);
  const [issuing, setIssuing] = useState(false);
  const [syncing, setSyncing] = useState<"real" | "transport" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<SyncResult | null>(null);
  const isAppleMobile = useMemo(() => /iPhone|iPad|iPod/i.test(navigator.userAgent), []);

  const loadConfig = useCallback(async () => {
    setConfig((current) => ({ ...current, loading: true, error: false }));
    try {
      const response = await fetch(`${SUPABASE_URL}/functions/v1/apple-wallet-pass?action=status`, {
        headers: { apikey: SUPABASE_PUBLISHABLE_KEY },
      });
      const data = await response.json() as { ok?: boolean; configured?: boolean; missing?: string[] };
      if (!response.ok || !data.ok) throw new Error("STATUS_UNAVAILABLE");
      setConfig({ loading: false, configured: data.configured === true, missing: data.missing ?? [], error: false });
    } catch {
      setConfig({ loading: false, configured: false, missing: [], error: true });
    }
  }, []);

  useEffect(() => { void loadConfig(); }, [loadConfig]);

  const addToWallet = async () => {
    if (issuing || !config.configured) return;
    setIssuing(true);
    setError(null);
    setMessage(null);
    try {
      const { data, error: invokeError } = await supabase.functions.invoke("apple-wallet-pass", { body: {} });
      if (invokeError || !data?.ok || !data.downloadUrl) throw new Error(String(data?.error ?? "APPLE_WALLET_LINK_FAILED"));
      setMessage("Pass signé généré depuis les données réelles. Ouverture d’Apple Wallet…");
      window.location.assign(String(data.downloadUrl));
    } catch (caught) {
      const code = caught instanceof Error ? caught.message : "APPLE_WALLET_LINK_FAILED";
      setError(code.includes("ACTIVE_MEMBERSHIP_REQUIRED")
        ? "Une adhésion Chargeurs+ active est nécessaire pour émettre le pass."
        : "Le pass Apple Wallet n’a pas pu être émis. Aucun faux succès n’est affiché.");
    } finally {
      setIssuing(false);
    }
  };

  const synchronize = async (testTransport: boolean) => {
    if (syncing || !config.configured) return;
    setSyncing(testTransport ? "transport" : "real");
    setError(null);
    setMessage(null);
    try {
      const { data, error: invokeError } = await supabase.functions.invoke("apple-wallet-sync", {
        body: { testTransport },
      });
      if (invokeError || !data?.ok) throw new Error(String(data?.error ?? "APPLE_WALLET_SYNC_FAILED"));
      const result = data as SyncResult & { ok: true };
      setLastSync(result);
      if (testTransport) {
        setMessage(result.notification.devices === 0
          ? "Transport testé : aucun iPhone n’est encore enregistré pour ce pass."
          : `Transport testé : ${result.notification.sent}/${result.notification.devices} notification(s) acceptée(s) par APNs.`);
      } else if (result.changed) {
        setMessage(`Données réelles modifiées : révision ${result.revision}, notification Wallet déclenchée.`);
      } else {
        setMessage(`Aucune donnée réelle n’a changé. Révision ${result.revision} conservée, aucun changement artificiel créé.`);
      }
    } catch {
      setError("La synchronisation n’a pas été confirmée. Aucun résultat n’est présenté comme réussi.");
    } finally {
      setSyncing(null);
    }
  };

  return (
    <div className="space-y-6 pt-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-violet-300/20 bg-violet-400/10 px-3 py-1.5 text-xs font-black uppercase tracking-[.16em] text-violet-200">
            <WalletCards className="h-4 w-4" /> Apple Wallet Sandbox
          </div>
          <h1 className="mt-4 font-display text-3xl font-extrabold sm:text-4xl">Chargeurs+ Pass — test réel</h1>
          <p className="mt-2 max-w-3xl text-muted-foreground">
            Ce sandbox ne crée aucune location, aucun crédit, aucun statut et aucun avantage fictif. Le pass est généré uniquement à partir des données réellement présentes dans le backend staging.
          </p>
        </div>
        <Button asChild variant="outline" className="rounded-full"><Link to="/compte/pass">Retour au Pass</Link></Button>
      </div>

      <section className="grid gap-4 md:grid-cols-3">
        <article className="glass rounded-3xl p-5 md:col-span-2">
          <div className="flex items-center gap-3">
            {config.loading ? <Loader2 className="h-6 w-6 animate-spin text-primary" /> : config.configured ? <CheckCircle2 className="h-6 w-6 text-success" /> : <TriangleAlert className="h-6 w-6 text-warning" />}
            <div>
              <h2 className="font-display text-xl font-bold">Configuration Apple</h2>
              <p className="text-sm text-muted-foreground">
                {config.loading ? "Vérification…" : config.configured ? "Signature Wallet disponible côté serveur." : "Signature Wallet encore incomplète."}
              </p>
            </div>
          </div>
          {!config.loading && !config.configured && config.missing.length > 0 && (
            <div className="mt-4 rounded-2xl border border-warning/25 bg-warning/10 p-4">
              <p className="text-sm font-semibold">Éléments manquants</p>
              <p className="mt-1 break-words text-xs text-muted-foreground">{config.missing.join(" · ")}</p>
            </div>
          )}
          {config.error && <p className="mt-4 text-sm text-destructive">Le statut du service Wallet n’est pas accessible.</p>}
          <Button className="mt-4 rounded-full" variant="outline" onClick={() => void loadConfig()} disabled={config.loading}>
            <RefreshCw className="mr-2 h-4 w-4" /> Revérifier
          </Button>
        </article>

        <article className="glass rounded-3xl p-5">
          <Smartphone className="h-7 w-7 text-primary" />
          <h2 className="mt-3 font-display text-xl font-bold">Appareil</h2>
          <p className="mt-2 text-sm text-muted-foreground">{isAppleMobile ? "iPhone/iPad détecté : test d’installation possible." : "Ouvre cette page sur l’iPhone pour le test d’installation Wallet."}</p>
        </article>
      </section>

      <section className="overflow-hidden rounded-[2rem] border border-violet-300/20 bg-[radial-gradient(circle_at_20%_10%,rgba(168,85,247,.22),transparent_35%),linear-gradient(145deg,rgba(9,6,20,.98),rgba(3,7,16,.98))] p-6 sm:p-8">
        <h2 className="font-display text-2xl font-bold">1. Installer le vrai pass</h2>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Le serveur vérifie l’adhésion active, signe un `.pkpass`, puis fournit un lien temporaire. Le lien ne contient ni JWT de compte ni jeton permanent Apple.
        </p>
        <Button className="mt-5 rounded-full bg-violet-500 px-6 font-bold text-white hover:bg-violet-400" onClick={() => void addToWallet()} disabled={!config.configured || issuing}>
          {issuing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <WalletCards className="mr-2 h-4 w-4" />}
          Ajouter à Apple Wallet
        </Button>

        <div className="mt-8 border-t border-white/10 pt-6">
          <h2 className="font-display text-2xl font-bold">2. Tester le dynamique sans fausser les données</h2>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            « Synchroniser » recalcule le pass depuis le backend réel. « Tester le transport » envoie seulement une notification de rafraîchissement au pass déjà installé ; il ne change aucune valeur métier.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Button variant="outline" className="rounded-full" onClick={() => void synchronize(false)} disabled={!config.configured || Boolean(syncing)}>
              {syncing === "real" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Synchroniser les données réelles
            </Button>
            <Button variant="outline" className="rounded-full" onClick={() => void synchronize(true)} disabled={!config.configured || Boolean(syncing)}>
              {syncing === "transport" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ExternalLink className="mr-2 h-4 w-4" />}
              Tester le transport Wallet
            </Button>
          </div>
        </div>
      </section>

      {message && <div className="rounded-2xl border border-success/25 bg-success/10 p-4 text-sm text-success">{message}</div>}
      {error && <div className="rounded-2xl border border-destructive/25 bg-destructive/10 p-4 text-sm text-destructive">{error}</div>}

      {lastSync && (
        <section className="glass rounded-3xl p-5">
          <div className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-success" /><h2 className="font-semibold">Dernière vérification</h2></div>
          <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <p>Source : <strong>{lastSync.source === "real_backend_data" ? "backend réel" : lastSync.source}</strong></p>
            <p>Révision : <strong>{lastSync.revision}</strong></p>
            <p>Donnée modifiée : <strong>{lastSync.changed ? "oui" : "non"}</strong></p>
            <p>APNs : <strong>{lastSync.notification.sent}/{lastSync.notification.devices}</strong></p>
          </div>
        </section>
      )}
    </div>
  );
}
