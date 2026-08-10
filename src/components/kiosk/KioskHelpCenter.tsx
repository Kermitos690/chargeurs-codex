import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  BatteryCharging,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  CreditCard,
  HelpCircle,
  MapPin,
  ReceiptText,
  RotateCcw,
  ShieldCheck,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";

type Lang = "fr" | "en" | "de";
type Topic = {
  id: string;
  title: string;
  short: string;
  body: string[];
  icon: typeof HelpCircle;
};

type Copy = {
  title: string;
  subtitle: string;
  how: string;
  support: string;
  supportDetail: string;
  back: string;
  close: string;
  station: string;
  topics: Topic[];
};

const COPY: Record<Lang, Copy> = {
  fr: {
    title: "Aide & questions fréquentes",
    subtitle: "Location, paiement, retrait et retour — directement sur la borne.",
    how: "Comment ça marche ?",
    support: "Besoin d’assistance ?",
    supportDetail: "Indiquez au support la référence de cette borne. Ne communiquez jamais un numéro de carte complet.",
    back: "Retour aux questions",
    close: "Fermer l’aide",
    station: "Borne",
    topics: [
      { id: "rent", title: "Comment louer une batterie ?", short: "Choix, QR et démarrage", icon: BatteryCharging, body: ["Choisissez une batterie disponible sur l’écran puis vérifiez le tarif affiché.", "Scannez le QR avec votre téléphone et choisissez votre moyen de paiement.", "Revenez devant la borne : la location démarre uniquement lorsque la sortie physique de la batterie est confirmée."] },
      { id: "payment", title: "Comment fonctionne la garantie de 30 CHF ?", short: "Carte, wallet ou TWINT", icon: CreditCard, body: ["Avec une carte ou un wallet compatible, 30 CHF sont temporairement réservés auprès de votre banque. Au retour, seul le prix réel est capturé et le solde est libéré.", "Avec TWINT, 30 CHF sont débités au départ puis la différence est remboursée automatiquement après le retour.", "L’écran et le reçu indiquent toujours le mécanisme réellement utilisé pour votre location."] },
      { id: "release", title: "La batterie ne sort pas ou l’écran reste bloqué", short: "Retrait et confirmation physique", icon: AlertTriangle, body: ["N’essayez pas de payer une deuxième fois.", "La borne vérifie automatiquement le slot et la présence physique de la batterie. Si la sortie est confirmée, le parcours reprend sans attendre une confirmation fournisseur tardive.", "Si aucune sortie fiable n’est détectée, la location reste protégée et le support peut la retrouver grâce à sa référence."] },
      { id: "return", title: "Comment rendre la batterie ?", short: "Insertion et détection automatique", icon: RotateCcw, body: ["Insérez la batterie dans un emplacement libre d’une borne Chargeurs.ch compatible.", "Attendez la confirmation visuelle : le système identifie la batterie, le slot et l’heure de retour avant de fermer la location.", "Ne partez pas tant que l’écran n’a pas confirmé que le retour a été détecté."] },
      { id: "other-station", title: "Puis-je rendre la batterie dans une autre borne ?", short: "Retour sur le réseau Chargeurs.ch", icon: MapPin, body: ["Oui, lorsque la borne de destination est compatible et possède un emplacement de retour disponible.", "La batterie est reconnue par son identifiant physique ; le retour est ensuite rattaché à votre location active."] },
      { id: "price", title: "Comment le prix final est-il calculé ?", short: "Durée, tranches et plafond", icon: CircleDollarSign, body: ["Le calcul est effectué côté serveur à partir du tarif figé au début de votre location.", "La durée retenue va de la sortie physique confirmée jusqu’au retour physique confirmé.", "Le récapitulatif final affiche la durée, le tarif appliqué, le prix final, la garantie et le montant libéré ou remboursé."] },
      { id: "refund", title: "Quand la garantie est-elle libérée ou remboursée ?", short: "Après le retour confirmé", icon: Clock3, body: ["Le règlement final commence après détection fiable du retour.", "Pour une autorisation carte, le montant réel est capturé et le reste de l’autorisation est libéré. Pour TWINT, la différence est remboursée.", "L’apparition du solde sur votre compte dépend ensuite du délai de votre banque ou de votre moyen de paiement."] },
      { id: "receipt", title: "Où retrouver mon reçu ?", short: "Prix exact et référence", icon: ReceiptText, body: ["Après le retour, la borne affiche un récapitulatif et la page de votre téléphone suit la même location.", "Le reçu indique notamment la référence, la durée, le prix final, le moyen de paiement, la garantie et le remboursement ou la libération confirmés."] },
    ],
  },
  en: {
    title: "Help & frequently asked questions",
    subtitle: "Rental, payment, release and return — directly on the kiosk.",
    how: "How does it work?",
    support: "Need assistance?",
    supportDetail: "Give support this kiosk reference. Never share a full card number.",
    back: "Back to questions",
    close: "Close help",
    station: "Kiosk",
    topics: [
      { id: "rent", title: "How do I rent a powerbank?", short: "Selection, QR and start", icon: BatteryCharging, body: ["Choose an available powerbank and check the displayed price.", "Scan the QR with your phone and choose your payment method.", "Return to the kiosk: the rental starts only after the physical release is confirmed."] },
      { id: "payment", title: "How does the CHF 30 guarantee work?", short: "Card, wallet or TWINT", icon: CreditCard, body: ["With an eligible card or wallet, CHF 30 is temporarily authorised by your bank. On return, only the actual price is captured and the rest is released.", "With TWINT, CHF 30 is charged at the start and the difference is refunded automatically after return.", "The screen and receipt always describe the mechanism actually used."] },
      { id: "release", title: "The powerbank did not release or the screen is stuck", short: "Physical release verification", icon: AlertTriangle, body: ["Do not pay a second time.", "The kiosk automatically checks the selected slot and physical battery presence. A confirmed release allows the flow to continue even if a provider confirmation is late.", "If no reliable release is detected, the rental remains protected and support can trace it using the public reference."] },
      { id: "return", title: "How do I return the powerbank?", short: "Insert and automatic detection", icon: RotateCcw, body: ["Insert the powerbank into a free return slot on a compatible Chargeurs.ch kiosk.", "Wait for the visual confirmation: the system identifies the battery, slot and return time before closing the rental.", "Do not leave until the screen confirms the return was detected."] },
      { id: "other-station", title: "Can I return it to another kiosk?", short: "Network return", icon: MapPin, body: ["Yes, when the destination kiosk is compatible and has a free return slot.", "The physical battery identity is used to match the return to your active rental."] },
      { id: "price", title: "How is the final price calculated?", short: "Duration, increments and cap", icon: CircleDollarSign, body: ["Pricing is calculated server-side from the tariff frozen at rental start.", "Billable time runs from confirmed physical release to confirmed physical return.", "The final recap shows duration, applied tariff, final price, guarantee and the confirmed release or refund amount."] },
      { id: "refund", title: "When is the guarantee released or refunded?", short: "After confirmed return", icon: Clock3, body: ["Final settlement starts after a reliable return is detected.", "For a card authorisation, the actual price is captured and the rest is released. For TWINT, the difference is refunded.", "Your bank or payment method then determines when the balance becomes visible."] },
      { id: "receipt", title: "Where can I find my receipt?", short: "Exact price and reference", icon: ReceiptText, body: ["After return, the kiosk shows a recap and the phone page follows the same rental.", "The receipt includes the reference, duration, final price, payment method, guarantee and confirmed refund or release."] },
    ],
  },
  de: {
    title: "Hilfe & häufige Fragen",
    subtitle: "Miete, Zahlung, Ausgabe und Rückgabe — direkt am Automaten.",
    how: "Wie funktioniert es?",
    support: "Brauchen Sie Hilfe?",
    supportDetail: "Nennen Sie dem Support die Referenz dieses Automaten. Geben Sie niemals eine vollständige Kartennummer weiter.",
    back: "Zurück zu den Fragen",
    close: "Hilfe schließen",
    station: "Automat",
    topics: [
      { id: "rent", title: "Wie miete ich eine Powerbank?", short: "Auswahl, QR und Start", icon: BatteryCharging, body: ["Wählen Sie eine verfügbare Powerbank und prüfen Sie den angezeigten Tarif.", "Scannen Sie den QR-Code mit Ihrem Telefon und wählen Sie die Zahlungsart.", "Kehren Sie zum Automaten zurück: Die Miete startet erst nach bestätigter physischer Ausgabe."] },
      { id: "payment", title: "Wie funktioniert die Garantie von CHF 30?", short: "Karte, Wallet oder TWINT", icon: CreditCard, body: ["Bei einer geeigneten Karte oder Wallet werden CHF 30 vorübergehend bei Ihrer Bank autorisiert. Nach der Rückgabe wird nur der tatsächliche Preis belastet und der Rest freigegeben.", "Bei TWINT werden CHF 30 zu Beginn belastet; die Differenz wird nach der Rückgabe automatisch zurückerstattet.", "Anzeige und Beleg nennen immer den tatsächlich verwendeten Mechanismus."] },
      { id: "release", title: "Powerbank kommt nicht heraus oder Anzeige bleibt stehen", short: "Physische Ausgabeprüfung", icon: AlertTriangle, body: ["Zahlen Sie nicht ein zweites Mal.", "Der Automat prüft automatisch den gewählten Slot und die physische Anwesenheit der Batterie. Eine bestätigte Ausgabe führt den Ablauf auch bei verspäteter Anbieterbestätigung fort.", "Ohne zuverlässigen Nachweis bleibt die Miete geschützt und kann über die Referenz geprüft werden."] },
      { id: "return", title: "Wie gebe ich die Powerbank zurück?", short: "Einstecken und automatische Erkennung", icon: RotateCcw, body: ["Stecken Sie die Powerbank in einen freien Rückgabe-Slot eines kompatiblen Chargeurs.ch Automaten.", "Warten Sie auf die visuelle Bestätigung: Batterie, Slot und Rückgabezeit werden vor Abschluss erkannt.", "Gehen Sie erst, wenn die Rückgabe bestätigt wurde."] },
      { id: "other-station", title: "Kann ich an einem anderen Automaten zurückgeben?", short: "Rückgabe im Chargeurs.ch Netz", icon: MapPin, body: ["Ja, wenn der Zielautomat kompatibel ist und einen freien Rückgabe-Slot hat.", "Die physische Batterie-ID verbindet die Rückgabe mit Ihrer aktiven Miete."] },
      { id: "price", title: "Wie wird der Endpreis berechnet?", short: "Dauer, Intervalle und Tageslimit", icon: CircleDollarSign, body: ["Der Preis wird serverseitig anhand des beim Start eingefrorenen Tarifs berechnet.", "Die Dauer läuft von der bestätigten physischen Ausgabe bis zur bestätigten physischen Rückgabe.", "Die Endübersicht zeigt Dauer, Tarif, Endpreis, Garantie sowie bestätigte Freigabe oder Rückerstattung."] },
      { id: "refund", title: "Wann wird die Garantie freigegeben oder erstattet?", short: "Nach bestätigter Rückgabe", icon: Clock3, body: ["Die Endabrechnung beginnt nach zuverlässiger Rückgabeerkennung.", "Bei Kartenautorisierung wird der tatsächliche Preis belastet und der Rest freigegeben. Bei TWINT wird die Differenz erstattet.", "Wann der Betrag sichtbar ist, hängt anschließend von Bank oder Zahlungsart ab."] },
      { id: "receipt", title: "Wo finde ich meinen Beleg?", short: "Endpreis und Referenz", icon: ReceiptText, body: ["Nach der Rückgabe zeigt der Automat eine Übersicht; die Telefonseite verfolgt dieselbe Miete.", "Der Beleg enthält Referenz, Dauer, Endpreis, Zahlungsart, Garantie und bestätigte Freigabe oder Rückerstattung."] },
    ],
  },
};

export function KioskHelpCenter({
  lang,
  stationId,
  supportEmail,
  onClose,
}: {
  lang: string;
  stationId?: string;
  supportEmail: string;
  onClose: () => void;
}) {
  const locale: Lang = lang === "de" || lang === "en" ? lang : "fr";
  const copy = COPY[locale];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = useMemo(() => copy.topics.find((topic) => topic.id === selectedId) ?? null, [copy.topics, selectedId]);

  return (
    <div className="fixed inset-0 z-[70] bg-[#030817]/95 p-5 backdrop-blur-2xl sm:p-8" role="dialog" aria-modal="true" aria-label={copy.title}>
      <div className="mx-auto flex h-full w-full max-w-[92rem] flex-col overflow-hidden rounded-[2.25rem] border border-white/15 bg-gradient-to-br from-blue-950/90 via-slate-950/95 to-violet-950/85 shadow-[0_0_90px_rgba(36,115,255,.24)]">
        <header className="flex items-center justify-between gap-5 border-b border-white/10 px-7 py-5 sm:px-10">
          <div className="text-left">
            <div className="flex items-center gap-3 text-cyan-300"><HelpCircle className="h-7 w-7" /><span className="text-sm font-black uppercase tracking-[.16em]">{copy.how}</span></div>
            <h2 className="mt-2 font-display text-4xl font-black tracking-tight sm:text-5xl">{copy.title}</h2>
            <p className="mt-2 text-lg text-slate-300 sm:text-xl">{copy.subtitle}</p>
          </div>
          <Button onClick={onClose} variant="ghost" className="h-16 w-16 shrink-0 rounded-full border border-white/15 bg-white/5 p-0" aria-label={copy.close}>
            <X className="h-8 w-8" />
          </Button>
        </header>

        <div className="grid min-h-0 flex-1 lg:grid-cols-[.9fr_1.1fr]">
          <div className="min-h-0 overflow-y-auto border-r border-white/10 p-5 sm:p-7">
            <div className="grid gap-3">
              {copy.topics.map((topic) => {
                const Icon = topic.icon;
                const active = topic.id === selectedId;
                return (
                  <button
                    key={topic.id}
                    type="button"
                    onClick={() => setSelectedId(topic.id)}
                    className={`group flex min-h-[5.5rem] w-full items-center gap-4 rounded-2xl border p-4 text-left transition active:scale-[.985] ${active ? "border-cyan-300/60 bg-cyan-300/10 shadow-[0_0_30px_rgba(34,211,238,.14)]" : "border-white/10 bg-white/[.045] hover:bg-white/[.075]"}`}
                  >
                    <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-blue-400/10 text-cyan-200"><Icon className="h-6 w-6" /></span>
                    <span className="min-w-0 flex-1"><strong className="block text-xl font-black leading-tight">{topic.title}</strong><span className="mt-1 block text-base text-slate-400">{topic.short}</span></span>
                    <ChevronRight className="h-7 w-7 shrink-0 text-slate-500 transition group-hover:translate-x-1 group-hover:text-cyan-200" />
                  </button>
                );
              })}
            </div>
          </div>

          <div className="min-h-0 overflow-y-auto p-7 text-left sm:p-10">
            {selected ? (
              <div className="mx-auto max-w-3xl">
                <button type="button" onClick={() => setSelectedId(null)} className="mb-7 inline-flex items-center gap-2 text-lg font-bold text-cyan-300 lg:hidden"><ArrowLeft className="h-5 w-5" />{copy.back}</button>
                <div className="mb-7 grid h-20 w-20 place-items-center rounded-[1.5rem] bg-gradient-to-br from-cyan-300/20 to-violet-400/20 text-cyan-200"><selected.icon className="h-10 w-10" /></div>
                <h3 className="font-display text-4xl font-black leading-tight tracking-tight sm:text-5xl">{selected.title}</h3>
                <div className="mt-8 space-y-4">
                  {selected.body.map((paragraph, index) => <p key={index} className="rounded-2xl border border-white/10 bg-white/[.045] p-5 text-xl font-medium leading-relaxed text-slate-200">{paragraph}</p>)}
                </div>
              </div>
            ) : (
              <div className="mx-auto flex h-full max-w-3xl flex-col justify-center">
                <ShieldCheck className="h-16 w-16 text-cyan-300" />
                <h3 className="mt-5 font-display text-4xl font-black tracking-tight sm:text-5xl">{copy.how}</h3>
                <p className="mt-5 text-2xl leading-relaxed text-slate-300">{copy.subtitle}</p>
                <div className="mt-9 rounded-[1.75rem] border border-white/12 bg-white/[.05] p-6">
                  <div className="text-xl font-black">{copy.support}</div>
                  <p className="mt-2 text-lg leading-relaxed text-slate-300">{copy.supportDetail}</p>
                  <div className="mt-5 flex flex-wrap gap-3 text-base font-bold">
                    <span className="rounded-full border border-white/12 bg-black/20 px-4 py-2">{copy.station} {stationId ?? "—"}</span>
                    <span className="rounded-full border border-white/12 bg-black/20 px-4 py-2">{supportEmail}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
