import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import Stripe from "https://esm.sh/stripe@17.7.0?target=deno";

const admin = () => createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

type Locale = "fr" | "de" | "en";
type PaymentSemantics = "card_hold" | "twint_prepaid" | "prepaid_other";

function money(value: unknown, currency = "CHF") {
  return `${(Math.round(Number(value ?? 0)) / 100).toFixed(2)} ${currency}`;
}
function minutes(start: string | null, end: string | null) {
  if (!start || !end) return 0;
  return Math.max(0, Math.ceil((Date.parse(end) - Date.parse(start)) / 60000));
}
function esc(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
  }[char]!));
}
function locale(value: string): Locale {
  return value === "de" || value === "en" ? value : "fr";
}
async function secret(db: any, name: string) {
  const { data, error } = await db.rpc("internal_transactional_email_secret", { p_name: name });
  if (error) throw new Error(`EMAIL_SECRET_${name.toUpperCase()}_UNAVAILABLE`);
  return String(data ?? "");
}

function semantics(rental: any): PaymentSemantics {
  const method = String(rental.stripe_payment_method_type ?? "").toLowerCase();
  if (method === "twint" || rental.checkout_payment_mode === "twint_prepaid") return "twint_prepaid";
  if (rental.settlement_strategy === "manual_capture" || rental.checkout_payment_mode === "card_hold" || method === "card") {
    return "card_hold";
  }
  return "prepaid_other";
}

async function paymentLabel(rental: any): Promise<string> {
  const type = String(rental.stripe_payment_method_type ?? "").toLowerCase();
  if (type === "twint") return "TWINT";
  if (type === "link") return "Link";
  if (type !== "card") return type ? type.toUpperCase() : "Paiement";

  const paymentMethodId = String(rental.stripe_payment_method_id ?? "");
  const stripeKey = (Deno.env.get("STRIPE_SECRET_KEY") ?? "").trim();
  if (!paymentMethodId || !(stripeKey.startsWith("sk_test_") || stripeKey.startsWith("rk_test_") || stripeKey.startsWith("sk_live_") || stripeKey.startsWith("rk_live_"))) {
    return "Carte";
  }
  try {
    const stripe = new Stripe(stripeKey, {
      apiVersion: "2024-12-18.acacia",
      httpClient: Stripe.createFetchHttpClient(),
    });
    const method = await stripe.paymentMethods.retrieve(paymentMethodId) as any;
    const wallet = method?.card?.wallet?.type;
    if (wallet === "apple_pay") return "Apple Pay";
    if (wallet === "google_pay") return "Google Pay";
    if (wallet === "link") return "Link";
    return "Carte";
  } catch {
    return "Carte";
  }
}

function template(row: any, rental: any, paymentMethod: string) {
  const l = locale(row.locale);
  const currency = String(rental.currency ?? "CHF");
  const snap = rental.pricing_snapshot ?? {};
  const period = Number(snap.period_minutes ?? 30);
  const per = Number(snap.price_per_period_cents ?? 0);
  const daily = Number(snap.daily_cap_cents ?? 0);
  const nonReturn = Number(snap.unreturned_fee_cents ?? 9900);
  const deposit = Number(rental.deposit_amount_cents ?? snap.deposit_cents ?? 3000);
  const code = esc(rental.public_session_code ?? "");
  const mode = semantics(rental);
  let subject = "";
  let title = "";
  let body = "";

  if (row.template_key === "payment_secured") {
    if (l === "de") {
      subject = "Chargeurs.ch – Mietgarantie bestätigt";
      title = "Ihre Mietgarantie ist bestätigt";
      body = mode === "card_hold"
        ? `Ihre Bank hat ${money(deposit, currency)} vorübergehend autorisiert. Der Betrag wird zu Mietbeginn nicht endgültig eingezogen. Nach der Rückgabe wird nur der tatsächliche Mietpreis belastet; die verbleibende Autorisierung wird zur Freigabe angefordert.`
        : mode === "twint_prepaid"
          ? `TWINT hat ${money(deposit, currency)} als Mietgarantie belastet. Nach der bestätigten Rückgabe berechnet Chargeurs.ch den tatsächlichen Mietpreis und erstattet die nicht benötigte Differenz automatisch.`
          : `Die gewählte Zahlungsart hat ${money(deposit, currency)} als Mietgarantie belastet. Nach der bestätigten Rückgabe wird der tatsächliche Mietpreis berechnet und ein nicht benötigter Restbetrag gemäss Zahlungsart zurückerstattet.`;
    } else if (l === "en") {
      subject = "Chargeurs.ch – Rental guarantee confirmed";
      title = "Your rental guarantee is confirmed";
      body = mode === "card_hold"
        ? `Your bank has temporarily authorised ${money(deposit, currency)}. It is not finally captured at rental start. After return, only the actual rental price is captured and release of the remaining authorisation is requested.`
        : mode === "twint_prepaid"
          ? `TWINT has charged ${money(deposit, currency)} as the rental guarantee. After the confirmed return, Chargeurs.ch calculates the actual rental price and automatically refunds the unused difference.`
          : `Your selected payment method has charged ${money(deposit, currency)} as the rental guarantee. After the confirmed return, the actual rental price is calculated and any unused balance is refunded according to that payment method.`;
    } else {
      subject = "Chargeurs.ch — Garantie de location confirmée";
      title = "Votre garantie de location est confirmée";
      body = mode === "card_hold"
        ? `Votre banque a temporairement autorisé ${money(deposit, currency)}. Cette somme n’est pas définitivement encaissée au début de la location. Après le retour, seul le prix réel est capturé et la libération du solde de l’autorisation est demandée.`
        : mode === "twint_prepaid"
          ? `TWINT a débité ${money(deposit, currency)} au titre de la garantie de location. Après le retour confirmé, Chargeurs.ch calcule le prix réel et rembourse automatiquement la différence non utilisée.`
          : `Le moyen de paiement choisi a débité ${money(deposit, currency)} au titre de la garantie de location. Après le retour confirmé, le prix réel est calculé et le solde non utilisé est remboursé selon ce moyen de paiement.`;
    }
  } else if (row.template_key === "rental_started") {
    const started = new Date(rental.started_at);
    const startedLabel = started.toLocaleTimeString(l === "de" ? "de-CH" : l === "en" ? "en-CH" : "fr-CH", { hour: "2-digit", minute: "2-digit" });
    if (l === "de") {
      subject = "Chargeurs.ch – Ihre Miete hat begonnen";
      title = "Ihre Powerbank wurde ausgegeben";
      body = `Die physische Ausgabe wurde bestätigt und Ihre Miete hat um ${startedLabel} begonnen. Tarif: ${money(per, currency)} pro ${period} Minuten, Tageslimit ${money(daily, currency)}. Zahlungsart: ${esc(paymentMethod)}. Bei Nichtrückgabe können gemäss Bedingungen insgesamt bis zu ${money(nonReturn, currency)} fällig werden.`;
    } else if (l === "en") {
      subject = "Chargeurs.ch – Your rental has started";
      title = "Your powerbank has been released";
      body = `Physical release was confirmed and your rental started at ${startedLabel}. Rate: ${money(per, currency)} per ${period} minutes, daily cap ${money(daily, currency)}. Payment method: ${esc(paymentMethod)}. Under the terms, non-return can result in a total amount due of up to ${money(nonReturn, currency)}.`;
    } else {
      subject = "Chargeurs.ch — Votre location a commencé";
      title = "Votre batterie est sortie";
      body = `La sortie physique a été confirmée et votre location a commencé à ${startedLabel}. Tarif : ${money(per, currency)} par ${period} minutes, plafond journalier ${money(daily, currency)}. Moyen de paiement : ${esc(paymentMethod)}. En cas de non-retour, un montant total pouvant aller jusqu’à ${money(nonReturn, currency)} peut être dû selon les conditions.`;
    }
  } else {
    const duration = minutes(rental.started_at, rental.returned_at);
    const final = Number(rental.final_amount_cents ?? 0);
    const captured = Number(rental.captured_amount_cents ?? 0);
    const refunded = Number(rental.refunded_amount_cents ?? 0);
    const released = rental.settlement_strategy === "manual_capture" ? Math.max(0, deposit - captured) : 0;
    const financial = rental.settlement_strategy === "manual_capture"
      ? `${l === "de" ? "Freizugebende Autorisierung" : l === "en" ? "Authorisation release requested" : "Libération d’autorisation demandée"}: ${money(released, currency)}`
      : `${l === "de" ? "Rückerstattung" : l === "en" ? "Refund" : "Remboursement"}: ${money(refunded, currency)}`;

    if (l === "de") {
      subject = `Chargeurs.ch – Beleg ${code}`;
      title = "Miete abgeschlossen";
      body = `Endpreis: ${money(final, currency)}. Dauer: ${duration} Minuten. Anfangsgarantie: ${money(deposit, currency)}. Belasteter Betrag: ${money(captured, currency)}. ${financial}. Zahlungsart: ${esc(paymentMethod)}. Rückgabestation: ${esc(rental.return_station_id ?? "—")}.`;
    } else if (l === "en") {
      subject = `Chargeurs.ch – Receipt ${code}`;
      title = "Rental completed";
      body = `Final price: ${money(final, currency)}. Duration: ${duration} minutes. Initial guarantee: ${money(deposit, currency)}. Captured amount: ${money(captured, currency)}. ${financial}. Payment method: ${esc(paymentMethod)}. Return station: ${esc(rental.return_station_id ?? "—")}.`;
    } else {
      subject = `Chargeurs.ch — Reçu ${code}`;
      title = "Location terminée";
      body = `Prix final : ${money(final, currency)}. Durée : ${duration} minutes. Garantie initiale : ${money(deposit, currency)}. Montant capturé : ${money(captured, currency)}. ${financial}. Moyen de paiement : ${esc(paymentMethod)}. Borne de retour : ${esc(rental.return_station_id ?? "—")}.`;
    }
  }

  const footer = l === "de"
    ? "Diese Nachricht betrifft ausschliesslich Ihre Transaktion. Support: support@chargeurs.ch"
    : l === "en"
      ? "This message relates only to your transaction. Support: support@chargeurs.ch"
      : "Ce message concerne uniquement votre transaction. Support : support@chargeurs.ch";

  return {
    subject,
    html: `<!doctype html><html><body style="margin:0;background:#071126;color:#eff6ff;font-family:Arial,sans-serif"><div style="max-width:620px;margin:0 auto;padding:32px"><div style="font-size:26px;font-weight:800;color:#67e8f9">Chargeurs.ch</div><div style="margin-top:24px;background:#0d1b38;border:1px solid #1e3a5f;border-radius:20px;padding:28px"><h1 style="margin:0 0 16px;font-size:28px">${title}</h1><p style="font-size:16px;line-height:1.65;color:#cbd5e1">${body}</p><div style="margin-top:22px;padding:14px;border-radius:12px;background:#081329"><strong>${l === "de" ? "Referenz" : l === "en" ? "Reference" : "Référence"}</strong><br>${code}</div><p style="margin-top:22px;font-size:13px;line-height:1.5;color:#94a3b8">${footer}<br><a style="color:#67e8f9" href="https://chargeurs.ch/legal/terms">${l === "de" ? "Nutzungsbedingungen" : l === "en" ? "Terms of Use" : "Conditions d’utilisation"}</a> · <a style="color:#67e8f9" href="https://chargeurs.ch/legal/privacy">Privacy</a></p></div></div></body></html>`,
  };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "METHOD_NOT_ALLOWED" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const db = admin();
  const body = await req.json().catch(() => ({}));
  const expected = await secret(db, "transactional_email_dispatch_key");
  if (!expected || body.dispatchKey !== expected) {
    return new Response(JSON.stringify({ ok: false, error: "FORBIDDEN" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  const vaultResend = await secret(db, "resend_api_key").catch(() => "");
  const vaultFrom = await secret(db, "transactional_email_from").catch(() => "");
  const apiKey = (Deno.env.get("RESEND_API_KEY") ?? vaultResend).trim();
  const from = (Deno.env.get("TRANSACTIONAL_EMAIL_FROM") ?? vaultFrom ?? "").trim() || "Chargeurs.ch <noreply@chargeurs.ch>";
  if (!apiKey) {
    return new Response(JSON.stringify({ ok: true, configured: false, queued: true, reason: "EMAIL_PROVIDER_NOT_CONFIGURED" }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const { data: rows, error } = await db.from("transactional_email_outbox")
    .select("*")
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(10);
  if (error) throw error;

  let sent = 0;
  let failed = 0;
  for (const row of rows ?? []) {
    const claimedAt = new Date().toISOString();
    const { data: claimed } = await db.from("transactional_email_outbox")
      .update({ status: "sending", attempts: Number(row.attempts ?? 0) + 1, updated_at: claimedAt })
      .eq("id", row.id)
      .eq("status", "queued")
      .select("id")
      .maybeSingle();
    if (!claimed) continue;

    const { data: rental } = await db.from("rental_sessions").select("*").eq("id", row.rental_session_id).maybeSingle();
    if (!rental) {
      await db.from("transactional_email_outbox").update({ status: "failed", last_error: "RENTAL_NOT_FOUND", updated_at: new Date().toISOString() }).eq("id", row.id);
      failed += 1;
      continue;
    }

    const method = await paymentLabel(rental);
    const mail = template(row, rental, method);
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from,
          to: [row.to_email],
          subject: mail.subject,
          html: mail.html,
          headers: { "X-Entity-Ref-ID": `${row.rental_session_id}:${row.template_key}` },
        }),
      });
      if (!response.ok) throw new Error(`RESEND_HTTP_${response.status}`);

      const now = new Date().toISOString();
      await db.from("transactional_email_outbox").update({ status: "sent", sent_at: now, last_error: null, updated_at: now }).eq("id", row.id);
      const field = row.template_key === "payment_secured"
        ? "payment_confirmation_email_sent_at"
        : row.template_key === "rental_started"
          ? "rental_started_email_sent_at"
          : "rental_receipt_email_sent_at";
      await db.from("rental_sessions").update({ [field]: now }).eq("id", row.rental_session_id);
      sent += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "EMAIL_SEND_FAILED";
      const attempts = Number(row.attempts ?? 0) + 1;
      await db.from("transactional_email_outbox").update({
        status: attempts >= 5 ? "failed" : "queued",
        last_error: message.slice(0, 160),
        updated_at: new Date().toISOString(),
      }).eq("id", row.id);
      failed += 1;
    }
  }

  return new Response(JSON.stringify({ ok: true, configured: true, processed: (rows ?? []).length, sent, failed }), {
    headers: { "Content-Type": "application/json" },
  });
});
