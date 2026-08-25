-- Chargeurs+ Custom Pass contract (Pass Studio #1002)
-- Keeps the legacy aggregate tier for compatibility while exposing dedicated
-- custom fields and an on-pass recent activity history.

create or replace function public.customer_wallet_presentation_state(p_user_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_points integer := 0;
  v_credit_cents bigint := 0;
  v_credit_currency text := 'CHF';
  v_credit_display text;
  v_rental public.rental_sessions%rowtype;
  v_pricing jsonb;
  v_amount integer;
  v_currency text := 'CHF';
  v_status text;
  v_legacy_tier text;
  v_membership_status text;
  v_membership_display text;
  v_cancel_at_period_end boolean := false;
  v_membership_end timestamptz;
  v_renews_at timestamptz;
  v_next_due timestamptz;
  v_next_due_display text := '—';
  v_plan_name text;
  v_plan_currency text := 'CHF';
  v_hourly_cents integer := 0;
  v_daily_cap_cents integer := 0;
  v_member_rate text;
  v_daily_cap text;
  v_history text := 'Aucune activité récente';
begin
  select coalesce(balance, 0) into v_points
  from public.customer_chargepoints_balances
  where user_id = p_user_id;
  v_points := coalesce(v_points, 0);

  select balance_cents, currency
    into v_credit_cents, v_credit_currency
  from public.customer_membership_credit_balances
  where user_id = p_user_id and currency = 'CHF';
  v_credit_cents := coalesce(v_credit_cents, 0);
  v_credit_currency := upper(coalesce(nullif(v_credit_currency, ''), 'CHF'));
  v_credit_display := v_credit_currency || ' ' || to_char(v_credit_cents::numeric / 100, 'FM999999990.00');

  select m.status,
         coalesce(m.cancel_at_period_end, false),
         coalesce(m.stripe_current_period_end, m.ends_at),
         m.renews_at,
         p.name,
         coalesce(nullif(p.currency, ''), 'CHF'),
         coalesce(p.hourly_cents, 0),
         coalesce(p.daily_cap_cents, 0)
    into v_membership_status, v_cancel_at_period_end, v_membership_end, v_renews_at,
         v_plan_name, v_plan_currency, v_hourly_cents, v_daily_cap_cents
  from public.customer_memberships m
  left join public.customer_membership_plans p on p.id = m.plan_id
  where m.user_id = p_user_id
  order by m.updated_at desc
  limit 1;

  v_membership_display := case
    when v_membership_status in ('active', 'trialing') then 'Active'
    when coalesce(v_membership_status, '') = '' then 'Inactive'
    else initcap(replace(v_membership_status, '_', ' '))
  end;
  v_member_rate := upper(v_plan_currency) || ' ' || to_char(v_hourly_cents::numeric / 100, 'FM999999990.00') || ' / h';
  v_daily_cap := upper(v_plan_currency) || ' ' || to_char(v_daily_cap_cents::numeric / 100, 'FM999999990.00') || ' / jour';
  v_next_due := case when v_cancel_at_period_end then v_membership_end else v_renews_at end;
  if v_next_due is not null then
    v_next_due_display := to_char(v_next_due at time zone 'Europe/Zurich', 'DD.MM.YYYY');
  end if;

  select * into v_rental
  from public.rental_sessions
  where customer_user_id = p_user_id
    and coalesce(started_at, ejected_at) is not null
    and returned_at is null
    and state not in ('completed', 'cancelled', 'payment_failed', 'expired')
  order by created_at desc
  limit 1;

  if v_rental.id is not null then
    if v_rental.state in ('needs_support', 'manual_review') or v_rental.settlement_status in ('failed', 'manual_review') then
      v_status := 'Action requise';
    else
      v_pricing := public.customer_wallet_pricing_state(v_rental.pricing_snapshot, coalesce(v_rental.started_at, v_rental.ejected_at), now());
      v_amount := coalesce(nullif(v_pricing->>'final_cents', '')::integer, nullif(v_rental.pricing_snapshot->>'final_cents', '')::integer, 0);
      v_currency := upper(coalesce(nullif(v_pricing->>'currency', ''), nullif(v_rental.currency, ''), 'CHF'));
      if coalesce((v_pricing->>'cap_reached')::boolean, false) then
        v_status := 'Plafond atteint · ' || v_currency || ' ' || to_char(v_amount::numeric / 100, 'FM999999990.00');
      else
        v_status := 'Location · ' || v_currency || ' ' || to_char(v_amount::numeric / 100, 'FM999999990.00');
      end if;
    end if;
  else
    select * into v_rental
    from public.rental_sessions
    where customer_user_id = p_user_id
      and returned_at is not null
      and coalesce(settlement_status, '') <> 'settled'
    order by returned_at desc
    limit 1;

    if v_rental.id is not null then
      v_status := 'Retour détecté';
    else
      select * into v_rental
      from public.rental_sessions
      where customer_user_id = p_user_id
        and settlement_status = 'settled'
        and settled_at >= now() - interval '24 hours'
      order by settled_at desc
      limit 1;

      if v_rental.id is not null then
        v_amount := coalesce(v_rental.final_amount_cents, v_rental.captured_amount_cents, 0);
        v_currency := upper(coalesce(nullif(v_rental.currency, ''), 'CHF'));
        v_status := 'Terminé · ' || v_currency || ' ' || to_char(v_amount::numeric / 100, 'FM999999990.00');
      elsif v_membership_status in ('active', 'trialing') then
        if v_cancel_at_period_end and v_membership_end is not null then
          v_status := 'Actif jusqu’au ' || to_char(v_membership_end at time zone 'Europe/Zurich', 'DD.MM.YYYY');
        else
          v_status := coalesce(nullif(v_plan_name, ''), 'Client Chargeurs+');
        end if;
      else
        v_status := 'Pass inactif';
      end if;
    end if;
  end if;

  v_legacy_tier := left('Crédit location : ' || v_credit_display || case when nullif(v_status, '') is null then '' else ' · ' || v_status end, 80);

  select coalesce(string_agg(
    to_char(n.created_at at time zone 'Europe/Zurich', 'DD.MM HH24:MI') || ' · ' || coalesce(nullif(n.title, ''), n.event_type) ||
    case when nullif(n.message, '') is null then '' else E'\n' || n.message end,
    E'\n\n' order by n.created_at desc
  ), 'Aucune activité récente')
  into v_history
  from (
    select created_at, title, event_type, message
    from public.customer_wallet_native_notifications
    where user_id = p_user_id and status = 'delivered'
    order by created_at desc
    limit 10
  ) n;

  return jsonb_build_object(
    'fields', jsonb_build_object(
      'points', v_points,
      'tier', v_legacy_tier,
      'status', v_status,
      'statut', v_status,
      'credit', v_credit_display,
      'rental_credit', v_credit_display,
      'membership_status', v_membership_display,
      'adhesion', v_membership_display,
      'member_rate', v_member_rate,
      'daily_cap', v_daily_cap,
      'next_due', v_next_due_display,
      'recent_history', v_history,
      'historique_recent', v_history
    ),
    'points', v_points,
    'tier', v_legacy_tier,
    'status', v_status,
    'membershipStatus', v_membership_display,
    'memberRate', v_member_rate,
    'dailyCap', v_daily_cap,
    'nextDue', v_next_due_display,
    'recentHistory', v_history,
    'rentalCreditCents', v_credit_cents,
    'rentalCreditCurrency', v_credit_currency,
    'rentalCreditDisplay', v_credit_display,
    'rentalSessionId', v_rental.id
  );
end;
$function$;

-- Correct historical local delivery labels when Pass Studio explicitly said no push occurred.
update public.customer_wallet_native_notifications
set status = 'failed',
    delivered_at = null,
    last_error_code = coalesce(nullif(metadata->>'pushSkipReason', ''), 'PROVIDER_PUSH_NOT_DELIVERED'),
    updated_at = now()
where status = 'delivered'
  and coalesce((metadata->>'providerPushed')::boolean, false) = false;

-- The previous documentation incorrectly treated instance field sync as free.
-- Keep automated Pass Studio pushes disabled until the corrected dispatcher is deployed/enabled.
update public.app_settings
set value = jsonb_build_object('enabled', false, 'reason', 'billing_contract_corrected_2026_08_25_requires_safe_dispatcher'),
    updated_at = now()
where key = 'customer_wallet.pass_studio_instance_sync';
