import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import {
  ArrowLeft,
  BadgePercent,
  CheckCircle2,
  Clock3,
  Crown,
  HelpCircle,
  Loader2,
  RefreshCw,
  ShieldCheck,
  UserRound,
  WalletCards,
  X,
  Zap,
} from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { KioskPaymentMarks } from "@/components/kiosk/KioskPaymentMarks";
import { useI18n } from "@/i18n/i18n";
import Kiosk from "./Kiosk";
import { readKioskToken } from "@/lib/kioskFetch";
import {
  invokeKioskEdgeProxy,
  KIOSK_JOURNEY_STORAGE_KEY,
  KIOSK_PAIRING_STORAGE_KEY,
} from "@/lib/kioskEdgeProxy";
import { rentalProgressUrl } from "@/lib/rentalProgressLink";
import "./kiosk-premium-v2.css";

type PricingTier = {
  upper_minutes: number;
  total_cents: number;
};

type SegmentPrice = {
  segment: "guest" | "member";
  currency: string;
  hourly_cents: number | null;
  daily_cap_cents: number;
  deposit_cents?: number | null;
  tiered?: boolean;
  tiers?: PricingTier[];
  starting_cents?: number | null;
  total_cap_cents?: number | null;
  period_minutes?: number | null;
  price_per_period_cents?: number | null;
};

type MembershipPlan = {
  id?: string;
  code?: string;
  name?: string;
  currency?: string;
  annual_fee_cents?: number | null;
  renewal_credit_cents?: number | null;
  hourly_cents?: number | null;
  daily_cap_cents?: number | null;
  valid_from?: string | null;
  valid_to?: string | null;
};

type CustomerOptions = {
  ok?: boolean;
  guest?: SegmentPrice;
  member?: SegmentPrice | null;
  memberAvailable?: boolean;
  membershipPlan?: MembershipPlan | null;
};

type PairingCreate = {
  ok?: boolean;
  pairingId?: string;
  connectPath?: string;
  expiresAt?: string;
  error?: string;
};

type MemberSummary = {
  planCode?: string;
  planName?: string;
  currency?: string;
  hourlyCents?: number | null;
  dailyCapCents?: number | null;
  includedMinutes?: number | null;
  renewalCreditCents?: number | null;
  renewsAt?: string | null;
  walletPassActive?: boolean;
  walletProviderStatus?: string;
};

type PairingStatus = {
  ok?: boolean;
  state?: string;
  connected?: boolean;
  displayName?: string;
  preferredLanguage?: string | null;
  segment?: string;
  member?: MemberSummary | null;
};

type ResumeResponse = {
  ok?: boolean;
  active?: boolean;
  state?: string | null;
  kioskActionRequired?: boolean;
  session?: ResumeSession | null;
};

type ResumeSession = {
  id: string;
  publicCode: string | null;
  state: string;
  selectedSlotNum: number | null;
};

type Stage = "hero" | "guest-pricing" | "member-pricing" | "member" | "connected" | "guest";

type Copy = {
  refresh: string;
  help: string;
  cancel: string;
  returnHome: string;
  back: string;
  connectedKicker: string;
  connectedTitle: string;
  connectedSubtitle: string;
  connectedBenefits: string;
  connectedRate: string;
  connectedCap: string;
  connectedMinutes: string;
  connectedWallet: string;
  connectedWalletLocal: string;
  connectedCta: string;
  connectedCtaSub: string;
  memberEyebrow: string;
  memberTitle: string;
  memberTitleAccent: string;
  memberPrivacy: string;
  memberRateLabel: string;
  memberScan: string;
  memberError: string;
  retry: string;
  homeTitle: string;
  homeSubtitle: string;
  priceFrom: string;
  priceUpTo: string;
  priceTotalCap: string;
  pricingUnavailable: string;
  perHour: string;
  dailyCap: string;
  expressKicker: string;
  expressTitle: string;
  expressBody: string;
  clientKicker: string;
  clientTitle: string;
  clientBody: string;
  cabinetTitle: string;
  cabinetSub: string;
  secure: string;
  expressPricingKicker: string;
  expressPricingTitle: string;
  expressPricingLead: string;
  guaranteeTitle: string;
  guaranteeBody: string;
  guaranteePending: string;
  continueExpress: string;
  discoverPlus: string;
  totalRentalCap: string;
  totalRentalCapBody: string;
  plusKicker: string;
  plusTitle: string;
  plusLead: string;
  passPrice: string;
  memberPrice: string;
  renewalCredit: string;
  potentialSaving: string;
  savingExample: string;
  savingDisclaimer: string;
  alreadyMember: string;
  becomePlus: string;
  becomePlusBody: string;
  expressInstead: string;
  memberUnavailable: string;
};

const COPY: Record<"fr" | "en" | "de", Copy> = {
  fr: {
    refresh: "Actualiser", help: "FAQ / Aide", cancel: "Annuler", returnHome: "Retour accueil", back: "Retour",
    connectedKicker: "PASS RECONNU", connectedTitle: "CONNEXION RÉUSSIE", connectedSubtitle: "Vos avantages Client Chargeurs actifs sont chargés depuis votre compte.",
    connectedBenefits: "Vos avantages actifs", connectedRate: "Tarif membre", connectedCap: "Plafond journalier", connectedMinutes: "Minutes incluses", connectedWallet: "Pass Wallet", connectedWalletLocal: "Pass compte actif",
    connectedCta: "COMMENCER UNE LOCATION", connectedCtaSub: "Choisissez ensuite votre batterie sur cette borne.",
    memberEyebrow: "CLIENT CHARGEURS", memberTitle: "Scannez avec", memberTitleAccent: "votre téléphone", memberPrivacy: "Connexion temporaire et sécurisée. Aucune donnée personnelle n’est saisie sur la borne.",
    memberRateLabel: "Tarif Client Chargeurs", memberScan: "Ouvrez l’appareil photo de votre téléphone et scannez le QR code.", memberError: "Connexion temporairement indisponible", retry: "Réessayer",
    homeTitle: "Comment souhaitez-vous louer ?", homeSubtitle: "Deux parcours simples. Choisissez celui qui vous convient.", priceFrom: "Dès", priceUpTo: "jusqu’à", priceTotalCap: "plafond total", pricingUnavailable: "Tarif en cours de chargement", perHour: "/ heure", dailyCap: "Plafond journalier",
    expressKicker: "SANS COMPTE", expressTitle: "Location express", expressBody: "Louez tout de suite. Paiement sur votre téléphone.",
    clientKicker: "CLIENT CHARGEURS", clientTitle: "Tarif client", clientBody: "Connectez votre compte avec l’app et profitez du meilleur tarif.",
    cabinetTitle: "Batteries disponibles", cabinetSub: "Sélection automatique de la meilleure batterie", secure: "Connexion sécurisée",
    expressPricingKicker: "EXPRESS · SANS COMPTE", expressPricingTitle: "Vous connaissez le prix avant de louer.", expressPricingLead: "Le prix monte uniquement lorsque vous franchissez un palier. Le montant exact est recalculé au retour à partir du tarif serveur affiché ici.",
    guaranteeTitle: "Garantie séparée du prix de location", guaranteeBody: "Selon le moyen de paiement, la garantie est réservée temporairement ou débitée puis régularisée. Elle n’est pas le prix de votre location.", guaranteePending: "Le montant de la garantie sera confirmé avant le paiement.",
    continueExpress: "CONTINUER EN EXPRESS", discoverPlus: "Voir Chargeurs+", totalRentalCap: "Plafond total de location", totalRentalCapBody: "Même sur une longue location, le tarif de location est plafonné selon le contrat actif.",
    plusKicker: "CHARGEURS+ · PASS CLIENT", plusTitle: "Louez moins cher quand votre usage s’y prête.", plusLead: "Le Pass et le tarif membre ci-dessous viennent du backend Chargeurs.ch. L’économie dépend de la durée de chaque location et de votre fréquence d’utilisation.",
    passPrice: "Pass / 12 mois", memberPrice: "Tarif membre", renewalCredit: "Crédit adhésion / renouvellement", potentialSaving: "Économie potentielle", savingExample: "Exemple", savingDisclaimer: "Économie sur le prix de la location uniquement, avant prise en compte du prix annuel du Pass.",
    alreadyMember: "J’AI DÉJÀ UN PASS", becomePlus: "DEVENIR CHARGEURS+", becomePlusBody: "Scannez avec votre téléphone pour créer/ouvrir votre compte puis activer le Pass Chargeurs+.", expressInstead: "Continuer sans compte", memberUnavailable: "La connexion membre est momentanément indisponible, mais vous pouvez consulter l’offre Chargeurs+.",
  },
  en: {
    refresh: "Refresh", help: "FAQ / Help", cancel: "Cancel", returnHome: "Back home", back: "Back",
    connectedKicker: "PASS RECOGNISED", connectedTitle: "CONNECTION SUCCESSFUL", connectedSubtitle: "Your active Chargeurs member benefits are loaded from your account.",
    connectedBenefits: "Your active benefits", connectedRate: "Member rate", connectedCap: "Daily cap", connectedMinutes: "Included minutes", connectedWallet: "Wallet Pass", connectedWalletLocal: "Account Pass active",
    connectedCta: "START A RENTAL", connectedCtaSub: "Choose your powerbank next on this kiosk.",
    memberEyebrow: "CHARGEURS MEMBER", memberTitle: "Scan with", memberTitleAccent: "your phone", memberPrivacy: "Temporary, secure connection. No personal data is entered on the station.",
    memberRateLabel: "Chargeurs member rate", memberScan: "Open your phone camera and scan the QR code.", memberError: "Connection temporarily unavailable", retry: "Try again",
    homeTitle: "How would you like to rent?", homeSubtitle: "Two simple journeys. Choose the one that suits you.", priceFrom: "From", priceUpTo: "up to", priceTotalCap: "total cap", pricingUnavailable: "Loading price", perHour: "/ hour", dailyCap: "Daily cap",
    expressKicker: "NO ACCOUNT", expressTitle: "Express rental", expressBody: "Rent now. Pay on your phone.",
    clientKicker: "CHARGEURS MEMBER", clientTitle: "Member rate", clientBody: "Connect your account in the app and enjoy your best available rate.",
    cabinetTitle: "Batteries available", cabinetSub: "Best battery selected automatically", secure: "Secure connection",
    expressPricingKicker: "EXPRESS · NO ACCOUNT", expressPricingTitle: "Know the price before you rent.", expressPricingLead: "The price only increases when you cross a tier. The exact amount is recalculated on return from the server tariff shown here.",
    guaranteeTitle: "Guarantee separate from rental price", guaranteeBody: "Depending on the payment method, the guarantee is temporarily authorised or charged then adjusted. It is not your rental price.", guaranteePending: "The guarantee amount will be confirmed before payment.",
    continueExpress: "CONTINUE EXPRESS", discoverPlus: "See Chargeurs+", totalRentalCap: "Total rental cap", totalRentalCapBody: "Even on a long rental, the rental price is capped under the active contract.",
    plusKicker: "CHARGEURS+ · MEMBER PASS", plusTitle: "Pay less when your usage fits the member tariff.", plusLead: "The Pass and member prices below come from the Chargeurs.ch backend. Savings depend on each rental duration and how often you use it.",
    passPrice: "Pass / 12 months", memberPrice: "Member price", renewalCredit: "Membership / renewal credit", potentialSaving: "Potential saving", savingExample: "Example", savingDisclaimer: "Saving on rental price only, before the annual Pass price is taken into account.",
    alreadyMember: "I ALREADY HAVE A PASS", becomePlus: "GET CHARGEURS+", becomePlusBody: "Scan with your phone to create/open your account and activate Chargeurs+.", expressInstead: "Continue without account", memberUnavailable: "Member connection is temporarily unavailable, but you can still review the Chargeurs+ offer.",
  },
  de: {
    refresh: "Aktualisieren", help: "FAQ / Hilfe", cancel: "Abbrechen", returnHome: "Zur Startseite", back: "Zurück",
    connectedKicker: "PASS ERKANNT", connectedTitle: "VERBINDUNG ERFOLGREICH", connectedSubtitle: "Ihre aktiven Chargeurs-Kundenvorteile werden aus Ihrem Konto geladen.",
    connectedBenefits: "Ihre aktiven Vorteile", connectedRate: "Kundentarif", connectedCap: "Tageslimit", connectedMinutes: "Inklusive Minuten", connectedWallet: "Wallet Pass", connectedWalletLocal: "Konto-Pass aktiv",
    connectedCta: "MIETE STARTEN", connectedCtaSub: "Wählen Sie anschließend Ihre Powerbank an dieser Station.",
    memberEyebrow: "CHARGEURS KUNDE", memberTitle: "Scanne mit", memberTitleAccent: "deinem Smartphone", memberPrivacy: "Temporäre, sichere Verbindung. Auf der Station werden keine persönlichen Daten eingegeben.",
    memberRateLabel: "Chargeurs-Kundentarif", memberScan: "Öffne die Kamera deines Smartphones und scanne den QR-Code.", memberError: "Verbindung vorübergehend nicht verfügbar", retry: "Erneut versuchen",
    homeTitle: "Wie möchten Sie mieten?", homeSubtitle: "Zwei einfache Wege. Wählen Sie den passenden.", priceFrom: "Ab", priceUpTo: "bis", priceTotalCap: "Gesamtlimit", pricingUnavailable: "Preis wird geladen", perHour: "/ Stunde", dailyCap: "Tageslimit",
    expressKicker: "OHNE KONTO", expressTitle: "Express-Miete", expressBody: "Sofort mieten. Auf dem Smartphone bezahlen.",
    clientKicker: "CHARGEURS KUNDE", clientTitle: "Kundentarif", clientBody: "Konto mit der App verbinden und den besten verfügbaren Tarif nutzen.",
    cabinetTitle: "Verfügbare Batterien", cabinetSub: "Beste Batterie wird automatisch gewählt", secure: "Sichere Verbindung",
    expressPricingKicker: "EXPRESS · OHNE KONTO", expressPricingTitle: "Sie kennen den Preis vor der Miete.", expressPricingLead: "Der Preis steigt nur beim Überschreiten einer Stufe. Der genaue Betrag wird bei der Rückgabe anhand des hier gezeigten Servertarifs berechnet.",
    guaranteeTitle: "Garantie getrennt vom Mietpreis", guaranteeBody: "Je nach Zahlungsmittel wird die Garantie vorübergehend reserviert oder belastet und danach angepasst. Sie ist nicht der Mietpreis.", guaranteePending: "Der Garantiebetrag wird vor der Zahlung bestätigt.",
    continueExpress: "EXPRESS FORTSETZEN", discoverPlus: "Chargeurs+ ansehen", totalRentalCap: "Gesamtlimit der Miete", totalRentalCapBody: "Auch bei längerer Miete bleibt der Mietpreis gemäss aktivem Vertrag begrenzt.",
    plusKicker: "CHARGEURS+ · KUNDENPASS", plusTitle: "Günstiger mieten, wenn Ihr Nutzungsprofil passt.", plusLead: "Pass und Kundentarif werden direkt aus dem Chargeurs.ch-Backend geladen. Die Ersparnis hängt von Mietdauer und Nutzungshäufigkeit ab.",
    passPrice: "Pass / 12 Monate", memberPrice: "Kundentarif", renewalCredit: "Mitgliedschafts-/Verlängerungsguthaben", potentialSaving: "Mögliche Ersparnis", savingExample: "Beispiel", savingDisclaimer: "Ersparnis nur auf den Mietpreis, vor Berücksichtigung des jährlichen Passpreises.",
    alreadyMember: "ICH HABE SCHON EINEN PASS", becomePlus: "CHARGEURS+ WERDEN", becomePlusBody: "Mit dem Smartphone scannen, Konto erstellen/öffnen und Chargeurs+ aktivieren.", expressInstead: "Ohne Konto fortfahren", memberUnavailable: "Die Kundenverbindung ist vorübergehend nicht verfügbar. Das Chargeurs+-Angebot kann trotzdem angesehen werden.",
  },
};

const KIOSK_RESUMABLE_STATES = new Set(["created", "checkout_created", "payment_pending", "payment_succeeded", "ejecting", "ejected", "battery_taken"]);
const money = (cents: number | null | undefined, currency = "CHF") => cents == null || !Number.isFinite(Number(cents)) ? "—" : `${(Number(cents) / 100).toFixed(2)} ${currency}`;

function durationLabel(minutes: number, lang: "fr" | "en" | "de") {
  if (minutes % 1440 === 0) {
    const days = minutes / 1440;
    return lang === "de" ? `${days} Tag${days > 1 ? "e" : ""}` : lang === "en" ? `${days} day${days > 1 ? "s" : ""}` : `${days} jour${days > 1 ? "s" : ""}`;
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return lang === "de" ? `${hours} Std.` : `${hours} h`;
  }
  return `${minutes} min`;
}

function sortedPricingTiers(price: SegmentPrice | null | undefined) {
  if (!Array.isArray(price?.tiers)) return [];
  return price.tiers
    .filter((tier) => Number.isFinite(tier.upper_minutes) && tier.upper_minutes > 0 && Number.isFinite(tier.total_cents) && tier.total_cents > 0)
    .sort((a, b) => a.upper_minutes - b.upper_minutes);
}

function hasUsableGuestPricing(price: SegmentPrice | null | undefined) {
  const tiers = sortedPricingTiers(price);
  if (price?.tiered === true) {
    const hasDayTier = tiers.some((tier) => tier.upper_minutes === 1440);
    return tiers.length >= 2 && hasDayTier && Number(price.total_cap_cents ?? 0) > 0;
  }
  return Number(price?.hourly_cents ?? 0) > 0 && Number(price?.daily_cap_cents ?? 0) > 0;
}

function hasUsableMemberPricing(price: SegmentPrice | null | undefined) {
  if (!price || String(price.currency ?? "").toUpperCase() !== "CHF") return false;
  const tiers = sortedPricingTiers(price);
  if (price.tiered === true) return tiers.length > 0;
  return Number(price.hourly_cents ?? 0) > 0 && Number(price.daily_cap_cents ?? 0) > 0;
}

function bestMemberSaving(guest: SegmentPrice | null | undefined, plan: MembershipPlan | null | undefined) {
  const hourly = Number(plan?.hourly_cents ?? 0);
  const dailyCap = Number(plan?.daily_cap_cents ?? 0);
  if (hourly <= 0) return null;
  const candidates = sortedPricingTiers(guest)
    .filter((tier) => tier.upper_minutes > 0 && tier.upper_minutes <= 1440)
    .map((tier) => {
      const periods = Math.max(1, Math.ceil(tier.upper_minutes / 60));
      const rawMemberCost = periods * hourly;
      const memberCost = dailyCap > 0 ? Math.min(rawMemberCost, dailyCap) : rawMemberCost;
      const saving = tier.total_cents - memberCost;
      const percent = tier.total_cents > 0 ? Math.round((saving / tier.total_cents) * 100) : 0;
      return { minutes: tier.upper_minutes, guestCents: tier.total_cents, memberCents: memberCost, savingCents: saving, percent };
    })
    .filter((row) => row.savingCents > 0 && row.percent > 0)
    .sort((a, b) => b.percent - a.percent || b.savingCents - a.savingCents);
  return candidates[0] ?? null;
}

export default function KioskPremiumGateV2() {
  const { stationId = "" } = useParams();
  const { lang } = useI18n();
  const copy = COPY[lang];
  const [stage, setStage] = useState<Stage>("hero");
  const [options, setOptions] = useState<CustomerOptions | null>(null);
  const [pairing, setPairing] = useState<PairingCreate | null>(null);
  const [pairingError, setPairingError] = useState<string | null>(null);
  const [connectedInfo, setConnectedInfo] = useState<PairingStatus | null>(null);
  const [checking, setChecking] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [seconds, setSeconds] = useState(35);
  const [journeyProtected, setJourneyProtected] = useState(false);
  const [resumeSession, setResumeSession] = useState<ResumeSession | null>(null);

  const memberPricingReady = Boolean(options?.memberAvailable && hasUsableMemberPricing(options?.member));
  const memberOfferReady = Boolean(options?.membershipPlan || options?.memberAvailable);

  const loadOptions = useCallback(async () => {
    const token = readKioskToken();
    if (!token || !stationId) return;
    const { data } = await invokeKioskEdgeProxy<CustomerOptions>("/api/kiosk/customer-options", { stationId }, { "X-Kiosk-Token": token });
    if (data?.ok) setOptions(data);
  }, [stationId]);

  const refreshOptions = useCallback(async () => {
    setRefreshing(true);
    try { await loadOptions(); } finally { setRefreshing(false); }
  }, [loadOptions]);

  const returnHome = useCallback(() => {
    if (document.querySelector('.kiosk-release-stage:not([data-kiosk-timeout-owner="inner"])')) return;
    try {
      sessionStorage.removeItem(KIOSK_JOURNEY_STORAGE_KEY);
      sessionStorage.removeItem(KIOSK_PAIRING_STORAGE_KEY);
    } catch { /* noop */ }
    delete document.documentElement.dataset.kioskJourney;
    setPairing(null);
    setPairingError(null);
    setConnectedInfo(null);
    setSeconds(35);
    setStage("hero");
    void loadOptions();
  }, [loadOptions]);

  useEffect(() => {
    const handleReturnHome = () => returnHome();
    window.addEventListener("chargeurs:kiosk-return-home", handleReturnHome);
    return () => window.removeEventListener("chargeurs:kiosk-return-home", handleReturnHome);
  }, [returnHome]);

  useEffect(() => {
    document.documentElement.classList.add("kiosk-mode");
    return () => {
      document.documentElement.classList.remove("kiosk-mode");
      delete document.documentElement.dataset.kioskJourney;
    };
  }, []);

  useEffect(() => {
    if (stage === "hero") delete document.documentElement.dataset.kioskJourney;
    if (stage === "guest-pricing") document.documentElement.dataset.kioskJourney = "express";
    if (stage === "member-pricing" || stage === "member" || stage === "connected") document.documentElement.dataset.kioskJourney = "client";
  }, [stage]);

  useEffect(() => {
    let cancelled = false;
    const boot = async () => {
      const token = readKioskToken();
      if (!token || !stationId) { setChecking(false); return; }
      const { data } = await invokeKioskEdgeProxy<ResumeResponse>("/api/kiosk/resume-state", { stationId }, { "X-Kiosk-Token": token });
      if (cancelled) return;
      // kiosk-resume-state returns the lifecycle state inside `session`. The
      // legacy top-level field is kept only for backwards compatibility.
      const state = data?.session?.state ?? data?.state ?? null;
      const mustResume = Boolean(data?.ok && data.active && (data.kioskActionRequired === true || (state && KIOSK_RESUMABLE_STATES.has(state))));
      if (mustResume) {
        try {
          const journey = sessionStorage.getItem(KIOSK_JOURNEY_STORAGE_KEY);
          if (journey === "member") document.documentElement.dataset.kioskJourney = "client";
          if (journey === "guest") document.documentElement.dataset.kioskJourney = "express";
        } catch { /* noop */ }
        setResumeSession(data?.session ?? null);
        setStage("guest");
        setChecking(false);
        return;
      }
      setResumeSession(null);
      try {
        sessionStorage.removeItem(KIOSK_JOURNEY_STORAGE_KEY);
        sessionStorage.removeItem(KIOSK_PAIRING_STORAGE_KEY);
      } catch { /* noop */ }
      delete document.documentElement.dataset.kioskJourney;
      await loadOptions();
      if (!cancelled) { setStage("hero"); setChecking(false); }
    };
    void boot();
    return () => { cancelled = true; };
  }, [loadOptions, stationId]);

  useEffect(() => {
    if (!resumeSession || !stationId) return;
    let cancelled = false;
    const poll = async () => {
      const token = readKioskToken();
      if (!token) return;
      if (resumeSession.state === "ejecting" && resumeSession.publicCode) {
        await invokeKioskEdgeProxy(
          "/api/kiosk/reconcile-pending-ejection",
          { stationId, rentalSessionId: resumeSession.id, publicCode: resumeSession.publicCode },
          { "X-Kiosk-Token": token },
        );
      }
      const { data } = await invokeKioskEdgeProxy<ResumeResponse>(
        "/api/kiosk/resume-state",
        { stationId },
        { "X-Kiosk-Token": token },
      );
      if (cancelled) return;
      setResumeSession(data?.ok && data.active && data.session ? data.session : null);
    };
    void poll();
    const interval = window.setInterval(() => void poll(), 2500);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [resumeSession, stationId]);

  useEffect(() => {
    try {
      const native = window as Window & { ChargeursNative?: { kioskUiReady?: () => void } };
      native.ChargeursNative?.kioskUiReady?.();
    } catch { /* browser preview */ }
  }, [checking, stage]);

  useEffect(() => {
    if (stage !== "guest") { setJourneyProtected(false); return; }
    const inspect = () => setJourneyProtected(Boolean(document.querySelector(".kiosk-release-stage")));
    inspect();
    const observer = new MutationObserver(inspect);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [stage]);

  const timerActive = !checking && stage !== "hero" && !journeyProtected;
  useEffect(() => {
    if (!timerActive) { setSeconds(35); return; }
    setSeconds(35);
    const activity = () => setSeconds(35);
    const interval = window.setInterval(() => setSeconds((value) => Math.max(0, value - 1)), 1000);
    window.addEventListener("pointerdown", activity, { passive: true });
    window.addEventListener("keydown", activity);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("pointerdown", activity);
      window.removeEventListener("keydown", activity);
    };
  }, [timerActive, stage]);

  useEffect(() => { if (timerActive && seconds === 0) returnHome(); }, [seconds, timerActive, returnHome]);

  const openGuestPricing = () => {
    document.documentElement.dataset.kioskJourney = "express";
    setSeconds(35);
    setStage("guest-pricing");
  };

  const continueGuest = () => {
    try {
      sessionStorage.setItem(KIOSK_JOURNEY_STORAGE_KEY, "guest");
      sessionStorage.removeItem(KIOSK_PAIRING_STORAGE_KEY);
    } catch { /* noop */ }
    document.documentElement.dataset.kioskJourney = "express";
    setSeconds(35);
    setStage("guest");
  };

  const openMemberPricing = () => {
    document.documentElement.dataset.kioskJourney = "client";
    setSeconds(35);
    setStage("member-pricing");
  };

  const startMember = async () => {
    const token = readKioskToken();
    if (!token || !stationId || !memberPricingReady) return;
    setPairingError(null);
    setPairing(null);
    setConnectedInfo(null);
    document.documentElement.dataset.kioskJourney = "client";
    setSeconds(35);
    setStage("member");
    const { data, transportError } = await invokeKioskEdgeProxy<PairingCreate>("/api/kiosk/customer-pairing-create", { stationId }, { "X-Kiosk-Token": token });
    if (transportError || !data?.ok || !data.pairingId || !data.connectPath || !data.expiresAt) {
      setPairingError(data?.error ?? "PAIRING_CREATE_FAILED");
      return;
    }
    setPairing(data);
  };

  useEffect(() => {
    if (stage !== "member" || !pairing?.pairingId) return;
    const token = readKioskToken();
    if (!token) return;
    let cancelled = false;
    const poll = async () => {
      const { data } = await invokeKioskEdgeProxy<PairingStatus>("/api/kiosk/customer-pairing-status", { stationId, pairingId: pairing.pairingId }, { "X-Kiosk-Token": token });
      if (cancelled || !data?.ok) return;
      if (data.state === "expired") { setPairingError("PAIRING_EXPIRED"); return; }
      if (!data.connected) return;
      try {
        sessionStorage.setItem(KIOSK_JOURNEY_STORAGE_KEY, "member");
        sessionStorage.setItem(KIOSK_PAIRING_STORAGE_KEY, pairing.pairingId!);
      } catch { /* server remains authoritative */ }
      document.documentElement.dataset.kioskJourney = "client";
      setConnectedInfo(data);
      setStage("connected");
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 900);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [pairing?.pairingId, stage, stationId]);

  const continueMember = () => {
    if (!pairing?.pairingId || !connectedInfo?.connected) return;
    try {
      sessionStorage.setItem(KIOSK_JOURNEY_STORAGE_KEY, "member");
      sessionStorage.setItem(KIOSK_PAIRING_STORAGE_KEY, pairing.pairingId);
    } catch { /* server remains authoritative */ }
    document.documentElement.dataset.kioskJourney = "client";
    setSeconds(35);
    setStage("guest");
  };

  const journeyControl = timerActive ? (
    <div className="ck2-journey-control" role="status" aria-live="polite">
      <Clock3 aria-hidden="true" /><span>{copy.returnHome}</span><strong>{seconds}s</strong>
      <button type="button" onClick={returnHome} aria-label={copy.cancel}><X aria-hidden="true" /> {copy.cancel}</button>
    </div>
  ) : null;

  const guestCurrency = options?.guest?.currency ?? "CHF";
  const guestTiers = sortedPricingTiers(options?.guest);
  const firstGuestTier = guestTiers[0];
  const dayGuestTier = guestTiers.find((tier) => tier.upper_minutes === 1440) ?? guestTiers[guestTiers.length - 1];
  const guestTieredReady = options?.guest?.tiered === true && Boolean(firstGuestTier && dayGuestTier);
  const guestHourlyReady = Number(options?.guest?.hourly_cents ?? 0) > 0 && Number(options?.guest?.daily_cap_cents ?? 0) > 0;
  const guestPricingReady = hasUsableGuestPricing(options?.guest);
  const guestPrimaryPrice = guestTieredReady && firstGuestTier
    ? `${copy.priceFrom} ${money(firstGuestTier.total_cents, guestCurrency)} / ${durationLabel(firstGuestTier.upper_minutes, lang)}`
    : guestHourlyReady
      ? `${money(options?.guest?.hourly_cents, guestCurrency)} ${copy.perHour}`
      : copy.pricingUnavailable;
  const guestTotalCapCents = Number(options?.guest?.total_cap_cents ?? 0);
  const guestDepositCents = Number(options?.guest?.deposit_cents ?? 0);
  const membershipPlan = options?.membershipPlan ?? null;
  const membershipCurrency = membershipPlan?.currency ?? options?.member?.currency ?? "CHF";
  const memberTiers = sortedPricingTiers(options?.member);
  const firstMemberTier = memberTiers[0];
  const memberHomePrice = memberPricingReady && options?.member?.tiered === true && firstMemberTier
    ? `${copy.priceFrom} ${money(firstMemberTier.total_cents, options?.member?.currency ?? "CHF")} / ${durationLabel(firstMemberTier.upper_minutes, lang)}`
    : memberPricingReady && Number(options?.member?.hourly_cents ?? 0) > 0
      ? `${money(options?.member?.hourly_cents, options?.member?.currency ?? "CHF")} ${copy.perHour}`
      : Number(membershipPlan?.hourly_cents ?? 0) > 0
        ? `${money(membershipPlan?.hourly_cents, membershipCurrency)} ${copy.perHour}`
        : lang === "fr" ? "Connectez-vous pour voir votre tarif" : lang === "de" ? "Anmelden, um Ihren Tarif zu sehen" : "Connect to see your rate";
  const footerDailyCapCents = guestTieredReady && dayGuestTier
    ? dayGuestTier.total_cents
    : Number(options?.guest?.daily_cap_cents ?? 0);
  const footerDailyCap = footerDailyCapCents > 0 ? money(footerDailyCapCents, guestCurrency) : "—";
  const footerDeposit = guestDepositCents > 0 ? money(guestDepositCents, guestCurrency) : "—";
  const memberSaving = useMemo(() => bestMemberSaving(options?.guest, membershipPlan), [options?.guest, membershipPlan]);
  const membershipUrl = useMemo(() => {
    const url = new URL("/compte/pass", window.location.origin);
    url.searchParams.set("source", "kiosk");
    if (stationId) url.searchParams.set("station", stationId);
    return url.toString();
  }, [stationId]);

  const resumeProgressUrl = resumeSession?.publicCode
    ? rentalProgressUrl(window.location.origin, resumeSession.id, resumeSession.publicCode, lang)
    : null;
  const resumeReleased = resumeSession && ["ejected", "active_rental", "battery_taken"].includes(resumeSession.state);
  const resumeTitle = resumeReleased
    ? (lang === "fr" ? "Votre batterie est prête" : lang === "de" ? "Ihre Powerbank ist bereit" : "Your powerbank is ready")
    : (lang === "fr" ? "Vérification de la sortie en cours" : lang === "de" ? "Ausgabe wird überprüft" : "Release verification in progress");
  const resumeBody = resumeReleased
    ? (lang === "fr" ? "Prenez votre batterie. Scannez le QR code pour suivre votre location sur votre téléphone." : lang === "de" ? "Nehmen Sie Ihre Powerbank. Scannen Sie den QR-Code, um Ihre Miete auf dem Telefon zu verfolgen." : "Take your powerbank. Scan the QR code to follow your rental on your phone.")
    : (lang === "fr" ? "Votre paiement est sécurisé. La borne vérifie la sortie physique avant d’activer la location." : lang === "de" ? "Ihre Zahlung ist gesichert. Die Station prüft die physische Ausgabe vor der Aktivierung." : "Your payment is secure. The kiosk verifies the physical release before activating the rental.");

  if (checking) return <div className="ck2-shell ck2-loading"><Loader2 className="ck2-spin" /></div>;

  if (resumeSession) {
    return (
      <div className="ck2-shell ck2-resume">
        <header className="ck2-topbar"><BrandLogo size="md" /><div className="ck2-language"><LanguageSwitcher /></div></header>
        <main className="ck2-resume-main">
          <section className="ck2-resume-card" aria-live="polite">
            {resumeReleased ? <CheckCircle2 className="ck2-resume-icon ck2-resume-icon--ready" /> : <Loader2 className="ck2-resume-icon ck2-spin" />}
            <p className="ck2-resume-kicker">{lang === "fr" ? "LOCATION EN COURS" : lang === "de" ? "MIETE LÄUFT" : "RENTAL IN PROGRESS"}</p>
            <h1>{resumeTitle}</h1>
            <p>{resumeBody}</p>
            {resumeSession.selectedSlotNum != null && <strong className="ck2-resume-slot">{lang === "fr" ? "Slot" : "Slot"} {resumeSession.selectedSlotNum}</strong>}
            {resumeProgressUrl && (
              <div className="ck2-resume-mobile">
                <div className="ck2-resume-qr"><QRCodeSVG value={resumeProgressUrl} size={150} level="M" bgColor="#ffffff" fgColor="#06111f" marginSize={1} /></div>
                <span>{lang === "fr" ? "Suivi et reçu sur votre téléphone" : lang === "de" ? "Status und Beleg auf Ihrem Telefon" : "Status and receipt on your phone"}</span>
              </div>
            )}
            {resumeReleased && <button type="button" className="ck2-resume-home" onClick={() => { setResumeSession(null); returnHome(); }}>{lang === "fr" ? "Retour à l’accueil" : lang === "de" ? "Zurück zur Startseite" : "Back to home"}</button>}
          </section>
        </main>
      </div>
    );
  }

  if (stage === "guest") return <><Kiosk />{journeyControl}</>;

  if (stage === "guest-pricing") {
    return (
      <div className="ck2-shell ck2-pricing-screen ck2-pricing-express">
        {journeyControl}
        <header className="ck2-topbar">
          <BrandLogo size="md" />
          <div className="ck2-top-actions"><LanguageSwitcher /><button type="button" className="ck2-pricing-back" onClick={returnHome}><ArrowLeft /> {copy.back}</button></div>
        </header>
        <main className="ck2-pricing-main">
          <section className="ck2-pricing-copy">
            <span className="ck2-pricing-kicker"><Zap /> {copy.expressPricingKicker}</span>
            <h1>{copy.expressPricingTitle}</h1>
            <p className="ck2-pricing-lead">{copy.expressPricingLead}</p>
            <div className="ck2-tier-grid">
              {guestTiers.map((tier) => (
                <article className="ck2-tier-card" key={`${tier.upper_minutes}-${tier.total_cents}`}>
                  <span>{lang === "fr" ? "Jusqu’à" : lang === "de" ? "Bis" : "Up to"} {durationLabel(tier.upper_minutes, lang)}</span>
                  <strong>{money(tier.total_cents, guestCurrency)}</strong>
                  <small>{lang === "fr" ? "total du palier" : lang === "de" ? "Stufenpreis gesamt" : "tier total"}</small>
                </article>
              ))}
            </div>
            <div className="ck2-pricing-note"><ShieldCheck /><div><strong>{copy.guaranteeTitle}{guestDepositCents > 0 ? ` · ${money(guestDepositCents, guestCurrency)}` : ""}</strong><p>{guestDepositCents > 0 ? copy.guaranteeBody : copy.guaranteePending}</p></div></div>
            <div className="ck2-pricing-actions">
              <button type="button" className="ck2-pricing-primary" onClick={continueGuest} disabled={!guestPricingReady}><Zap /> {copy.continueExpress}</button>
              <button type="button" className="ck2-pricing-secondary" onClick={openMemberPricing}><BadgePercent /> {copy.discoverPlus}</button>
            </div>
          </section>
          <aside className="ck2-pricing-side">
            <article className="ck2-summary-card"><span>{copy.totalRentalCap}</span><strong>{guestTotalCapCents > 0 ? money(guestTotalCapCents, guestCurrency) : "—"}</strong><p>{copy.totalRentalCapBody}</p></article>
            <article className="ck2-plus-card"><span>{copy.plusKicker}</span><h2>Chargeurs+</h2><p>{copy.plusLead}</p>{memberSaving && <div className="ck2-plus-saving"><strong>{copy.potentialSaving} · {memberSaving.percent}%</strong><small>{copy.savingExample} {durationLabel(memberSaving.minutes, lang)} : {money(memberSaving.memberCents, membershipCurrency)} vs {money(memberSaving.guestCents, guestCurrency)} · {money(memberSaving.savingCents, guestCurrency)} {lang === "fr" ? "économisés" : lang === "de" ? "gespart" : "saved"}.</small></div>}</article>
          </aside>
        </main>
      </div>
    );
  }

  if (stage === "member-pricing") {
    const annualFee = Number(membershipPlan?.annual_fee_cents ?? 0);
    const memberHourly = Number(membershipPlan?.hourly_cents ?? options?.member?.hourly_cents ?? 0);
    const memberDailyCap = Number(membershipPlan?.daily_cap_cents ?? options?.member?.daily_cap_cents ?? 0);
    const renewalCredit = Number(membershipPlan?.renewal_credit_cents ?? 0);
    return (
      <div className="ck2-shell ck2-pricing-screen ck2-pricing-member-offer">
        {journeyControl}
        <header className="ck2-topbar">
          <BrandLogo size="md" />
          <div className="ck2-top-actions"><LanguageSwitcher /><button type="button" className="ck2-pricing-back" onClick={returnHome}><ArrowLeft /> {copy.back}</button></div>
        </header>
        <main className="ck2-pricing-main">
          <section className="ck2-pricing-copy">
            <span className="ck2-pricing-kicker"><Crown /> {copy.plusKicker}</span>
            <h1>{copy.plusTitle}</h1>
            <p className="ck2-pricing-lead">{copy.plusLead}</p>
            <div className="ck2-plus-metrics">
              <article className="ck2-plus-metric"><span>{copy.passPrice}</span><strong>{annualFee > 0 ? money(annualFee, membershipCurrency) : "—"}</strong></article>
              <article className="ck2-plus-metric"><span>{copy.memberPrice}</span><strong>{memberHourly > 0 ? `${money(memberHourly, membershipCurrency)} ${copy.perHour}` : "—"}</strong></article>
              <article className="ck2-plus-metric"><span>{copy.dailyCap}</span><strong>{memberDailyCap > 0 ? money(memberDailyCap, membershipCurrency) : "—"}</strong></article>
              <article className="ck2-plus-metric"><span>{copy.renewalCredit}</span><strong>{renewalCredit > 0 ? money(renewalCredit, membershipCurrency) : "—"}</strong></article>
            </div>
            {memberSaving && <div className="ck2-pricing-note"><BadgePercent /><div><strong>{copy.potentialSaving} · {memberSaving.percent}%</strong><p>{copy.savingExample} {durationLabel(memberSaving.minutes, lang)} : {money(memberSaving.memberCents, membershipCurrency)} avec le tarif membre contre {money(memberSaving.guestCents, guestCurrency)} en Express, soit {money(memberSaving.savingCents, guestCurrency)} d’écart. {copy.savingDisclaimer}</p></div></div>}
            {!memberPricingReady && <div className="ck2-pricing-note"><ShieldCheck /><div><strong>{copy.memberUnavailable}</strong></div></div>}
            <div className="ck2-pricing-actions">
              <button type="button" className="ck2-pricing-primary ck2-pricing-primary--blue" onClick={() => void startMember()} disabled={!memberPricingReady}><UserRound /> {copy.alreadyMember}</button>
              <button type="button" className="ck2-pricing-secondary" onClick={openGuestPricing}><Zap /> {copy.expressInstead}</button>
            </div>
          </section>
          <aside className="ck2-pricing-side">
            <article className="ck2-plus-card"><span>{copy.plusKicker}</span><h2>{membershipPlan?.name || "Chargeurs+ Pass"}</h2><p>{memberSaving ? `${copy.potentialSaving} : jusqu’à ${memberSaving.percent}% sur l’exemple tarifaire affiché.` : copy.plusLead}</p>{memberSaving && <div className="ck2-plus-saving"><strong>{money(memberSaving.savingCents, guestCurrency)} · {memberSaving.percent}%</strong><small>{copy.savingDisclaimer}</small></div>}</article>
            <article className="ck2-plus-qr-card"><div className="ck2-plus-qr"><QRCodeSVG value={membershipUrl} size={110} level="M" bgColor="#ffffff" fgColor="#06090f" marginSize={1} /></div><div><strong>{copy.becomePlus}</strong><p>{copy.becomePlusBody}</p></div></article>
          </aside>
        </main>
      </div>
    );
  }

  if (stage === "connected") {
    const member = connectedInfo?.member;
    const currency = member?.currency ?? options?.member?.currency ?? "CHF";
    const hourly = member?.hourlyCents ?? options?.member?.hourly_cents;
    const dailyCapValue = member?.dailyCapCents ?? options?.member?.daily_cap_cents;
    return (
      <div className="ck2-shell ck2-connected">
        {journeyControl}
        <header className="ck2-topbar ck2-connected-topbar">
          <BrandLogo size="md" />
          <button type="button" className="ck2-pill" onClick={returnHome}><X /> {copy.returnHome}</button>
        </header>
        <main className="ck2-connected-grid">
          <section className="ck2-connected-copy">
            <div className="ck2-connected-check"><CheckCircle2 /></div>
            <span className="ck2-eyebrow">{copy.connectedKicker}</span>
            <h1>{copy.connectedTitle}</h1>
            <p>{connectedInfo?.displayName ? `${connectedInfo.displayName}, ${copy.connectedSubtitle.charAt(0).toLowerCase()}${copy.connectedSubtitle.slice(1)}` : copy.connectedSubtitle}</p>
            {member?.planName && <strong className="ck2-connected-plan">{member.planName}</strong>}
          </section>
          <section className="ck2-connected-benefits">
            <h2>{copy.connectedBenefits}</h2>
            <div className="ck2-connected-benefit-grid">
              <article><Zap /><span>{copy.connectedRate}</span><strong>{money(hourly, currency)} {copy.perHour}</strong></article>
              <article><Clock3 /><span>{copy.connectedCap}</span><strong>{money(dailyCapValue, currency)}</strong></article>
              {Number(member?.includedMinutes ?? 0) > 0 && <article><Clock3 /><span>{copy.connectedMinutes}</span><strong>{member?.includedMinutes} min</strong></article>}
              {member?.walletPassActive && <article><WalletCards /><span>{copy.connectedWallet}</span><strong>{member.walletProviderStatus === "issued" ? copy.connectedWallet : copy.connectedWalletLocal}</strong></article>}
            </div>
            <button type="button" className="ck2-connected-cta" onClick={continueMember}><Zap /><span><strong>{copy.connectedCta}</strong><small>{copy.connectedCtaSub}</small></span><b>→</b></button>
          </section>
        </main>
      </div>
    );
  }

  if (stage === "member") {
    const connectUrl = pairing?.connectPath ? `${window.location.origin}${pairing.connectPath}` : null;
    return (
      <div className="ck2-shell ck2-member">
        {journeyControl}
        <header className="ck2-topbar"><BrandLogo size="md" /><div className="ck2-top-actions"><LanguageSwitcher /><button type="button" className="ck2-pill" onClick={returnHome}><X /> {copy.cancel}</button></div></header>
        <main className="ck2-member-grid">
          <section className="ck2-member-copy">
            <span className="ck2-eyebrow">{copy.memberEyebrow}</span>
            <h1>{copy.memberTitle}<br /><strong>{copy.memberTitleAccent}</strong></h1>
            <p>{copy.memberPrivacy}</p>
            <div className="ck2-member-rate-label">{copy.memberRateLabel}</div>
            <div className="ck2-member-rate">{money(options?.member?.hourly_cents, options?.member?.currency)}<small>{copy.perHour}</small></div>
            <div className="ck2-security"><ShieldCheck /> {copy.secure}</div>
          </section>
          <section className="ck2-qr-card">
            <div className="ck2-qr-head"><BrandLogo size="sm" /><span>{copy.memberRateLabel}</span></div>
            {connectUrl && !pairingError ? <div className="ck2-qr-wrap"><QRCodeSVG value={connectUrl} size={330} level="M" bgColor="#ffffff" fgColor="#06090f" marginSize={2} /></div> : pairingError ? <div className="ck2-member-error"><p>{copy.memberError}</p><button type="button" onClick={() => void startMember()}>{copy.retry}</button></div> : <Loader2 className="ck2-spin" />}
            <p className="ck2-qr-instruction">{copy.memberScan}</p>
          </section>
        </main>
      </div>
    );
  }

  const expressCta = lang === "fr" ? "Continuer sans compte" : lang === "de" ? "Ohne Konto fortfahren" : "Continue without account";
  const clientCta = lang === "fr" ? "Se connecter avec l’app" : lang === "de" ? "Mit der App anmelden" : "Connect with the app";
  const tariffLabel = lang === "fr" ? "Tarif" : lang === "de" ? "Tarif" : "Rate";
  const memberTariffLabel = lang === "fr" ? "Tarif client" : lang === "de" ? "Kundentarif" : "Member rate";
  const secureStripeLabel = lang === "fr" ? "Paiement sécurisé par Stripe" : lang === "de" ? "Sichere Zahlung mit Stripe" : "Secure payment by Stripe";
  const depositLabel = lang === "fr" ? "Caution" : lang === "de" ? "Garantie" : "Deposit";

  return (
    <div className="ck2-shell ck2-home">
      <div className="ck2-ambient ck2-ambient-a" aria-hidden="true" />
      <div className="ck2-ambient ck2-ambient-b" aria-hidden="true" />

      <header className="ck2-topbar ck2-reference-topbar">
        <BrandLogo size="md" />
        <div className="ck2-top-actions">
          <button type="button" className="ck2-pill ck2-reference-util" onClick={() => void refreshOptions()} disabled={refreshing}>
            <RefreshCw className={refreshing ? "ck2-spin-small" : ""} />
            <span>{copy.refresh}</span>
          </button>
          <button type="button" className="ck2-pill ck2-reference-util" onClick={() => window.dispatchEvent(new CustomEvent("chargeurs:open-kiosk-help"))}>
            <HelpCircle />
            <span>{copy.help}</span>
          </button>
          <div className="ck2-language"><LanguageSwitcher /></div>
        </div>
      </header>

      <main className="ck2-reference-home-main">
        <section className="ck2-reference-heading">
          <h1 className="ck2-home-title">{copy.homeTitle}</h1>
          <p>{copy.homeSubtitle}</p>
        </section>

        <section className="ck2-choice-grid ck2-reference-choice-grid" aria-label={copy.homeTitle}>
          <button type="button" className="ck2-choice ck2-choice-express ck2-reference-card" onClick={openGuestPricing} disabled={!guestPricingReady}>
            <span className="ck2-choice-kicker">{copy.expressKicker}</span>
            <span className="ck2-choice-icon"><Zap /></span>
            <strong>{copy.expressTitle}</strong>
            <small>{copy.expressBody}</small>
            <span className="ck2-reference-rate">
              <em>{tariffLabel}</em>
              <b>{guestPrimaryPrice}</b>
            </span>
            <span className="ck2-reference-cta">{expressCta}<i>›</i></span>
          </button>

          <button type="button" className="ck2-choice ck2-choice-member ck2-reference-card" onClick={openMemberPricing} disabled={!memberOfferReady}>
            <span className="ck2-choice-kicker">{copy.clientKicker}</span>
            <span className="ck2-choice-icon"><UserRound /></span>
            <strong>{copy.clientTitle}</strong>
            <small>{copy.clientBody}</small>
            <span className="ck2-reference-rate">
              <em>{memberTariffLabel}</em>
              <b>{memberHomePrice}</b>
            </span>
            <span className="ck2-reference-cta">{clientCta}<i>›</i></span>
          </button>
        </section>
      </main>

      <footer className="ck2-home-payments ck2-reference-footer" aria-label={secureStripeLabel}>
        <div className="ck2-reference-payments">
          <span className="ck2-reference-stripe"><ShieldCheck />{secureStripeLabel}</span>
          <KioskPaymentMarks cardLabel="" />
        </div>
        <div className="ck2-reference-commercial">
          <span>{copy.dailyCap}<strong>{footerDailyCap}</strong></span>
          <i />
          <span>{depositLabel}<strong>{footerDeposit}</strong></span>
        </div>
      </footer>
    </div>
  );
}
