import { AnimatePresence, motion } from "framer-motion";
import { QRCodeSVG } from "qrcode.react";
import { useParams } from "react-router-dom";
import {
  AlertTriangle, ArrowLeft, ArrowRight, BatteryCharging, CheckCircle2, Clock3,
  CreditCard, Loader2, Lock, RefreshCw, ShieldCheck, Smartphone, Sparkles, WifiOff, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { KioskDiagnostics } from "@/components/kiosk/KioskDiagnostics";
import {
  FlowSteps, KioskV2Backdrop, KioskV2TopBar, PowerbankArt, TrustRow,
} from "@/components/kiosk/KioskV2Primitives";
import { useI18n } from "@/i18n/i18n";
import { useKioskV2Controller } from "@/hooks/useKioskV2Controller";
import "@/styles/kiosk-v2.css";
import "@/styles/kiosk-v2-battery.css";

const transition = { duration: 0.42, ease: [0.22, 1, 0.36, 1] as const };

export default function KioskV2() {
  const { stationId } = useParams();
  const { lang } = useI18n();
  const kiosk = useKioskV2Controller(stationId, lang);
  const fmtCents = (cents: number, currency = "CHF") => `${(cents / 100).toFixed(2)} ${currency}`;

  if (kiosk.mismatch && kiosk.lockedStation) {
    return (
      <div className="kiosk-v2-root relative grid min-h-screen place-items-center overflow-hidden px-6 text-center">
        <KioskV2Backdrop />
        <div className="kiosk-v2-panel relative z-10 flex w-full max-w-xl flex-col items-center gap-6 rounded-[2rem] p-9">
          <div className="grid h-20 w-20 place-items-center rounded-3xl border border-warning/30 bg-warning/10">
            <Lock className="h-9 w-9 text-warning" />
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.25em] text-warning">Protection de la borne</p>
            <h1 className="font-display text-3xl font-extrabold">Cette tablette est déjà attribuée</h1>
          </div>
          <p className="max-w-md text-muted-foreground">
            La tablette appartient à la borne <span className="font-mono font-semibold text-foreground">{kiosk.lockedStation}</span> et ne peut pas changer de station silencieusement.
          </p>
          <Button onClick={() => window.location.assign(`/kiosk/${kiosk.lockedStation}`)} className="kiosk-v2-cta h-14 rounded-full px-8 text-base font-bold">
            Revenir à {kiosk.lockedStation}<ArrowRight className="ml-2 h-5 w-5" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="kiosk-v2-root relative min-h-screen overflow-hidden px-5 py-5 sm:px-9 sm:py-7 lg:px-12">
      <KioskV2Backdrop />

      {kiosk.offline && (
        <div className="fixed inset-x-0 top-0 z-[70] flex items-center justify-center gap-2 bg-destructive/95 px-4 py-2.5 text-sm font-semibold text-destructive-foreground shadow-2xl">
          <WifiOff className="h-4 w-4" />Connexion Internet indisponible — aucun paiement ne peut être lancé
        </div>
      )}

      {kiosk.needRefresh && !kiosk.offline && (
        <div className="fixed inset-x-0 top-0 z-[60] flex items-center justify-center gap-2 bg-primary/90 px-4 py-2 text-xs font-semibold text-primary-foreground">
          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
          {kiosk.busy ? "Mise à jour prête — application après l'opération" : "Mise à jour de l'expérience Chargeurs.ch…"}
        </div>
      )}

      {kiosk.showDiag && (
        <KioskDiagnostics
          stationId={stationId}
          lockedStation={kiosk.lockedStation}
          lastSync={kiosk.station?.last_sync_at ?? null}
          net={kiosk.net}
          chargenowConfigured={kiosk.configured}
          stationOnline={kiosk.station?.online ?? null}
          swUrl={kiosk.swUrl}
          needRefresh={kiosk.needRefresh}
          onApplyUpdate={kiosk.applyUpdate}
          onClose={() => kiosk.setShowDiag(false)}
        />
      )}

      {kiosk.showHelp && <HelpOverlay onClose={() => kiosk.setShowHelp(false)} />}

      <div className="relative z-10 mx-auto flex min-h-[calc(100vh-2.5rem)] max-w-[1500px] flex-col">
        <KioskV2TopBar
          stationId={stationId}
          online={Boolean(kiosk.station?.online && !kiosk.offline)}
          available={kiosk.inventoryReadable ? kiosk.available : null}
          onLogoTap={kiosk.onLogoTap}
          onHelp={() => kiosk.setShowHelp(true)}
        />

        <main className="flex flex-1 items-center justify-center py-5 sm:py-8">
          <AnimatePresence mode="wait">
            {kiosk.phase === "loading" && (
              <Stage key="loading" className="items-center text-center">
                <div className="relative grid h-28 w-28 place-items-center rounded-[2rem] border border-primary/25 bg-primary/10">
                  <div className="absolute inset-[-18px] rounded-[2.5rem] border border-primary/15 animate-pulse" />
                  <Loader2 className="h-12 w-12 animate-spin text-primary" />
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.28em] text-primary">Chargeurs.ch Kiosk 2</p>
                  <h1 className="mt-3 font-display text-3xl font-extrabold">Préparation de votre borne</h1>
                  <p className="mt-2 text-muted-foreground">Connexion, stock et tarification sont vérifiés.</p>
                </div>
              </Stage>
            )}

            {kiosk.phase === "idle" && !kiosk.station && (
              <Stage key="station-error" className="items-center text-center">
                <div className="grid h-24 w-24 place-items-center rounded-[2rem] border border-warning/30 bg-warning/10">
                  <AlertTriangle className="h-11 w-11 text-warning" />
                </div>
                <div className="max-w-xl">
                  <p className="text-xs font-semibold uppercase tracking-[0.26em] text-warning">Configuration requise</p>
                  <h1 className="mt-3 font-display text-4xl font-extrabold">
                    {kiosk.stationLoadError === "INVALID_STATION_ID" ? "Adresse de borne invalide" : "Borne non reconnue"}
                  </h1>
                  <p className="mt-4 text-lg text-muted-foreground">Cette tablette ne peut pas démarrer une location tant que la station n'est pas disponible dans le système.</p>
                  {stationId && <p className="mt-4 font-mono text-sm text-foreground/80">Station demandée : {stationId}</p>}
                </div>
                <Button onClick={() => kiosk.loadStation()} className="kiosk-v2-cta h-14 rounded-full px-8 text-base font-bold">
                  <RefreshCw className="mr-2 h-5 w-5" />Réessayer
                </Button>
              </Stage>
            )}

            {kiosk.phase === "idle" && kiosk.station && (
              <motion.section
                key="idle"
                initial={{ opacity: 0, y: 22 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -16 }}
                transition={transition}
                className="grid w-full items-center gap-6 lg:grid-cols-[1.02fr_.98fr] lg:gap-10"
              >
                <div className="flex flex-col items-start py-3 text-left lg:py-8">
                  <div className={`mb-7 inline-flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-[0.17em] ${kiosk.canRent ? "border-success/30 bg-success/10 text-success" : "border-warning/30 bg-warning/10 text-warning"}`}>
                    <span className={`h-2 w-2 rounded-full ${kiosk.canRent ? "bg-success shadow-[0_0_12px_hsl(var(--success))]" : "bg-warning"}`} />
                    {kiosk.canRent ? "Prête à vous charger" : "Service momentanément limité"}
                  </div>

                  <p className="mb-3 text-sm font-semibold uppercase tracking-[0.3em] text-secondary">L'énergie qui vous suit</p>
                  <h1 className="max-w-3xl font-display text-[clamp(3rem,6.2vw,6.8rem)] font-extrabold leading-[0.94] tracking-[-0.055em]">
                    Ne tombez plus jamais à <span className="text-gradient-cyan">0%</span>.
                  </h1>
                  <p className="mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground sm:text-xl lg:text-2xl">
                    Louez une batterie en quelques secondes, rechargez en déplacement et rendez-la dans le réseau Chargeurs.ch.
                  </p>

                  <div className="mt-8 grid w-full max-w-2xl grid-cols-2 gap-3 sm:grid-cols-3">
                    <Metric label="Disponibles" value={kiosk.inventoryReadable ? String(kiosk.available) : "—"} accent />
                    <Metric label="Paiement" value="Mobile" />
                    <Metric label="Retour" value="Réseau" className="col-span-2 sm:col-span-1" />
                  </div>

                  <div className="mt-8 flex w-full max-w-2xl flex-col gap-4 sm:flex-row sm:items-center">
                    {kiosk.canRent ? (
                      <Button
                        onClick={() => { kiosk.goFullscreen(); kiosk.setPhase("pricing"); }}
                        className="kiosk-v2-cta h-[4.5rem] flex-1 rounded-2xl px-9 text-xl font-extrabold sm:text-2xl"
                      >
                        Louer une batterie<ArrowRight className="ml-3 h-6 w-6" />
                      </Button>
                    ) : (
                      <div className="kiosk-v2-panel flex min-h-[4.5rem] flex-1 items-center rounded-2xl px-6 text-warning">
                        <AlertTriangle className="mr-3 h-5 w-5 shrink-0" />
                        <span className="font-semibold">
                          {kiosk.offline ? "Connexion indisponible" : !kiosk.configured ? "Passerelle de la borne non configurée" : !kiosk.station.online ? "Borne hors ligne" : "Aucune batterie disponible"}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="mt-7"><TrustRow online={Boolean(kiosk.station.online && !kiosk.offline)} /></div>
                </div>

                <div className="kiosk-v2-panel overflow-hidden rounded-[2.25rem] p-4 sm:p-7">
                  <PowerbankArt available={kiosk.inventoryReadable ? kiosk.available : 0} />
                  <div className="border-t border-white/10 px-3 pb-2 pt-5"><FlowSteps active={0} /></div>
                </div>
              </motion.section>
            )}

            {kiosk.phase === "pricing" && (
              <Stage key="pricing" className="w-full max-w-5xl">
                <div className="grid w-full gap-5 lg:grid-cols-[1.1fr_.9fr]">
                  <div className="kiosk-v2-panel rounded-[2rem] p-7 sm:p-10">
                    <button onClick={kiosk.reset} className="mb-8 inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground transition hover:text-foreground">
                      <ArrowLeft className="h-4 w-4" />Retour
                    </button>
                    <p className="text-xs font-semibold uppercase tracking-[0.28em] text-secondary">Étape 1 sur 3</p>
                    <h2 className="mt-3 font-display text-4xl font-extrabold sm:text-5xl">Votre énergie, sans engagement.</h2>
                    <p className="mt-4 max-w-xl text-lg text-muted-foreground">Vous ne payez que la durée utilisée. Le prix final est calculé automatiquement au retour.</p>
                    <div className="mt-8"><FlowSteps active={0} /></div>
                  </div>

                  <div className="kiosk-v2-panel flex flex-col rounded-[2rem] p-7 sm:p-9">
                    {kiosk.quote ? (
                      <>
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <p className="text-sm font-semibold text-muted-foreground">{kiosk.quote.profile_name}</p>
                            <div className="mt-2 font-display text-4xl font-extrabold text-gradient-cyan sm:text-5xl">
                              {fmtCents(kiosk.quote.price_per_period_cents, kiosk.quote.currency)}
                            </div>
                            <p className="mt-1 text-sm text-muted-foreground">par tranche de {kiosk.quote.period_minutes} minutes</p>
                          </div>
                          <div className="grid h-14 w-14 place-items-center rounded-2xl border border-primary/25 bg-primary/10"><Sparkles className="h-6 w-6 text-primary" /></div>
                        </div>
                        <div className="my-7 space-y-3 border-y border-white/10 py-6 text-sm">
                          <PriceLine label="Garantie initiale" value={fmtCents(kiosk.quote.deposit_cents, kiosk.quote.currency)} strong />
                          <PriceLine label="Plafond par jour" value={fmtCents(kiosk.quote.daily_cap_cents, kiosk.quote.currency)} />
                          <PriceLine label="Montant si non-retour" value={fmtCents(kiosk.quote.unreturned_fee_cents, kiosk.quote.currency)} />
                        </div>
                        <p className="mb-6 text-xs leading-relaxed text-muted-foreground">La garantie est autorisée ou débitée selon le moyen de paiement. Le solde non utilisé est ensuite libéré ou remboursé.</p>
                        <Button onClick={kiosk.startRental} className="kiosk-v2-cta mt-auto h-16 rounded-2xl text-lg font-extrabold">
                          Continuer vers le paiement<ArrowRight className="ml-2 h-5 w-5" />
                        </Button>
                      </>
                    ) : (
                      <div className="flex flex-1 flex-col items-center justify-center py-12 text-center">
                        <AlertTriangle className="h-12 w-12 text-warning" />
                        <h3 className="mt-5 font-display text-2xl font-bold">Tarif indisponible</h3>
                        <p className="mt-2 text-muted-foreground">{kiosk.quoteError?.includes("AUTH") ? "Cette borne doit être activée." : "La tarification doit être configurée avant le test."}</p>
                      </div>
                    )}
                  </div>
                </div>
              </Stage>
            )}

            {kiosk.phase === "starting" && (
              <Stage key="starting" className="items-center text-center">
                <div className="relative grid h-32 w-32 place-items-center rounded-full border border-primary/25 bg-primary/10">
                  <div className="absolute inset-[-18px] rounded-full border border-primary/15 animate-ping" />
                  <Loader2 className="h-14 w-14 animate-spin text-primary" />
                </div>
                <div><p className="text-xs font-semibold uppercase tracking-[0.28em] text-primary">Paiement sécurisé</p><h2 className="mt-3 font-display text-4xl font-extrabold">Création de votre QR code</h2><p className="mt-3 text-lg text-muted-foreground">La borne réserve votre demande sans éjecter de batterie.</p></div>
              </Stage>
            )}

            {kiosk.phase === "qr" && kiosk.checkoutUrl && (
              <motion.section key="qr" initial={{ opacity: 0, scale: .97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={transition} className="grid w-full max-w-6xl items-center gap-6 lg:grid-cols-[.95fr_1.05fr]">
                <div className="kiosk-v2-panel rounded-[2rem] p-7 text-left sm:p-10">
                  <p className="text-xs font-semibold uppercase tracking-[0.28em] text-secondary">Étape 2 sur 3</p>
                  <h2 className="mt-3 font-display text-4xl font-extrabold sm:text-5xl">Scannez. Payez. C'est parti.</h2>
                  <p className="mt-4 text-lg text-muted-foreground">Ouvrez l'appareil photo de votre téléphone et scannez le QR code. La page de paiement sécurisée s'ouvre automatiquement.</p>
                  {kiosk.quote && (
                    <div className="mt-8 grid grid-cols-2 gap-3">
                      <Metric label="Garantie" value={fmtCents(kiosk.quote.deposit_cents, kiosk.quote.currency)} accent />
                      <Metric label="Tarif" value={`${fmtCents(kiosk.quote.price_per_period_cents, kiosk.quote.currency)} / ${kiosk.quote.period_minutes} min`} />
                    </div>
                  )}
                  <div className="mt-8"><FlowSteps active={1} /></div>
                  <div className="mt-8 flex flex-wrap gap-3 text-xs text-muted-foreground">
                    <PaymentChip icon={<CreditCard className="h-4 w-4" />} label="Carte" />
                    <PaymentChip icon={<Smartphone className="h-4 w-4" />} label="Apple Pay" />
                    <PaymentChip icon={<Smartphone className="h-4 w-4" />} label="Google Pay" />
                    <PaymentChip icon={<ShieldCheck className="h-4 w-4" />} label="TWINT si disponible" />
                  </div>
                </div>

                <div className="flex flex-col items-center gap-5 text-center">
                  <div className="relative">
                    <div className="absolute inset-[-22px] rounded-[2.4rem] bg-primary/20 blur-3xl animate-pulse" />
                    <div className="kiosk-v2-qr-frame relative rounded-[2rem] p-6 sm:p-8">
                      <QRCodeSVG value={kiosk.checkoutUrl} size={310} bgColor="#ffffff" fgColor="#071127" level="M" marginSize={2} />
                    </div>
                  </div>
                  <div className="flex items-center gap-3 rounded-full border border-white/10 bg-white/[0.04] px-5 py-2.5">
                    <Clock3 className="h-4 w-4 text-primary" /><span className="text-sm text-muted-foreground">QR actif encore</span><span className="font-mono text-lg font-bold text-foreground">{kiosk.countdown}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin text-secondary" />En attente de la confirmation sécurisée…</div>
                  {kiosk.publicCode && <div className="font-mono text-xs tracking-[0.16em] text-muted-foreground">{kiosk.publicCode}</div>}
                  <Button variant="ghost" onClick={kiosk.reset} className="rounded-full"><X className="mr-2 h-4 w-4" />Annuler</Button>
                </div>
              </motion.section>
            )}

            {kiosk.phase === "waitpay" && (
              <Stage key="waitpay" className="items-center text-center">
                <div className="relative grid h-40 w-40 place-items-center rounded-full border border-secondary/25 bg-secondary/10">
                  <div className="absolute inset-[-18px] rounded-full border border-secondary/20 animate-pulse" />
                  <BatteryCharging className="h-16 w-16 text-secondary" />
                </div>
                <div className="max-w-2xl">
                  <p className="text-xs font-semibold uppercase tracking-[0.28em] text-secondary">Paiement confirmé</p>
                  <h2 className="mt-3 font-display text-4xl font-extrabold sm:text-5xl">{kiosk.statusMsg?.title ?? "Préparation de votre batterie"}</h2>
                  <p className="mt-4 text-xl text-muted-foreground">{kiosk.statusMsg?.sub ?? "La borne choisit un compartiment disponible."}</p>
                </div>
                <div className="w-full max-w-lg"><FlowSteps active={2} /></div>
              </Stage>
            )}

            {kiosk.phase === "success" && (
              <Stage key="success" className="items-center text-center">
                <div className="kiosk-v2-slot-beacon">
                  <div className="relative z-10"><p className="text-xs font-bold uppercase tracking-[0.3em] text-success">Compartiment</p><div className="font-display text-7xl font-extrabold text-success">{kiosk.slotNum ?? "OUVERT"}</div></div>
                </div>
                <div className="max-w-2xl">
                  <div className="mx-auto mb-4 inline-flex items-center gap-2 rounded-full border border-success/30 bg-success/10 px-4 py-2 text-sm font-semibold text-success"><CheckCircle2 className="h-4 w-4" />Location démarrée</div>
                  <h2 className="font-display text-5xl font-extrabold">Prenez votre batterie.</h2>
                  <p className="mt-4 text-xl text-muted-foreground">{kiosk.slotNum ? `Retirez-la dans le compartiment n° ${kiosk.slotNum}.` : "Retirez-la dans le compartiment qui vient de s'ouvrir."}</p>
                </div>
                <Button onClick={kiosk.reset} variant="ghost" className="rounded-full text-muted-foreground"><RefreshCw className="mr-2 h-4 w-4" />Retour à l'accueil</Button>
              </Stage>
            )}

            {kiosk.phase === "expired" && (
              <Stage key="expired" className="items-center text-center">
                <div className="grid h-28 w-28 place-items-center rounded-[2rem] border border-warning/30 bg-warning/10"><Clock3 className="h-12 w-12 text-warning" /></div>
                <div><p className="text-xs font-semibold uppercase tracking-[0.28em] text-warning">Temps écoulé</p><h2 className="mt-3 font-display text-4xl font-extrabold">Ce QR code a expiré</h2><p className="mt-3 text-lg text-muted-foreground">Aucun paiement tardif ne déclenchera la borne. Générez un nouveau QR code.</p></div>
                <Button onClick={() => kiosk.setPhase("pricing")} className="kiosk-v2-cta h-14 rounded-full px-8 font-bold"><RefreshCw className="mr-2 h-5 w-5" />Nouveau QR code</Button>
              </Stage>
            )}

            {(kiosk.phase === "error" || kiosk.phase === "support") && (
              <Stage key="error" className="items-center text-center">
                <div className={`grid h-28 w-28 place-items-center rounded-[2rem] border ${kiosk.phase === "support" ? "border-warning/30 bg-warning/10" : "border-destructive/30 bg-destructive/10"}`}>
                  <AlertTriangle className={`h-12 w-12 ${kiosk.phase === "support" ? "text-warning" : "text-destructive"}`} />
                </div>
                <div className="max-w-2xl"><p className="text-xs font-semibold uppercase tracking-[0.28em] text-muted-foreground">Protection Chargeurs.ch</p><h2 className="mt-3 font-display text-4xl font-extrabold">{kiosk.statusMsg?.title ?? "Une opération n'a pas pu aboutir"}</h2><p className="mt-4 text-xl text-muted-foreground">{kiosk.statusMsg?.sub ?? "Aucun débit non confirmé ne doit déclencher une batterie."}</p></div>
                <Button onClick={kiosk.reset} className="kiosk-v2-cta h-14 rounded-full px-9 font-bold">Revenir à l'accueil</Button>
              </Stage>
            )}
          </AnimatePresence>
        </main>

        <footer className="relative z-10 flex items-center justify-between gap-4 border-t border-white/[0.07] py-3 text-[11px] text-muted-foreground">
          <span>© Chargeurs.ch · énergie nomade en Suisse</span>
          <span className="font-mono">Kiosk 2 · {stationId ?? "station"}</span>
        </footer>
      </div>
    </div>
  );
}

function Stage({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <motion.section initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -14 }} transition={transition} className={`flex flex-col justify-center gap-7 ${className}`}>{children}</motion.section>;
}

function Metric({ label, value, accent = false, className = "" }: { label: string; value: string; accent?: boolean; className?: string }) {
  return <div className={`kiosk-v2-panel rounded-2xl p-4 ${className}`}><div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">{label}</div><div className={`mt-1 font-display text-xl font-extrabold ${accent ? "text-secondary" : "text-foreground"}`}>{value}</div></div>;
}

function PriceLine({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return <div className="flex items-center justify-between gap-4"><span className="text-muted-foreground">{label}</span><span className={strong ? "font-bold text-foreground" : "font-semibold text-foreground/90"}>{value}</span></div>;
}

function PaymentChip({ icon, label }: { icon: React.ReactNode; label: string }) {
  return <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-2">{icon}{label}</span>;
}

function HelpOverlay({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-background/85 p-5 backdrop-blur-xl">
      <motion.div initial={{ opacity: 0, scale: .96 }} animate={{ opacity: 1, scale: 1 }} className="kiosk-v2-panel w-full max-w-2xl rounded-[2rem] p-7 sm:p-10">
        <div className="flex items-start justify-between gap-5"><div><p className="text-xs font-semibold uppercase tracking-[0.28em] text-secondary">Mode d'emploi</p><h2 className="mt-2 font-display text-3xl font-extrabold">Une batterie en trois gestes</h2></div><button onClick={onClose} aria-label="Fermer" className="rounded-full border border-white/10 p-2.5 text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button></div>
        <div className="mt-8 grid gap-3 sm:grid-cols-3">
          <HelpStep number="01" title="Choisissez" text="Touchez le bouton de location et vérifiez le tarif." />
          <HelpStep number="02" title="Scannez" text="Payez sur votre propre téléphone via le QR sécurisé." />
          <HelpStep number="03" title="Emportez" text="Prenez la batterie dans le compartiment indiqué." />
        </div>
        <div className="mt-7 rounded-2xl border border-white/10 bg-white/[0.035] p-5 text-sm text-muted-foreground">Vous pourrez restituer la batterie dans une borne compatible du réseau. Assistance : <span className="font-semibold text-foreground">support@chargeurs.ch</span></div>
        <Button onClick={onClose} className="kiosk-v2-cta mt-7 h-14 w-full rounded-2xl font-bold">J'ai compris</Button>
      </motion.div>
    </div>
  );
}

function HelpStep({ number, title, text }: { number: string; title: string; text: string }) {
  return <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-5"><div className="font-mono text-xs font-bold text-primary">{number}</div><h3 className="mt-3 font-display text-lg font-bold">{title}</h3><p className="mt-2 text-sm leading-relaxed text-muted-foreground">{text}</p></div>;
}
