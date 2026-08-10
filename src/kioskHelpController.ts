type KioskHelpLang = "fr" | "en" | "de";

type HelpCopy = {
  kicker: string;
  title: string;
  close: string;
  items: Array<{ title: string; body: string }>;
  footer: string;
};

const HELP_COPY: Record<KioskHelpLang, HelpCopy> = {
  fr: {
    kicker: "AIDE BORNE",
    title: "Besoin d’un coup de main ?",
    close: "Fermer",
    items: [
      { title: "Comment louer une batterie ?", body: "Choisissez une batterie disponible, confirmez le tarif puis scannez le QR de paiement avec votre téléphone." },
      { title: "Comment fonctionne la garantie ?", body: "Une garantie de 30 CHF peut être autorisée lors du paiement. Le montant final dépend de la durée réelle de location." },
      { title: "La batterie ne sort pas", body: "Ne relancez pas un second paiement. Attendez l’état affiché à l’écran puis utilisez Réessayer ou contactez le support avec la référence de la borne." },
      { title: "Comment rendre la batterie ?", body: "Insérez la powerbank dans un emplacement de retour disponible sur une borne Chargeurs.ch et attendez la confirmation à l’écran." },
      { title: "Puis-je rendre ailleurs ?", body: "Oui, sur une autre borne du réseau Chargeurs.ch lorsqu’un emplacement de retour est disponible." },
      { title: "Comment est calculé le prix ?", body: "Le tarif est calculé selon la durée de location, avec le plafond journalier affiché avant le paiement." },
    ],
    footer: "Support : support@chargeurs.ch · Borne : ",
  },
  en: {
    kicker: "KIOSK HELP",
    title: "Need a hand?",
    close: "Close",
    items: [
      { title: "How do I rent a powerbank?", body: "Choose an available battery, confirm the price, then scan the payment QR code with your phone." },
      { title: "How does the deposit work?", body: "A CHF 30 deposit may be authorised during payment. The final amount depends on the actual rental duration." },
      { title: "The battery did not eject", body: "Do not start a second payment. Wait for the on-screen status, then retry or contact support with the kiosk reference." },
      { title: "How do I return it?", body: "Insert the powerbank into an available return slot on a Chargeurs.ch kiosk and wait for the confirmation." },
      { title: "Can I return it elsewhere?", body: "Yes, at another Chargeurs.ch kiosk when a return slot is available." },
      { title: "How is the final price calculated?", body: "Pricing follows the rental duration, with the daily cap shown before payment." },
    ],
    footer: "Support: support@chargeurs.ch · Kiosk: ",
  },
  de: {
    kicker: "AUTOMATEN-HILFE",
    title: "Brauchen Sie Hilfe?",
    close: "Schließen",
    items: [
      { title: "Wie miete ich eine Powerbank?", body: "Verfügbare Batterie wählen, Preis bestätigen und anschließend den Zahlungs-QR-Code mit dem Smartphone scannen." },
      { title: "Wie funktioniert die Garantie?", body: "Bei der Zahlung kann eine Garantie von 30 CHF autorisiert werden. Der Endpreis richtet sich nach der tatsächlichen Mietdauer." },
      { title: "Die Batterie kommt nicht heraus", body: "Keine zweite Zahlung starten. Den Status am Bildschirm abwarten und danach erneut versuchen oder den Support mit der Automatenreferenz kontaktieren." },
      { title: "Wie gebe ich die Batterie zurück?", body: "Die Powerbank in ein verfügbares Rückgabefach einer Chargeurs.ch-Borne einsetzen und die Bestätigung am Bildschirm abwarten." },
      { title: "Kann ich an einer anderen Borne zurückgeben?", body: "Ja, an einer anderen Chargeurs.ch-Borne, sofern ein Rückgabefach verfügbar ist." },
      { title: "Wie wird der Endpreis berechnet?", body: "Der Preis richtet sich nach der Mietdauer; das Tageslimit wird vor der Zahlung angezeigt." },
    ],
    footer: "Support: support@chargeurs.ch · Automat: ",
  },
};

const getLang = (): KioskHelpLang => {
  try {
    const stored = localStorage.getItem("chargeurs.kiosk.language") ?? localStorage.getItem("lang") ?? "";
    if (stored.startsWith("de")) return "de";
    if (stored.startsWith("en")) return "en";
  } catch { /* noop */ }
  const htmlLang = document.documentElement.lang.toLowerCase();
  if (htmlLang.startsWith("de")) return "de";
  if (htmlLang.startsWith("en")) return "en";
  return "fr";
};

const currentStation = () => {
  const hashPath = window.location.hash.replace(/^#/, "");
  const path = hashPath.startsWith("/kiosk") ? hashPath : window.location.pathname;
  const match = path.match(/^\/kiosk\/([^/?#]+)/);
  return match ? decodeURIComponent(match[1]) : "—";
};

function buildHelpOverlay() {
  document.getElementById("chargeurs-kiosk-help-overlay")?.remove();
  const copy = HELP_COPY[getLang()];

  const overlay = document.createElement("div");
  overlay.id = "chargeurs-kiosk-help-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", copy.title);

  const shell = document.createElement("section");
  shell.className = "ckh-shell";

  const head = document.createElement("header");
  head.className = "ckh-head";
  const titleWrap = document.createElement("div");
  const kicker = document.createElement("div");
  kicker.className = "ckh-kicker";
  kicker.textContent = copy.kicker;
  const title = document.createElement("h2");
  title.textContent = copy.title;
  titleWrap.append(kicker, title);

  const close = document.createElement("button");
  close.type = "button";
  close.className = "ckh-close";
  close.setAttribute("aria-label", copy.close);
  close.textContent = "×";
  head.append(titleWrap, close);

  const grid = document.createElement("div");
  grid.className = "ckh-grid";
  copy.items.forEach((item) => {
    const card = document.createElement("article");
    card.className = "ckh-item";
    const strong = document.createElement("strong");
    strong.textContent = item.title;
    const p = document.createElement("p");
    p.textContent = item.body;
    card.append(strong, p);
    grid.append(card);
  });

  const foot = document.createElement("footer");
  foot.className = "ckh-foot";
  foot.textContent = `${copy.footer}${currentStation()}`;

  shell.append(head, grid, foot);
  overlay.append(shell);

  const dismiss = () => overlay.remove();
  close.addEventListener("click", dismiss);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) dismiss();
  });
  document.body.append(overlay);
}

let installed = false;
export function initKioskHelpController() {
  if (installed) return;
  installed = true;
  window.addEventListener("chargeurs:open-kiosk-help", buildHelpOverlay);
}
