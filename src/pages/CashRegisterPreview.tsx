import { useEffect, useMemo, useState } from "react";
import { ArrowLeftRight, Banknote, Check, ChevronRight, CreditCard, Delete, LockKeyhole, QrCode, RotateCcw, ShoppingBag, X } from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";
import { Button } from "@/components/ui/button";
import "./CashRegisterPreview.css";

type PreviewState =
  | "CLIENT_HOME"
  | "ROTATING_TO_CASHIER"
  | "CASHIER_READY"
  | "TIP_SELECTION"
  | "TERMINAL_CONNECTING"
  | "TERMINAL_PROCESSING"
  | "SUCCESS"
  | "DECLINED"
  | "CANCELLED"
  | "LOCATION_PAYMENT";

type Journey = "stand" | "rental";

const DEMO_STATES: PreviewState[] = [
  "CLIENT_HOME",
  "ROTATING_TO_CASHIER",
  "CASHIER_READY",
  "TIP_SELECTION",
  "TERMINAL_CONNECTING",
  "TERMINAL_PROCESSING",
  "SUCCESS",
  "DECLINED",
  "CANCELLED",
];

const formatAmount = (cents: number) =>
  new Intl.NumberFormat("fr-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100);

export default function CashRegisterPreview() {
  const [state, setState] = useState<PreviewState>("CLIENT_HOME");
  const [journey, setJourney] = useState<Journey>("stand");
  const [amountCents, setAmountCents] = useState(0);
  const [tipPercent, setTipPercent] = useState(0);
  const [showModeConfirm, setShowModeConfirm] = useState(false);

  const totalCents = useMemo(
    () => amountCents + Math.round((amountCents * tipPercent) / 100),
    [amountCents, tipPercent],
  );

  const cashierFacing = state !== "CLIENT_HOME" && state !== "LOCATION_PAYMENT";
  const facing = state === "ROTATING_TO_CASHIER" ? "rotating" : cashierFacing ? "cashier" : "client";
  const terminalWorking = state === "TERMINAL_CONNECTING" || state === "TERMINAL_PROCESSING";

  useEffect(() => {
    if (state !== "ROTATING_TO_CASHIER") return;
    const timer = window.setTimeout(() => setState("CASHIER_READY"), 1150);
    return () => window.clearTimeout(timer);
  }, [state]);

  useEffect(() => {
    if (state !== "TERMINAL_CONNECTING") return;
    const timer = window.setTimeout(() => setState("TERMINAL_PROCESSING"), 850);
    return () => window.clearTimeout(timer);
  }, [state]);

  const appendDigit = (digit: string) => {
    const next = Number(`${amountCents}${digit}`);
    setAmountCents(Math.min(next, 999_999));
  };

  const startStand = () => {
    setJourney("stand");
    setAmountCents(0);
    setTipPercent(0);
    setState("ROTATING_TO_CASHIER");
  };

  const startRental = () => {
    setJourney("rental");
    setAmountCents(490);
    setTipPercent(0);
    setState("LOCATION_PAYMENT");
  };

  const startTerminal = (nextJourney: Journey) => {
    setJourney(nextJourney);
    if (nextJourney === "rental") setTipPercent(0);
    setState("TERMINAL_CONNECTING");
  };

  const returnToClient = () => {
    setAmountCents(0);
    setTipPercent(0);
    setJourney("stand");
    setState("CLIENT_HOME");
  };

  const renderClientHome = () => (
    <div className="cash-preview__client-home animate-fade-in">
      <section className="cash-preview__intro">
        <span className="cash-preview__eyebrow">Bienvenue</span>
        <h2>Que souhaitez-vous faire&nbsp;?</h2>
        <p>Choisissez votre service. L’écran vous accompagne à chaque étape.</p>
      </section>
      <div className="cash-preview__choices">
        <Button className="cash-preview__choice cash-preview__choice--primary" onClick={startStand}>
          <ShoppingBag aria-hidden="true" />
          <strong>Acheter sur le stand</strong>
          <span>Le vendeur saisit le montant et lance le paiement.</span>
          <ChevronRight aria-hidden="true" />
        </Button>
        <Button variant="outline" className="cash-preview__choice" onClick={startRental}>
          <Banknote aria-hidden="true" />
          <strong>Louer une batterie</strong>
          <span>Continuez directement vers le choix de paiement.</span>
          <ChevronRight aria-hidden="true" />
        </Button>
      </div>
    </div>
  );

  const renderRotation = () => (
    <section className="cash-preview__turn animate-scale-in" aria-live="polite">
      <div className="cash-preview__turn-icon"><ArrowLeftRight aria-hidden="true" /></div>
      <span className="cash-preview__eyebrow">Passage côté vendeur</span>
      <h2>Tournez l’écran vers le vendeur</h2>
      <p>L’interface pivote à 180° pour présenter la caisse dans le bon sens.</p>
    </section>
  );

  const renderCashier = () => (
    <div className="cash-preview__cashier animate-fade-in">
      <section className="cash-preview__amount-panel">
        <div>
          <span className="cash-preview__eyebrow">Montant de la vente</span>
          <div className="cash-preview__amount" aria-live="polite"><small>CHF</small>{formatAmount(amountCents)}</div>
        </div>
        <div className="cash-preview__shortcuts" aria-label="Montants rapides">
          {[500, 1000, 2000, 5000].map((value) => (
            <Button key={value} variant="secondary" className="cash-preview__shortcut" onClick={() => setAmountCents(value)}>
              {value / 100} CHF
            </Button>
          ))}
        </div>
      </section>
      <section className="cash-preview__keypad" aria-label="Pavé numérique">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit) => (
          <Button key={digit} variant="outline" className="cash-preview__key" onClick={() => appendDigit(digit)}>{digit}</Button>
        ))}
        <Button variant="outline" className="cash-preview__key cash-preview__key--muted" aria-label="Effacer le montant" onClick={() => setAmountCents(0)}><RotateCcw /></Button>
        <Button variant="outline" className="cash-preview__key" onClick={() => appendDigit("0")}>0</Button>
        <Button variant="outline" className="cash-preview__key cash-preview__key--muted" aria-label="Corriger le dernier chiffre" onClick={() => setAmountCents(Math.floor(amountCents / 10))}><Delete /></Button>
        <Button className="cash-preview__checkout" disabled={amountCents <= 0} onClick={() => setState("TIP_SELECTION")}>
          Encaisser <ChevronRight />
        </Button>
      </section>
    </div>
  );

  const renderTipSelection = () => (
    <section className="cash-preview__tip animate-scale-in">
      <span className="cash-preview__eyebrow">Vente sur le stand</span>
      <h2>Souhaitez-vous ajouter un pourboire&nbsp;?</h2>
      <p className="cash-preview__tip-total">Montant de la vente&nbsp;: CHF {formatAmount(amountCents)}</p>
      <div className="cash-preview__tip-options">
        {[0, 5, 10, 15].map((percent) => (
          <Button key={percent} variant={percent === 0 ? "secondary" : "outline"} className="cash-preview__tip-option" onClick={() => { setTipPercent(percent); startTerminal("stand"); }}>
            {percent === 0 ? "Aucun" : `${percent} %`}
            <small>{percent === 0 ? "Sans pourboire" : `Total CHF ${formatAmount(amountCents + Math.round(amountCents * percent / 100))}`}</small>
          </Button>
        ))}
        <Button variant="outline" className="cash-preview__tip-option" onClick={() => { setTipPercent(20); startTerminal("stand"); }}>
          Autre
          <small>Démo&nbsp;: 20 %</small>
        </Button>
      </div>
    </section>
  );

  const renderLocationPayment = () => (
    <div className="cash-preview__location animate-fade-in">
      <section>
        <span className="cash-preview__eyebrow">Location de batterie</span>
        <h2>Choisissez votre paiement</h2>
        <p>Le tarif affiché est une valeur de démonstration visuelle. Aucun paiement ne sera effectué.</p>
        <Button variant="ghost" onClick={returnToClient}><RotateCcw /> Retour</Button>
      </section>
      <div className="cash-preview__payment-options">
        <Button variant="outline" className="cash-preview__payment-option" onClick={() => startTerminal("rental")}>
          <span><strong>Carte ou sans contact</strong><span>Directement sur le WisePad 3 · sans pourboire</span></span>
          <CreditCard />
        </Button>
        <Button variant="outline" className="cash-preview__payment-option" onClick={() => { setJourney("rental"); setTipPercent(0); setState("TERMINAL_PROCESSING"); }}>
          <span><strong>Paiement par QR</strong><span>Sur votre téléphone · sans pourboire</span></span>
          <QrCode />
        </Button>
      </div>
    </div>
  );

  const renderTerminal = () => {
    const processing = state === "TERMINAL_PROCESSING";
    return (
      <section className="cash-preview__terminal animate-scale-in" aria-live="polite">
        <div className="cash-preview__terminal-icon"><CreditCard aria-hidden="true" /></div>
        <span className="cash-preview__eyebrow">WisePad 3 · Simulation</span>
        <h2>{processing ? "Montant envoyé au terminal" : "Connexion au terminal…"}</h2>
        <div className="cash-preview__terminal-amount">CHF {formatAmount(totalCents)}</div>
        <p>{processing ? "Présentez carte ou téléphone sur le WisePad 3." : "Préparation sécurisée du lecteur de paiement."}</p>
        {journey === "rental" && <p>Aucun pourboire n’est proposé pour une location.</p>}
        {processing && (
          <div className="cash-preview__terminal-actions" aria-label="Résultat de paiement simulé">
            <Button onClick={() => setState("SUCCESS")}><Check /> Accepter</Button>
            <Button variant="destructive" onClick={() => setState("DECLINED")}><X /> Refuser</Button>
            <Button variant="outline" onClick={() => setState("CANCELLED")}>Annuler</Button>
          </div>
        )}
      </section>
    );
  };

  const renderResult = () => {
    const success = state === "SUCCESS";
    const declined = state === "DECLINED";
    return (
      <section className="cash-preview__result animate-scale-in" aria-live="polite">
        <div className={`cash-preview__result-icon ${success ? "cash-preview__result-icon--success" : "cash-preview__result-icon--danger"}`}>
          {success ? <Check /> : <X />}
        </div>
        <span className="cash-preview__eyebrow">Paiement simulé</span>
        <h2>{success ? "Paiement accepté" : declined ? "Paiement refusé" : "Paiement annulé"}</h2>
        <div className="cash-preview__result-amount">CHF {formatAmount(totalCents)}</div>
        <p>{success ? "La vente est confirmée." : declined ? "Aucun montant n’a été encaissé. Vous pouvez réessayer." : "Aucun montant n’a été encaissé. Retour propre à la caisse."}</p>
        <div className="cash-preview__result-actions">
          {success && <Button onClick={() => { setAmountCents(0); setTipPercent(0); setState(journey === "stand" ? "CASHIER_READY" : "CLIENT_HOME"); }}>Nouvelle vente</Button>}
          {declined && <Button onClick={() => setState("TERMINAL_CONNECTING")}>Réessayer</Button>}
          {!success && <Button variant="outline" onClick={() => setState(journey === "stand" ? "CASHIER_READY" : "CLIENT_HOME")}>Retour à la caisse</Button>}
          <Button variant="ghost" onClick={() => setShowModeConfirm(true)}><RotateCcw /> Retour côté client</Button>
        </div>
      </section>
    );
  };

  return (
    <div className="cash-preview">
      <div className="cash-preview__viewport">
        <div className="cash-preview__screen" data-facing={facing} data-state={state}>
          <header className="cash-preview__header">
            <div className="cash-preview__header-title"><BrandLogo size="sm" /><h1>Caisse</h1></div>
            <div className="cash-preview__statuses">
              <span className="cash-preview__status"><span className="cash-preview__status-dot" /> Borne DTA21269 · En ligne</span>
              <span className="cash-preview__status"><span className={`cash-preview__status-dot ${terminalWorking ? "cash-preview__status-dot--working" : ""}`} /> WisePad 3 · {terminalWorking ? "En cours" : "Prêt"}</span>
            </div>
          </header>

          <main className="cash-preview__main">
            {state === "CLIENT_HOME" && renderClientHome()}
            {state === "ROTATING_TO_CASHIER" && renderRotation()}
            {state === "CASHIER_READY" && renderCashier()}
            {state === "TIP_SELECTION" && renderTipSelection()}
            {state === "LOCATION_PAYMENT" && renderLocationPayment()}
            {(state === "TERMINAL_CONNECTING" || state === "TERMINAL_PROCESSING") && renderTerminal()}
            {(state === "SUCCESS" || state === "DECLINED" || state === "CANCELLED") && renderResult()}
          </main>

          <footer className="cash-preview__footer">
            <span>Prévisualisation visuelle · Aucun paiement réel</span>
            <Button variant="ghost" size="sm" className="cash-preview__mode-lock" onClick={() => setShowModeConfirm(true)}>
              <LockKeyhole /> Revenir au mode Location
            </Button>
          </footer>
        </div>

        {showModeConfirm && (
          <div className="cash-preview__confirm" role="dialog" aria-modal="true" aria-labelledby="cash-mode-title">
            <div className="cash-preview__confirm-content animate-scale-in">
              <LockKeyhole aria-hidden="true" />
              <h2 id="cash-mode-title">Revenir côté client&nbsp;?</h2>
              <p>La vente simulée en cours sera réinitialisée.</p>
              <div className="cash-preview__result-actions">
                <Button variant="outline" onClick={() => setShowModeConfirm(false)}>Rester en caisse</Button>
                <Button onClick={() => { setShowModeConfirm(false); returnToClient(); }}>Confirmer la rotation</Button>
              </div>
            </div>
          </div>
        )}
      </div>

      <aside className="cash-preview__demo" aria-label="Contrôles de démonstration">
        <label htmlFor="cash-demo-state">État de démonstration</label>
        <select
          id="cash-demo-state"
          value={state === "LOCATION_PAYMENT" ? "CLIENT_HOME" : state}
          onChange={(event) => {
            const next = event.target.value as PreviewState;
            setJourney("stand");
            if (next !== "CLIENT_HOME" && amountCents === 0) setAmountCents(1250);
            setState(next);
          }}
        >
          {DEMO_STATES.map((demoState) => <option key={demoState} value={demoState}>{demoState}</option>)}
        </select>
      </aside>
    </div>
  );
}