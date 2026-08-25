-- The Chargeurs+ Pass is served through PassStudio.  Keep its presentation
-- projection aligned with the rental-credit ledger, without exposing any
-- account identifier or payment credential to the Wallet provider.
create or replace function public.customer_wallet_presentation_state(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
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
  v_tier text;
  v_membership_status text;
  v_cancel_at_period_end boolean := false;
  v_membership_end timestamptz;
  v_plan_name text;
begin
  select coalesce(balance, 0) into v_points
  from public.customer_chargepoints_balances
  where user_id = p_user_id;
  v_points := coalesce(v_points, 0);

  select balance_cents, currency
    into v_credit_cents, v_credit_currency
  from public.customer_membership_credit_balances
  where user_id = p_user_id
    and currency = 'CHF';
  v_credit_cents := coalesce(v_credit_cents, 0);
  v_credit_currency := upper(coalesce(nullif(v_credit_currency, ''), 'CHF'));
  v_credit_display := v_credit_currency || ' ' || to_char(v_credit_cents::numeric / 100, 'FM999999990.00');

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
      v_tier := 'Action requise';
    else
      v_pricing := public.customer_wallet_pricing_state(v_rental.pricing_snapshot, coalesce(v_rental.started_at, v_rental.ejected_at), now());
      v_amount := coalesce(nullif(v_pricing->>'final_cents', '')::integer, nullif(v_rental.pricing_snapshot->>'final_cents', '')::integer, 0);
      v_currency := upper(coalesce(nullif(v_pricing->>'currency', ''), nullif(v_rental.currency, ''), 'CHF'));
      if coalesce((v_pricing->>'cap_reached')::boolean, false) then
        v_tier := 'Plafond atteint · ' || v_currency || ' ' || to_char(v_amount::numeric / 100, 'FM999999990.00');
      else
        v_tier := 'Location · ' || v_currency || ' ' || to_char(v_amount::numeric / 100, 'FM999999990.00');
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
      v_tier := 'Retour détecté';
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
        v_tier := 'Terminé · ' || v_currency || ' ' || to_char(v_amount::numeric / 100, 'FM999999990.00');
      else
        select m.status,
               coalesce(m.cancel_at_period_end, false),
               coalesce(m.stripe_current_period_end, m.ends_at),
               p.name
          into v_membership_status, v_cancel_at_period_end, v_membership_end, v_plan_name
        from public.customer_memberships m
        left join public.customer_membership_plans p on p.id = m.plan_id
        where m.user_id = p_user_id
        order by m.updated_at desc
        limit 1;

        if v_membership_status in ('active', 'trialing') then
          if v_cancel_at_period_end and v_membership_end is not null then
            v_tier := 'Actif jusqu’au ' || to_char(v_membership_end at time zone 'Europe/Zurich', 'DD.MM.YYYY');
          else
            v_tier := coalesce(nullif(v_plan_name, ''), 'Client Chargeurs');
          end if;
        else
          v_tier := 'Pass inactif';
        end if;
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'fields', jsonb_build_object(
      'points', v_points,
      'tier', left(coalesce(v_tier, 'Client Chargeurs'), 80),
      'credit', v_credit_display,
      'rental_credit', v_credit_display
    ),
    'points', v_points,
    'tier', left(coalesce(v_tier, 'Client Chargeurs'), 80),
    'rentalCreditCents', v_credit_cents,
    'rentalCreditCurrency', v_credit_currency,
    'rentalCreditDisplay', v_credit_display,
    'rentalSessionId', v_rental.id
  );
end;
$function$;

-- Queue one idempotent presentation refresh and one native Wallet message for
-- each active PassStudio pass. This changes no credit balance or payment.
do $block$
declare
  pass_row record;
begin
  for pass_row in
    select id, user_id
    from public.customer_wallet_passes
    where status = 'active'
      and revoked_at is null
      and provider = 'pass_studio'
      and provider_instance_id is not null
  loop
    perform public.enqueue_customer_wallet_sync_event(
      pass_row.user_id,
      'membership_credit_display_updated',
      'membership-credit-display-v1:' || pass_row.id::text,
      null,
      jsonb_build_object('reason', 'membership_credit_display_updated'),
      now() + interval '1 day'
    );

    insert into public.customer_wallet_native_notifications(
      user_id, event_type, event_key, title, message, metadata, expires_at
    ) values (
      pass_row.user_id,
      'membership_credit_display_updated',
      'membership-credit-display-v1:' || pass_row.id::text,
      'Crédit location mis à jour',
      'Votre crédit de location est maintenant affiché dans votre Chargeurs+ Pass.',
      jsonb_build_object('reason', 'membership_credit_display_updated'),
      now() + interval '1 day'
    ) on conflict (event_key) do nothing;
  end loop;
end;
$block$;
