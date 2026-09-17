import { useMemo, useState } from "react";
import {
  ArrowLeftRight,
  Check,
  ChevronRight,
  CreditCard,
  Delete,
  Eye,
  EyeOff,
  LockKeyhole,
  QrCode,
  RotateCcw,
  ShoppingBag,
  Smartphone,
  X,
  Zap,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { BrandLogo } from "@/components/BrandLogo";
import { Button } from "@/components/ui/button";
import "./CashRegisterPreview.css";

type Journey = "stand" | "rental";

type PreviewState =
  | "CLIENT_HOME"
  | "TURN_TO_SELLER"
  | "CASHIER_READY"
  | "STAND_TIP"
  | "RENTAL_PAYMENT"
  | "RENTAL_QR"
  | "TERMINAL_CONNECTING"
  | "TERMINAL_PROCESSING"
  | "PAYMENT_SUCCESS"
  | "PAYMENT_DECLINED"
  | "PAYMENT_CANCELLED"
  | "TURN_TO_CLIENT";

const formatAmount = (cents: number) =>
  new Intl.NumberFormat("fr-CH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);

export default function CashRegisterPreview() {
  const [state, setState] = useState<PreviewState>("CLIENT_HOME");
  const [journey, setJourney] = useState<Journey>("stand");
  const [amountCents, setAmountCents] = useState(0);
  const [tipPercent, setTipPercent] = useState(0);
  const [inspectCashier, setInspectCashier] = useState(true);

  const cashierFacing = [
    "CASHIER_READY",
    "STAND_TIP",
    "TERMINAL_CONNECTING",
    "TERMINAL_PROCESSING",
    "PAYMENT_SUCCESS",
    "PAYMENT_DECLINED",
    "PAYMENT_CANCELLED",
    "TURN_TO_CLIENT",
  ].includes(state) && journey === "stand";

  const totalCents = useMemo(
    () => amountCents + Math.round((amountCents * tipPercent) / 100),
    [amountCents, tipPercent],
  );

  const resetClient = () => {
    setJourney("stand");
    setAmountCents(0);
    setTipPercent(0);
    setState("CLIENT_HOME");
  };

  const appendDigit = (digit: number) => {
    setAmountCents((current) => Math.min(current * 10 + digit, 999_999));
  };

  const removeDigit = () => {
    setAmountCents((current) => Math.floor(current / 10));
  };

  const beginStandSale = () => {
    setJourney("stand");
    setAmountCents(0);
    setTipPercent(0);
    setState("TURN_TO_SELLER");
  };

  const beginRental = () => {
    setJourney("rental");
    setAmountCents(0);
    setTipPercent(0);
    setState("RENTAL_PAYMENT");
  };

  const startTerminal = (nextJourney: Journey) => {
    setJourney(nextJourney);
    if (nextJourney === "rental") setTipPercent(0);
    setState("TERMINAL_CONNECTING");
    window.setTimeout(() => setState("TERMINAL_PROCESSING"), 900);
  };

  const finishPayment = (result: "success" | "declined" | "cancelled") => {
    if (result === "success") setState("PAYMENT_SUCCESS");
    if (result === "declined") setState("PAYMENT_DECLINED");
    if (result === "cancelled") setState("PAYMENT_CANCELLED");
  };

  const renderClientHome = () => (
    <div className="cash-preview__client-home">
      <section className="cash-preview__intro">
        <span className="cash-preview__eyebrow">Mode événement</span>
        <h2>Bonjour 👋</h2>
        <p>Choisissez ce que vous souhaitez faire sur le stand Chargeurs.ch.</p>
        <div className="cash-preview__client-note">
          <Zap aria-hidden="true" />
          Paiement sécurisé · Carte, sans contact ou QR
        </div>
      </section>

      <div className="cash-preview__choices">
        <button className="cash-preview__choice cash-preview__choice--sale" onClick={beginStandSale}>
          <span className="cash-preview__choice-icon"><ShoppingBag /></span>
          <strong>Achat sur le stand</strong>
          <span>Le vendeur saisit le montant, puis le paiement part sur le WisePad 3.</span>
          <span className="cash-preview__choice-action">Commencer <ChevronRight /></span>
        </button>

        <button className="cash-preview__choice cash-preview__choice--rental" onClick={beginRental}>
          <span className="cash-preview__choice-icon"><Zap /></span>
          <strong>Location de batterie</strong>
          <span>Location Chargeurs.ch avec paiement carte, sans contact ou QR.</span>
          <span className="cash-preview__choice-action">Louer <ChevronRight /></span>
        </button>
      </div>
    </div>
  );

  const renderTurnToSeller = () => (
    <section className="cash-preview__turn-card">
      <div className="cash-preview__turn-icon"><ArrowLeftRight /></div>
      <span className="cash-preview__eyebrow">Achat sur le stand</span>
      <h2>Tournez l’écran vers le vendeur</h2>
      <p>L’interface caisse va pivoter à 180° pour être lisible de l’autre côté du comptoir.</p>
      <Button size="lg" onClick={() => setState("CASHIER_READY")}>L’écran est tourné</Button>
      <Button variant="ghost" onClick={resetClient}>Annuler</Button>
    </section>
  );

  const renderCashier = () => (
    <div className="cash-preview__cashier">
      <section className="cash-preview__sale-summary">
        <span className="cash-preview__eyebrow">Caisse vendeur</span>
        <h2>Montant de la vente</h2>
        <div className="cash-preview__amount"><small>CHF</small>{formatAmount(amountCents)}</div>
        <p>Saisissez le total des articles vendus sur le stand.</p>

        <div className="cash-preview__quick-values">
          {[500, 1000, 2000, 5000].map((value) => (
            <Button key={value} variant="secondary" onClick={() => setAmountCents(value)}>
              {value / 100} CHF
            </Button>
          ))}
        </div>
      </section>

      <section className="cash-preview__keypad" aria-label="Pavé numérique caisse">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((digit) => (
          <Button key={digit} variant="outline" className="cash-preview__key" onClick={() => appendDigit(digit)}>
            {digit}
          </Button>
        ))}
        <Button variant="outline" className="cash-preview__key cash-preview__key--muted" onClick={() => setAmountCents(0)} aria-label="Effacer le montant">
          <RotateCcw />
        </Button>
        <Button variant="outline" className="cash-preview__key" onClick={() => appendDigit(0)}>0</Button>
        <Button variant="outline" className="cash-preview__key cash-preview__key--muted" onClick={removeDigit} aria-label="Corriger le dernier chiffre">
          <Delete />
        </Button>
        <Button className="cash-preview__checkout" disabled={amountCents <= 0} onClick={() => setState("STAND_TIP")}>
          Encaisser CHF {formatAmount(amountCents)} <ChevronRight />
        </Button>
      </section>
    </div>
  );

  const renderStandTip = () => (
    <section className="cash-preview__tip-stage">
      <div className="cash-preview__terminal-mini"><CreditCard /></div>
      <span className="cash-preview__eyebrow">Vente sur le stand · WisePad 3</span>
      <h2>Pourboire proposé au client</h2>
      <p>Le montant de la vente est envoyé au terminal. Pour cette prévisualisation, choisissez le pourboire qui serait sélectionné côté client.</p>
      <div className="cash-preview__base-amount">Vente · CHF {formatAmount(amountCents)}</div>

      <div className="cash-preview__tip-grid">
        {[0, 5, 10, 15].map((percent) => {
          const total = amountCents + Math.round((amountCents * percent) / 100);
          return (
            <button
              key={percent}
              className="cash-preview__tip-choice"
              onClick={() => {
                setTipPercent(percent);
                window.setTimeout(() => startTerminal("stand"), 0);
              }}
            >
              <strong>{percent === 0 ? "Sans" : `${percent} %`}</strong>
              <span>CHF {formatAmount(total)}</span>
            </button>
          );
        })}
      </div>
      <Button variant="ghost" onClick={() => setState("CASHIER_READY")}>Modifier le montant</Button>
    </section>
  );

  const renderRentalPayment = () => (
    <div className="cash-preview__rental-stage">
      <section className="cash-preview__rental-copy">
        <span className="cash-preview__eyebrow">Location Chargeurs.ch</span>
        <h2>Comment souhaitez-vous payer ?</h2>
        <p>Le tarif réel de la location reste celui configuré par Chargeurs.ch. Aucun pourboire n’est proposé sur une location.</p>
        <div className="cash-preview__no-tip-badge"><LockKeyhole /> Location · pourboire désactivé</div>
        <Button variant="ghost" onClick={resetClient}><RotateCcw /> Retour</Button>
      </section>

      <div className="cash-preview__rental-options">
        <button className="cash-preview__payment-card" onClick={() => startTerminal("rental")}>
          <span className="cash-preview__payment-card-icon"><CreditCard /></span>
          <span>
            <strong>Carte ou sans contact</strong>
            <small>Le paiement est envoyé directement au WisePad 3.</small>
          </span>
          <ChevronRight />
        </button>

        <button className="cash-preview__payment-card" onClick={() => setState("RENTAL_QR")}>
          <span className="cash-preview__payment-card-icon"><QrCode /></span>
          <span>
            <strong>QR code</strong>
            <small>Le client paie sur son téléphone.</small>
          </span>
          <ChevronRight />
        </button>
      </div>
    </div>
  );

  const renderRentalQr = () => (
    <section className="cash-preview__qr-stage">
      <div className="cash-preview__qr-box">
        <QRCodeSVG value="https://web-test.chargeurs.ch/pay/demo" size={210} level="M" includeMargin />
      </div>
      <span className="cash-preview__eyebrow">Location · paiement QR</span>
      <h2>Scannez pour continuer sur votre téléphone</h2>
      <p>Prévisualisation uniquement. Aucun paiement réel n’est créé depuis cet écran.</p>
      <div className="cash-preview__qr-actions">
        <Button variant="outline" onClick={() => setState("RENTAL_PAYMENT")}>Retour</Button>
        <Button onClick={() => finishPayment("success")}>Simuler paiement reçu</Button>
      </div>
    </section>
  );

  const renderTerminal = () => {
    const processing = state === "TERMINAL_PROCESSING";
    return (
      <section className="cash-preview__terminal-stage">
        <div className="cash-preview__terminal-visual">
          <div className="cash-preview__terminal-screen">
            <small>WisePad 3</small>
            <strong>CHF {formatAmount(totalCents || amountCents)}</strong>
            <span>{processing ? "Présentez carte ou téléphone" : "Connexion…"}</span>
            <div className="cash-preview__contactless"><Smartphone /></div>
          </div>
        </div>

        <span className="cash-preview__eyebrow">{journey === "stand" ? "Vente sur le stand" : "Location de batterie"}</span>
        <h2>{processing ? "Paiement en attente sur le WisePad 3" : "Connexion au WisePad 3…"}</h2>
        <div className="cash-preview__terminal-total">CHF {formatAmount(totalCents || amountCents)}</div>
        <p>{journey === "rental" ? "Aucun pourboire n’est proposé pour cette location." : tipPercent > 0 ? `Pourboire sélectionné : ${tipPercent} %.` : "Sans pourboire."}</p>

        {processing && (
          <div className="cash-preview__simulation-actions">
            <Button onClick={() => finishPayment("success")}><Check /> Simuler accepté</Button>
            <Button variant="destructive" onClick={() => finishPayment("declined")}><X /> Simuler refusé</Button>
            <Button variant="outline" onClick={() => finishPayment("cancelled")}>Simuler annulé</Button>
          </div>
        )}
      </section>
    );
  };

  const renderResult = () => {
    const success = state === "PAYMENT_SUCCESS";
    const declined = state === "PAYMENT_DECLINED";
    const title = success ? "Paiement accepté" : declined ? "Paiement refusé" : "Paiement annulé";

    return (
      <section className="cash-preview__result-stage">
        <div className={`cash-preview__result-icon ${success ? "is-success" : "is-failure"}`}>
          {success ? <Check /> : <X />}
        </div>
        <span className="cash-preview__eyebrow">{journey === "stand" ? "Vente sur le stand" : "Location"}</span>
        <h2>{title}</h2>
        {(totalCents > 0 || amountCents > 0) && <div className="cash-preview__result-total">CHF {formatAmount(totalCents || amountCents)}</div>}
        <p>{success ? "Transaction simulée terminée." : "Aucun encaissement réel n’a été effectué dans cette prévisualisation."}</p>

        <div className="cash-preview__result-actions">
          {journey === "stand" ? (
            <>
              {declined && <Button onClick={() => startTerminal("stand")}>Réessayer</Button>}
              <Button variant={declined ? "outline" : "default"} onClick={() => setState("TURN_TO_CLIENT")}>Terminer et retourner l’écran</Button>
            </>
          ) : (
            <Button onClick={resetClient}>Retour à l’accueil</Button>
          )}
        </div>
      </section>
    );
  };

  const renderTurnToClient = () => (
    <section className="cash-preview__turn-card">
      <div className="cash-preview__turn-icon"><ArrowLeftRight /></div>
      <span className="cash-preview__eyebrow">Fin de vente</span>
      <h2>Retournez l’écran vers le client</h2>
      <p>Une fois l’écran physiquement retourné, l’accueil événement revient automatiquement côté client.</p>
      <Button size="lg" onClick={resetClient}>L’écran est retourné</Button>
    </section>
  );

  return (
    <div className={`cash-preview ${inspectCashier ? "cash-preview--inspect" : ""}`}>
      <button
        className="cash-preview__inspect-toggle"
        onClick={() => setInspectCashier((value) => !value)}
        title="Uniquement pour faciliter la prévisualisation dans un navigateur"
      >
        {inspectCashier ? <EyeOff /> : <Eye />}
        {inspectCashier ? "Voir la rotation physique" : "Garder la vue vendeur à l’endroit"}
      </button>

      <div className="cash-preview__viewport">
        <div className="cash-preview__screen" data-facing={cashierFacing ? "cashier" : "client"}>
          <header className="cash-preview__header">
            <div className="cash-preview__brand">
              <BrandLogo size="sm" />
              <div><strong>Chargeurs.ch</strong><span>Événement · DTA21269</span></div>
            </div>
            <div className="cash-preview__statuses">
              <span><i /> Borne en ligne</span>
              <span><i /> WisePad 3 prêt</span>
            </div>
          </header>

          <main className="cash-preview__main">
            {state === "CLIENT_HOME" && renderClientHome()}
            {state === "TURN_TO_SELLER" && renderTurnToSeller()}
            {state === "CASHIER_READY" && renderCashier()}
            {state === "STAND_TIP" && renderStandTip()}
            {state === "RENTAL_PAYMENT" && renderRentalPayment()}
            {state === "RENTAL_QR" && renderRentalQr()}
            {(state === "TERMINAL_CONNECTING" || state === "TERMINAL_PROCESSING") && renderTerminal()}
            {(state === "PAYMENT_SUCCESS" || state === "PAYMENT_DECLINED" || state === "PAYMENT_CANCELLED") && renderResult()}
            {state === "TURN_TO_CLIENT" && renderTurnToClient()}
          </main>

          <footer className="cash-preview__footer">
            <span>Prévisualisation visuelle · aucun paiement ni éjection réelle</span>
            <span>{cashierFacing ? "Côté vendeur" : "Côté client"}</span>
          </footer>
        </div>
      </div>
    </div>
  );
}
