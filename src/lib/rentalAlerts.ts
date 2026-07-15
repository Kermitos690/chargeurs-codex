import { PUBLIC_PRICING, quotePublicRental } from "@/lib/publicPricing";

export type RentalAlertKind =
  | "rental_started"
  | "first_hour"
  | "daily_cap_approaching"
  | "daily_cap_reached"
  | "return_reminder"
  | "non_return_warning";

export type RentalAlert = {
  kind: RentalAlertKind;
  title: string;
  message: string;
  triggerAfterMinutes: number;
  priority: "info" | "warning" | "critical";
};

export type RentalAlertPlanInput = {
  startedAt: Date;
  now?: Date;
  nonReturnWarningAfterHours?: number;
};

const MINUTES_PER_HOUR = 60;

export function buildRentalAlertPlan(input: RentalAlertPlanInput): RentalAlert[] {
  const capMinutes = Math.ceil(
    (PUBLIC_PRICING.dailyCapChf / PUBLIC_PRICING.hourlyRateChf) * MINUTES_PER_HOUR,
  );
  const nonReturnMinutes = (input.nonReturnWarningAfterHours ?? 48) * MINUTES_PER_HOUR;

  return [
    {
      kind: "rental_started",
      title: "Location démarrée",
      message: `Votre location est active. Tarif : ${PUBLIC_PRICING.hourlyRateChf.toFixed(2)} CHF/h, par tranches de ${PUBLIC_PRICING.incrementMinutes} minutes.`,
      triggerAfterMinutes: 0,
      priority: "info",
    },
    {
      kind: "first_hour",
      title: "Première heure écoulée",
      message: `Le montant indicatif atteint ${quotePublicRental(60).toFixed(2)} CHF.`,
      triggerAfterMinutes: 60,
      priority: "info",
    },
    {
      kind: "daily_cap_approaching",
      title: "Plafond journalier bientôt atteint",
      message: `Le plafond journalier de ${PUBLIC_PRICING.dailyCapChf.toFixed(2)} CHF sera bientôt atteint.`,
      triggerAfterMinutes: Math.max(0, capMinutes - 60),
      priority: "warning",
    },
    {
      kind: "daily_cap_reached",
      title: "Plafond journalier atteint",
      message: `La location est plafonnée à ${PUBLIC_PRICING.dailyCapChf.toFixed(2)} CHF pour cette journée.`,
      triggerAfterMinutes: capMinutes,
      priority: "info",
    },
    {
      kind: "return_reminder",
      title: "Pensez à rendre la batterie",
      message: "Vous pouvez restituer la batterie dans une borne Chargeurs.ch compatible disposant d'un emplacement libre.",
      triggerAfterMinutes: 24 * MINUTES_PER_HOUR,
      priority: "warning",
    },
    {
      kind: "non_return_warning",
      title: "Retour nécessaire",
      message: `Sans restitution, le montant total de non-retour peut atteindre ${PUBLIC_PRICING.nonReturnTotalChf.toFixed(2)} CHF. Contactez immédiatement le support en cas de problème.`,
      triggerAfterMinutes: nonReturnMinutes,
      priority: "critical",
    },
  ];
}

export function dueRentalAlerts(input: RentalAlertPlanInput, sentKinds: RentalAlertKind[] = []) {
  const now = input.now ?? new Date();
  const elapsedMinutes = Math.max(0, Math.floor((now.getTime() - input.startedAt.getTime()) / 60000));
  const sent = new Set(sentKinds);

  return buildRentalAlertPlan(input).filter(
    (alert) => elapsedMinutes >= alert.triggerAfterMinutes && !sent.has(alert.kind),
  );
}
