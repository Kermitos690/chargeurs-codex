import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const admin = () => createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

type Locale = "fr" | "de" | "en";

function esc(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
  }[char]!));
}
function locale(value: unknown): Locale {
  return value === "de" || value === "en" ? value : "fr";
}
function money(cents: unknown, currency = "CHF") {
  return `${(Math.round(Number(cents ?? 0)) / 100).toFixed(2)} ${esc(currency)}`;
}
function dateLabel(value: unknown, l: Locale) {
  if (!value || Number.isNaN(Date.parse(String(value)))) return "—";
  return new Intl.DateTimeFormat(l === "de" ? "de-CH" : l === "en" ? "en-CH" : "fr-CH", {
    dateStyle: "long",
  }).format(new Date(String(value)));
}
async function secret(db: any, name: string) {
  const { data, error } = await db.rpc("internal_transactional_email_secret", { p_name: name });
  if (error) throw new Error(`EMAIL_SECRET_${name.toUpperCase()}_UNAVAILABLE`);
  return String(data ?? "");
}

function render(row: any) {
  const l = locale(row.locale);
  const p = row.payload ?? {};
  const plan = esc(p.planName ?? "Chargeurs+");
  const currency = String(p.currency ?? "CHF");
  const periodEnd = dateLabel(p.periodEnd, l);
  const hourly = money(p.hourlyCents, currency);
  const daily = money(p.dailyCapCents, currency);
  const credit = Number(p.renewalCreditCents ?? 0) > 0 ? money(p.renewalCreditCents, currency) : null;
  let subject = "";
  let title = "";
  let body = "";

  if (row.template_key === "membership_activated") {
    if (l === "de") {
      subject = "Chargeurs.ch – Ihre Mitgliedschaft ist aktiv";
      title = "Willkommen bei Chargeurs+";
      body = `Ihre Mitgliedschaft <strong>${plan}</strong> ist aktiv. Ihr Kundentarif beträgt ${hourly} pro Stunde, mit einem Tageslimit von ${daily}.${credit ? ` Ihr Mitgliedschaftsguthaben beträgt ${credit}.` : ""} Nächste Periode: ${periodEnd}.`;
    } else if (l === "en") {
      subject = "Chargeurs.ch – Your membership is active";
      title = "Welcome to Chargeurs+";
      body = `Your <strong>${plan}</strong> membership is active. Your member rate is ${hourly} per hour, with a daily cap of ${daily}.${credit ? ` Your membership credit is ${credit}.` : ""} Next period: ${periodEnd}.`;
    } else {
      subject = "Chargeurs.ch — Votre adhésion est active";
      title = "Bienvenue dans Chargeurs+";
      body = `Votre adhésion <strong>${plan}</strong> est active. Votre tarif membre est de ${hourly} par heure, avec un plafond journalier de ${daily}.${credit ? ` Votre crédit d’adhésion est de ${credit}.` : ""} Prochaine période : ${periodEnd}.`;
    }
  } else if (row.template_key === "membership_renewed") {
    if (l === "de") { subject = "Chargeurs.ch – Mitgliedschaft verlängert"; title = "Ihre Chargeurs+ Vorteile laufen weiter"; body = `Ihre Mitgliedschaft <strong>${plan}</strong> wurde für eine neue Periode fortgeführt. Die aktuelle Periode endet am ${periodEnd}.`; }
    else if (l === "en") { subject = "Chargeurs.ch – Membership renewed"; title = "Your Chargeurs+ benefits continue"; body = `Your <strong>${plan}</strong> membership has continued for a new period. The current period ends on ${periodEnd}.`; }
    else { subject = "Chargeurs.ch — Adhésion renouvelée"; title = "Vos avantages Chargeurs+ continuent"; body = `Votre adhésion <strong>${plan}</strong> a été prolongée pour une nouvelle période. La période actuelle se termine le ${periodEnd}.`; }
  } else if (row.template_key === "membership_payment_failed") {
    if (l === "de") { subject = "Chargeurs.ch – Zahlung für Mitgliedschaft prüfen"; title = "Zahlung konnte nicht bestätigt werden"; body = `Die Verlängerungszahlung für <strong>${plan}</strong> muss geprüft werden. Öffnen Sie Ihr Chargeurs+ Konto, um die Zahlungsart zu verwalten. Ihre Vorteile werden nicht als aktiv verlängert, solange Stripe die Zahlung nicht bestätigt.`; }
    else if (l === "en") { subject = "Chargeurs.ch – Membership payment needs attention"; title = "Payment could not be confirmed"; body = `The renewal payment for <strong>${plan}</strong> needs attention. Open your Chargeurs+ account to manage the payment method. Benefits are not presented as renewed until Stripe confirms payment.`; }
    else { subject = "Chargeurs.ch — Paiement d’adhésion à vérifier"; title = "Le paiement n’a pas pu être confirmé"; body = `Le paiement de renouvellement de <strong>${plan}</strong> nécessite votre attention. Ouvrez votre compte Chargeurs+ pour gérer le moyen de paiement. Les avantages ne sont pas présentés comme renouvelés tant que Stripe n’a pas confirmé le paiement.`; }
  } else if (row.template_key === "membership_cancellation_scheduled") {
    if (l === "de") { subject = "Chargeurs.ch – Ende der Mitgliedschaft geplant"; title = "Automatische Verlängerung deaktiviert"; body = `Ihre Mitgliedschaft <strong>${plan}</strong> bleibt bis zum ${periodEnd} aktiv. Danach wird sie nicht automatisch verlängert und der Chargeurs+ Pass wird deaktiviert.`; }
    else if (l === "en") { subject = "Chargeurs.ch – Membership end scheduled"; title = "Automatic renewal is off"; body = `Your <strong>${plan}</strong> membership remains active until ${periodEnd}. It will not renew automatically after that date and the Chargeurs+ Pass will be disabled.`; }
    else { subject = "Chargeurs.ch — Fin d’adhésion programmée"; title = "Le renouvellement automatique est désactivé"; body = `Votre adhésion <strong>${plan}</strong> reste active jusqu’au ${periodEnd}. Elle ne sera ensuite pas renouvelée automatiquement et le Pass Chargeurs+ sera désactivé.`; }
  } else if (row.template_key === "membership_renewal_resumed") {
    if (l === "de") { subject = "Chargeurs.ch – Verlängerung wieder aktiv"; title = "Automatische Verlängerung reaktiviert"; body = `Ihre Mitgliedschaft <strong>${plan}</strong> wird wieder automatisch verlängert. Aktuelles Periodenende: ${periodEnd}.`; }
    else if (l === "en") { subject = "Chargeurs.ch – Renewal resumed"; title = "Automatic renewal is active again"; body = `Your <strong>${plan}</strong> membership is set to renew automatically again. Current period end: ${periodEnd}.`; }
    else { subject = "Chargeurs.ch — Renouvellement réactivé"; title = "Le renouvellement automatique est de nouveau actif"; body = `Votre adhésion <strong>${plan}</strong> est de nouveau prévue pour se renouveler automatiquement. Fin de période actuelle : ${periodEnd}.`; }
  } else {
    if (l === "de") { subject = "Chargeurs.ch – Mitgliedschaft beendet"; title = "Ihre Chargeurs+ Mitgliedschaft ist beendet"; body = `Die Mitgliedschaft <strong>${plan}</strong> ist beendet. Der zugehörige Chargeurs+ Pass wurde deaktiviert. Frühere Mietbelege bleiben davon unberührt.`; }
    else if (l === "en") { subject = "Chargeurs.ch – Membership ended"; title = "Your Chargeurs+ membership has ended"; body = `The <strong>${plan}</strong> membership has ended. Its Chargeurs+ Pass has been disabled. Previous rental receipts remain unchanged.`; }
    else { subject = "Chargeurs.ch — Adhésion terminée"; title = "Votre adhésion Chargeurs+ est terminée"; body = `L’adhésion <strong>${plan}</strong> est terminée. Le Pass Chargeurs+ associé a été désactivé. Vos reçus de locations passées restent inchangés.`; }
  }

  const manage = l === "de" ? "Mitgliedschaft verwalten" : l === "en" ? "Manage membership" : "Gérer mon adhésion";
  const support = l === "de" ? "Support" : l === "en" ? "Support" : "Assistance";
  return {
    subject,
    html: `<!doctype html><html><body style="margin:0;background:#05070d;color:#f6f8ff;font-family:Arial,sans-serif"><div style="max-width:620px;margin:0 auto;padding:32px 18px"><div style="font-size:28px;font-weight:900;color:#73cbff">Chargeurs<span style="color:#9d74ff">.ch</span></div><div style="margin-top:22px;border:1px solid #25344f;border-radius:24px;background:#09101d;padding:28px"><div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#9d74ff;font-weight:800">Chargeurs+ Pass</div><h1 style="font-size:29px;line-height:1.05;margin:10px 0 18px">${title}</h1><p style="font-size:16px;line-height:1.65;color:#c8d2e4">${body}</p><a href="https://chargeurs.ch/compte/pass" style="display:inline-block;margin-top:18px;padding:13px 18px;border-radius:999px;background:#6d4aff;color:#fff;text-decoration:none;font-weight:800">${manage}</a><p style="margin-top:25px;font-size:12px;line-height:1.55;color:#8291a8">${support}: support@chargeurs.ch · <a href="https://chargeurs.ch/legal/privacy" style="color:#73cbff">Privacy</a></p></div></div></body></html>`,
  };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response(JSON.stringify({ ok: false, error: "METHOD_NOT_ALLOWED" }), { status: 405, headers: { "Content-Type": "application/json" } });
  const db = admin();
  const body = await req.json().catch(() => ({}));
  const expected = await secret(db, "transactional_email_dispatch_key");
  if (!expected || body.dispatchKey !== expected) return new Response(JSON.stringify({ ok: false, error: "FORBIDDEN" }), { status: 403, headers: { "Content-Type": "application/json" } });

  const vaultResend = await secret(db, "resend_api_key").catch(() => "");
  const vaultFrom = await secret(db, "transactional_email_from").catch(() => "");
  const apiKey = (Deno.env.get("RESEND_API_KEY") ?? vaultResend).trim();
  const from = (Deno.env.get("TRANSACTIONAL_EMAIL_FROM") ?? vaultFrom ?? "").trim() || "Chargeurs.ch <noreply@chargeurs.ch>";
  if (!apiKey) return new Response(JSON.stringify({ ok: true, configured: false, queued: true, reason: "EMAIL_PROVIDER_NOT_CONFIGURED" }), { headers: { "Content-Type": "application/json" } });

  const stale = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  await db.from("membership_email_outbox")
    .update({ status: "queued", next_attempt_at: new Date().toISOString(), updated_at: new Date().toISOString(), last_error: "STALE_SENDING_RECOVERED" })
    .eq("status", "sending")
    .lt("updated_at", stale)
    .lt("attempts", 5);

  const { data: rows, error } = await db.from("membership_email_outbox")
    .select("*")
    .eq("status", "queued")
    .lte("next_attempt_at", new Date().toISOString())
    .order("created_at", { ascending: true })
    .limit(10);
  if (error) throw error;

  let sent = 0;
  let failed = 0;
  for (const row of rows ?? []) {
    const attempts = Number(row.attempts ?? 0) + 1;
    const { data: claimed } = await db.from("membership_email_outbox")
      .update({ status: "sending", attempts, updated_at: new Date().toISOString() })
      .eq("id", row.id)
      .eq("status", "queued")
      .select("id")
      .maybeSingle();
    if (!claimed) continue;

    try {
      const email = render(row);
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: [row.to_email], subject: email.subject, html: email.html }),
      });
      const responseText = await response.text();
      if (!response.ok) throw new Error(`RESEND_${response.status}:${responseText.slice(0, 180)}`);
      await db.from("membership_email_outbox").update({ status: "sent", sent_at: new Date().toISOString(), last_error: null, updated_at: new Date().toISOString() }).eq("id", row.id);
      sent += 1;
    } catch (err) {
      const lastError = err instanceof Error ? err.message.slice(0, 500) : "EMAIL_SEND_FAILED";
      const terminal = attempts >= 5;
      const backoffMinutes = Math.min(60, Math.pow(2, Math.max(0, attempts - 1)) * 5);
      await db.from("membership_email_outbox").update({
        status: terminal ? "failed" : "queued",
        next_attempt_at: new Date(Date.now() + backoffMinutes * 60 * 1000).toISOString(),
        last_error: lastError,
        updated_at: new Date().toISOString(),
      }).eq("id", row.id);
      failed += 1;
    }
  }

  return new Response(JSON.stringify({ ok: true, configured: true, processed: (rows ?? []).length, sent, failed }), { headers: { "Content-Type": "application/json" } });
});
