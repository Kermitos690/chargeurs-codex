import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const admin = () => createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const escapeHtml = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
}[char]!));

const money = (value: unknown, currency = "CHF") =>
  `${(Math.round(Number(value ?? 0)) / 100).toFixed(2)} ${escapeHtml(currency)}`;

const langOf = (value: string | null) => value === "de" || value === "en" ? value : "fr";
const APP_URL = (Deno.env.get("PUBLIC_APP_URL") ?? "https://chargeurs-ch-staging.vercel.app").replace(/\/$/, "");

const css = `
:root{color-scheme:dark;--bg:#030817;--panel:rgba(10,24,57,.82);--line:rgba(255,255,255,.16);--muted:#b7c5dc;--cyan:#5ce9ff;--blue:#4588ff;--violet:#8b5cf6;--green:#74f28f}
*{box-sizing:border-box}html,body{margin:0;min-height:100%;background:var(--bg)}
body{min-height:100vh;color:#fff;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","SF Pro Text",Inter,"Segoe UI",sans-serif;background-image:radial-gradient(circle at 12% 0%,rgba(19,101,211,.7),transparent 38%),radial-gradient(circle at 92% 15%,rgba(108,45,180,.47),transparent 36%),radial-gradient(circle at 50% 110%,rgba(0,170,205,.32),transparent 48%),linear-gradient(145deg,#061532 0%,#090b2b 55%,#13072a 100%);background-attachment:fixed}
body:before{content:"";position:fixed;inset:-30%;pointer-events:none;background:conic-gradient(from 210deg,transparent,rgba(65,214,255,.08),transparent,rgba(139,92,246,.08),transparent);filter:blur(60px);animation:drift 15s linear infinite}@keyframes drift{to{transform:rotate(360deg)}}
main{position:relative;z-index:1;width:min(100%,820px);margin:auto;padding:22px 16px 46px}.top{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:4px 4px 22px}.brand{display:flex;align-items:center;gap:10px;font-size:27px;font-weight:950;letter-spacing:-1.2px}.brandMark{display:grid;place-items:center;width:42px;height:42px;border-radius:15px;background:linear-gradient(145deg,#6b63ff,#3da4ff);box-shadow:0 0 34px rgba(78,128,255,.48);font-size:23px}.brandDot{color:#52dafa}.secure{display:inline-flex;align-items:center;gap:7px;color:#d5e5fa;font-size:13px;font-weight:750;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.055);padding:9px 12px;border-radius:999px}
.glass{background:linear-gradient(145deg,rgba(17,38,86,.88),rgba(12,19,57,.78));border:1px solid var(--line);box-shadow:0 28px 90px rgba(0,0,0,.42),inset 0 1px rgba(255,255,255,.08);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);border-radius:30px}.hero{padding:30px 24px;text-align:center}.eyebrow{color:var(--cyan);font-weight:900;letter-spacing:.04em;text-transform:uppercase;font-size:13px}.hero h1{margin:8px auto 11px;max-width:640px;font-size:clamp(38px,9vw,62px);line-height:.98;letter-spacing:-2.6px;font-weight:950}.hero p{margin:0 auto;max-width:620px;color:var(--muted);font-size:18px;line-height:1.5}.facts{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:24px}.fact{padding:12px 8px;border:1px solid rgba(255,255,255,.11);border-radius:18px;background:rgba(255,255,255,.045)}.fact span{display:block;color:#92a8c9;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.04em}.fact strong{display:block;margin-top:5px;font-size:16px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:15px}.payCard{position:relative;padding:22px;overflow:hidden}.payCard:after{content:"";position:absolute;inset:auto -20% -55% 25%;height:170px;background:radial-gradient(circle,rgba(61,181,255,.22),transparent 65%);pointer-events:none}.recommended{display:inline-flex;padding:6px 10px;border-radius:999px;background:rgba(86,255,151,.13);color:#9dffb2;font-weight:900;font-size:11px;letter-spacing:.04em;text-transform:uppercase}.logos{position:relative;z-index:1;display:flex;align-items:center;gap:9px;flex-wrap:wrap;min-height:48px;margin:14px 0 16px}.logo{display:inline-flex;height:43px;align-items:center;justify-content:center;padding:0 13px;border-radius:12px;background:#fff;color:#07111f;font-weight:900;box-shadow:0 8px 22px rgba(0,0,0,.18)}.apple{font-size:20px;letter-spacing:-.5px}.gpay{font-size:18px}.gpay .g{font-weight:950;background:linear-gradient(90deg,#4285F4 0 25%,#EA4335 25% 48%,#FBBC05 48% 72%,#34A853 72%);-webkit-background-clip:text;color:transparent}.cardIcon{gap:8px}.cardIcon svg{width:26px;height:20px}.twintLogo{gap:10px;font-size:21px;letter-spacing:.5px}.twintMark{width:24px;height:24px;display:inline-grid;grid-template-columns:1fr 1fr;gap:2px;transform:rotate(45deg)}.twintMark i{display:block;border-radius:2px}.twintMark i:nth-child(1){background:#ff5a76}.twintMark i:nth-child(2){background:#65d9ee}.twintMark i:nth-child(3){background:#5be58a}.twintMark i:nth-child(4){background:#fac449}
.payCard h2{position:relative;z-index:1;margin:4px 0 8px;font-size:25px;letter-spacing:-.7px}.copy{position:relative;z-index:1;margin:0;color:var(--muted);font-size:15px;line-height:1.52}.button{position:relative;z-index:1;display:block;width:100%;border:0;border-radius:18px;padding:17px 16px;margin-top:19px;font:inherit;font-size:17px;font-weight:950;cursor:pointer;color:#031021;background:linear-gradient(110deg,#64ecff,#5899ff,#a786ff);box-shadow:0 12px 32px rgba(63,137,255,.26)}.button.twint{background:#fff;color:#111827}.button:active{transform:scale(.985)}
.legal{display:flex;align-items:flex-start;gap:11px;margin-top:14px;padding:16px 17px;font-size:13px;line-height:1.45;color:#bdc9db}.legal input{flex:0 0 auto;width:21px;height:21px;margin:0;accent-color:#63dfff}.legal a{color:#78e9ff;font-weight:850}.error{margin:14px 3px 0;padding:13px 15px;border-radius:16px;background:rgba(244,63,94,.12);border:1px solid rgba(251,113,133,.24);color:#fecdd3;font-weight:800;text-align:center}.foot{text-align:center;color:#91a4bf;font-size:12px;margin:17px 0 0}.price{font-size:clamp(52px,13vw,76px);font-weight:950;letter-spacing:-3px;background:linear-gradient(90deg,#69efff,#83b8ff,#c4aaff);-webkit-background-clip:text;color:transparent}.rows{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:24px}.row{padding:15px;border-radius:17px;background:rgba(255,255,255,.055);border:1px solid rgba(255,255,255,.09);text-align:left}.label{font-size:10px;text-transform:uppercase;color:#8ca3c4;font-weight:900;letter-spacing:.07em}.value{margin-top:6px;font-size:17px;font-weight:900;word-break:break-word}.icon{width:82px;height:82px;border-radius:999px;display:grid;place-items:center;margin:auto;background:rgba(68,255,131,.13);border:1px solid rgba(111,255,151,.23);color:#99ffb1;font-size:38px}.spin{width:62px;height:62px;border-radius:50%;border:6px solid rgba(255,255,255,.12);border-top-color:#65eaff;animation:spin 1s linear infinite;margin:18px auto}@keyframes spin{to{transform:rotate(360deg)}}.faq{margin-top:14px;padding:18px 20px}.faq summary{cursor:pointer;font-weight:900;font-size:15px}.faq p{color:var(--muted);font-size:14px;line-height:1.5;margin:10px 0 2px}
@media(max-width:650px){main{padding:17px 13px 36px}.top{margin-bottom:15px}.brand{font-size:23px}.brandMark{width:38px;height:38px}.secure{font-size:11px;padding:8px 9px}.hero{padding:25px 18px}.hero h1{font-size:clamp(37px,11vw,54px)}.hero p{font-size:16px}.facts{grid-template-columns:1fr 1fr}.grid,.rows{grid-template-columns:1fr}.payCard{padding:20px}.button{font-size:17px;padding:17px}.logo{height:41px}}
`;

function documentHtml(title: string, body: string, lang: string, refreshSeconds?: number) {
  const refresh = refreshSeconds ? `<meta http-equiv="refresh" content="${refreshSeconds}">` : "";
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta http-equiv="Content-Type" content="text/html; charset=utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#030817">${refresh}<title>${escapeHtml(title)} · Chargeurs.ch</title><style>${css}</style></head><body><main><div class="top"><div class="brand"><span class="brandMark">⚡</span><span>Chargeurs<span class="brandDot">.ch</span></span></div><span class="secure">🔒 Paiement sécurisé</span></div>${body}<p class="foot">Chargeurs.ch · location de batteries nomades en Suisse</p></main></body></html>`;
}

function htmlResponse(html: string, status = 200) {
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  return new Response(blob, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      "Pragma": "no-cache",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    },
  });
}

function durationMinutes(start: unknown, end: unknown) {
  if (!start || !end) return 0;
  return Math.max(0, Math.ceil((Date.parse(String(end)) - Date.parse(String(start))) / 60000));
}

function logosCard() {
  return `<div class="logos" aria-label="Carte, Apple Pay et Google Pay"><span class="logo apple"> Pay</span><span class="logo gpay"><span class="g">G</span>&nbsp;Pay</span><span class="logo cardIcon"><svg viewBox="0 0 32 22" aria-hidden="true"><rect x="1" y="1" width="30" height="20" rx="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M2 7h28" stroke="currentColor" stroke-width="2"/></svg>Carte</span></div>`;
}

function logoTwint() {
  return `<div class="logos" aria-label="TWINT"><span class="logo twintLogo"><span class="twintMark" aria-hidden="true"><i></i><i></i><i></i><i></i></span>TWINT</span></div>`;
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const id = url.searchParams.get("rental") ?? "";
  const code = url.searchParams.get("c") ?? "";
  const lang = langOf(url.searchParams.get("lang"));
  const view = url.searchParams.get("view") ?? "choose";
  const db = admin();

  if (!id || code.length < 4) {
    return htmlResponse(documentHtml("Session invalide", `<section class="glass hero"><div class="icon">!</div><h1>Session indisponible</h1><p>Cette location n’est plus accessible.</p></section>`, lang), 400);
  }

  const { data: rental, error: rentalError } = await db.from("rental_sessions")
    .select("*")
    .eq("id", id)
    .eq("public_session_code", code)
    .maybeSingle();

  if (rentalError || !rental) {
    return htmlResponse(documentHtml("Session invalide", `<section class="glass hero"><div class="icon">!</div><h1>Session indisponible</h1><p>Vérifiez le QR affiché sur la borne.</p></section>`, lang), 404);
  }

  if (req.method === "POST") {
    const form = await req.formData();
    const mode = form.get("paymentMode") === "twint_prepaid" ? "twint_prepaid" : "card_hold";
    const accepted = form.get("accepted") === "yes";
    if (!accepted) {
      return new Response(null, { status: 303, headers: { Location: `${url.origin}${url.pathname}?rental=${encodeURIComponent(id)}&c=${encodeURIComponent(code)}&lang=${lang}&error=terms` } });
    }

    const target = `${(Deno.env.get("SUPABASE_URL") ?? "").replace(/\/$/, "")}/functions/v1/public-stripe-checkout`;
    const response = await fetch(target, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rentalSessionId: id, publicCode: code, paymentMode: mode, accepted: true, language: lang }),
    });
    const out = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (response.ok && typeof out?.checkoutUrl === "string") {
      return new Response(null, { status: 303, headers: { Location: out.checkoutUrl } });
    }
    if (response.ok && typeof out?.progressUrl === "string") {
      return new Response(null, { status: 303, headers: { Location: out.progressUrl } });
    }
    const error = typeof out?.error === "string" ? out.error : "payment";
    return new Response(null, { status: 303, headers: { Location: `${url.origin}${url.pathname}?rental=${encodeURIComponent(id)}&c=${encodeURIComponent(code)}&lang=${lang}&error=${encodeURIComponent(error)}` } });
  }

  const snap = rental.pricing_snapshot ?? {};
  const currency = String(rental.currency ?? "CHF");
  const deposit = Number(rental.deposit_amount_cents ?? snap.deposit_cents ?? 3000);
  const period = Number(snap.period_minutes ?? 30);
  const perPeriod = Number(snap.price_per_period_cents ?? 0);
  const hourly = period ? Math.round(perPeriod * 60 / period) : 0;
  const daily = Number(snap.daily_cap_cents ?? 0);
  const minimum = Number(snap.min_amount_cents ?? 0);
  const nonReturn = Number(snap.unreturned_fee_cents ?? 9900);

  if (view === "choose" && !rental.paid_at) {
    const copy = lang === "de" ? {
      eyebrow: "Sicher · schnell · transparent",
      title: "Zahlungsart wählen",
      sub: `Der Mietpreis bleibt gleich. Die Miete hat einen Mindestbetrag von ${money(minimum, currency)}, der ab Bereitstellung der Powerbank gilt. ${rental.customer_segment === "member" ? "Pass-Guthaben wird zuerst vom gleichen Endpreis abgezogen; der Mindestbetrag bleibt gleich. " : ""}Nur die Behandlung der CHF-30-Garantie hängt von der Zahlungsart ab.`,
      cardTitle: "Karte & Wallet",
      cardText: `${money(deposit, currency)} werden vorübergehend bei Ihrer Bank reserviert. Bei Rückgabe wird nur der tatsächliche Mietpreis belastet und der Rest freigegeben.`,
      twintTitle: "TWINT",
      twintText: `${money(deposit, currency)} werden zu Beginn belastet. Nach Rückgabe wird der tatsächliche Preis berechnet und die Differenz automatisch zurückerstattet.`,
      cardButton: "Mit Karte oder Wallet fortfahren",
      twintButton: "Mit TWINT fortfahren",
      legal: "Ich akzeptiere die Nutzungsbedingungen und habe die Datenschutzerklärung gelesen.",
    } : lang === "en" ? {
      eyebrow: "Secure · fast · transparent",
      title: "Choose how to pay",
      sub: `The rental price is identical. A minimum rental charge of ${money(minimum, currency)} applies when the powerbank is made available. ${rental.customer_segment === "member" ? "Pass credit is deducted from that same final price first; the minimum stays the same. " : ""}Only the CHF 30 guarantee mechanism changes with the payment method.`,
      cardTitle: "Card & wallet",
      cardText: `${money(deposit, currency)} is temporarily authorised by your bank. On return, only the actual rental price is captured and the remainder is released.`,
      twintTitle: "TWINT",
      twintText: `${money(deposit, currency)} is charged at the start. On return, the actual price is calculated and the difference is automatically refunded.`,
      cardButton: "Continue with card or wallet",
      twintButton: "Continue with TWINT",
      legal: "I accept the Terms of Use and have read the Privacy Policy.",
    } : {
      eyebrow: "Simple · rapide · transparent",
      title: "Choisissez comment payer",
      sub: `Le tarif ne change pas. Un minimum de location de ${money(minimum, currency)} s’applique dès la mise à disposition de la batterie, même pour une location très courte. ${rental.customer_segment === "member" ? "Le crédit Pass est d’abord déduit de ce même prix final ; le minimum reste identique. " : ""}Seul le fonctionnement de la garantie de 30 CHF dépend du moyen choisi.`,
      cardTitle: "Carte & wallet",
      cardText: `${money(deposit, currency)} sont temporairement réservés auprès de votre banque. Au retour, seul le prix réel de la location est prélevé et le solde est libéré.`,
      twintTitle: "TWINT",
      twintText: `${money(deposit, currency)} sont débités au départ. Au retour, le prix réel est calculé et la différence est automatiquement remboursée.`,
      cardButton: "Continuer avec carte ou wallet",
      twintButton: "Continuer avec TWINT",
      legal: "J’accepte les Conditions d’utilisation et reconnais avoir lu la Politique de confidentialité.",
    };

    const errorParam = url.searchParams.get("error");
    const errorHtml = errorParam ? `<div class="error">${errorParam === "terms" ? "Veuillez accepter les conditions pour continuer." : "Le paiement n’a pas pu être préparé. Réessayez depuis cette page."}</div>` : "";
    const legalTerms = `${APP_URL}/legal/conditions`;
    const legalPrivacy = `${APP_URL}/legal/confidentialite`;

    const body = `<section class="glass hero"><div class="eyebrow">${copy.eyebrow}</div><h1>${copy.title}</h1><p>${copy.sub}</p><div class="facts"><div class="fact"><span>Tarif</span><strong>${money(hourly, currency)} / h</strong></div><div class="fact"><span>Garantie</span><strong>${money(deposit, currency)}</strong></div><div class="fact"><span>Plafond / jour</span><strong>${money(daily, currency)}</strong></div><div class="fact"><span>Non-retour</span><strong>${money(nonReturn, currency)}</strong></div></div></section>${errorHtml}<form method="post"><div class="grid"><section class="glass payCard"><span class="recommended">Recommandé</span>${logosCard()}<h2>${copy.cardTitle}</h2><p class="copy">${copy.cardText}</p><button class="button" name="paymentMode" value="card_hold">${copy.cardButton}</button></section><section class="glass payCard">${logoTwint()}<h2>${copy.twintTitle}</h2><p class="copy">${copy.twintText}</p><button class="button twint" name="paymentMode" value="twint_prepaid">${copy.twintButton}</button></section></div><label class="glass legal"><input type="checkbox" name="accepted" value="yes" required><span>${copy.legal} <a href="${legalTerms}" target="_blank" rel="noopener">Conditions</a> · <a href="${legalPrivacy}" target="_blank" rel="noopener">Confidentialité</a></span></label></form><details class="glass faq"><summary>Comment fonctionne la location ?</summary><p>Scannez le QR, choisissez votre moyen de paiement, validez la garantie puis revenez devant la borne. La location commence uniquement après la sortie physique confirmée de la batterie. Au retour, le prix exact est calculé automatiquement et un récapitulatif est affiché.</p></details>`;
    return htmlResponse(documentHtml(copy.title, body, lang));
  }

  const state = String(rental.state ?? "");
  const settled = state === "completed" && rental.settlement_status === "settled";
  if (settled) {
    const final = Number(rental.final_amount_cents ?? 0);
    const captured = Number(rental.captured_amount_cents ?? 0);
    const refunded = Number(rental.refunded_amount_cents ?? 0);
    const released = rental.settlement_strategy === "manual_capture" ? Math.max(0, deposit - captured) : 0;
    const method = rental.checkout_payment_mode === "twint_prepaid" ? "TWINT" : "Carte / wallet";
    const duration = durationMinutes(rental.started_at, rental.returned_at);
    const title = lang === "de" ? "Miete abgeschlossen" : lang === "en" ? "Rental completed" : "Location terminée";
    const body = `<section class="glass hero"><div class="icon">✓</div><h1>${title}</h1><div class="price">${money(final, currency)}</div><p>Prix final confirmé</p><div class="rows"><div class="row"><div class="label">Durée</div><div class="value">${duration} min</div></div><div class="row"><div class="label">Moyen</div><div class="value">${method}</div></div><div class="row"><div class="label">Garantie</div><div class="value">${money(deposit, currency)}</div></div><div class="row"><div class="label">Montant capturé</div><div class="value">${money(captured, currency)}</div></div><div class="row"><div class="label">${rental.settlement_strategy === "manual_capture" ? "Autorisation libérée" : "Remboursement"}</div><div class="value">${money(rental.settlement_strategy === "manual_capture" ? released : refunded, currency)}</div></div><div class="row"><div class="label">Borne de retour</div><div class="value">${escapeHtml(rental.return_station_id ?? "—")}</div></div><div class="row"><div class="label">Slot</div><div class="value">${escapeHtml(rental.returned_slot_num ?? "—")}</div></div><div class="row"><div class="label">Référence</div><div class="value">${escapeHtml(rental.public_session_code)}</div></div></div></section>`;
    return htmlResponse(documentHtml(title, body, lang, 30));
  }

  let title = lang === "de" ? "Garantie bestätigt" : lang === "en" ? "Guarantee confirmed" : "Garantie confirmée";
  let text = lang === "de" ? "Die Station bereitet Ihre Batterie vor." : lang === "en" ? "The station is preparing your powerbank." : "La borne prépare votre batterie.";
  let spinner = true;
  if (["ejected", "active_rental", "battery_taken"].includes(state)) {
    title = lang === "de" ? "Miete läuft" : lang === "en" ? "Rental in progress" : "Location en cours";
    text = lang === "de" ? "Die Batterie wurde ausgegeben. Der Tarif läuft bis zur Rückgabe." : lang === "en" ? "The powerbank has been released. Pricing continues until return." : "La batterie est sortie. Le tarif continue jusqu’à son retour.";
    spinner = false;
  } else if (state === "battery_returned") {
    title = lang === "de" ? "Rückgabe erkannt" : lang === "en" ? "Return detected" : "Retour détecté";
    text = lang === "de" ? "Der genaue Betrag wird berechnet." : lang === "en" ? "The exact amount is being calculated." : "Le montant exact est calculé et le règlement finalisé.";
  } else if (state === "needs_support") {
    title = lang === "de" ? "Prüfung erforderlich" : lang === "en" ? "Review required" : "Vérification nécessaire";
    text = lang === "de" ? "Die Rückgabe oder Abrechnung wird geprüft." : lang === "en" ? "The return or settlement is being reviewed." : "Le retour ou le règlement nécessite une vérification.";
    spinner = false;
  }
  const body = `<section class="glass hero">${spinner ? '<div class="spin"></div>' : '<div class="icon">✓</div>'}<h1>${title}</h1><p>${text}</p><div class="fact" style="display:inline-block;margin-top:18px"><strong>${escapeHtml(rental.public_session_code)}</strong></div></section>`;
  return htmlResponse(documentHtml(title, body, lang, 3));
});
