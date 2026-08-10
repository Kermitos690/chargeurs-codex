create or replace function public.apply_customer_rewards_on_rental_completion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_final_chf numeric;
  v_rule record;
  v_points integer;
begin
  if new.event_type <> 'rental_completed' then
    return new;
  end if;

  select customer_user_id,
         coalesce(final_amount_cents, 0)::numeric / 100.0
    into v_user_id, v_final_chf
  from public.rental_sessions
  where id = new.rental_id;

  if v_user_id is null then
    return new;
  end if;

  update public.customer_wallet_passes
  set pass_revision = pass_revision + 1,
      provider_status = case when provider_status = 'issued' then 'update_pending' else provider_status end,
      updated_at = now()
  where user_id = v_user_id
    and status = 'active'
    and revoked_at is null;

  for v_rule in
    select *
    from public.customer_chargepoints_rules
    where active = true
      and event_type = 'rental_completed'
      and valid_from <= new.occurred_at
      and (valid_to is null or valid_to >= new.occurred_at)
  loop
    v_points := coalesce(v_rule.fixed_points, 0)
      + floor(coalesce(v_rule.points_per_chf, 0) * greatest(coalesce(v_final_chf, 0), 0))::integer;

    if v_points > 0 then
      insert into public.customer_chargepoints_ledger(
        user_id, delta, reason, source_type, source_id, idempotency_key, metadata
      ) values (
        v_user_id,
        v_points,
        'rental_completed',
        'rental',
        new.rental_id::text,
        'chargepoints:rule:' || v_rule.id::text || ':rental:' || new.rental_id::text,
        jsonb_build_object(
          'rule_id', v_rule.id,
          'rule_code', v_rule.code,
          'final_amount_chf', coalesce(v_final_chf, 0),
          'orchestrator_event_id', new.id
        )
      ) on conflict (idempotency_key) do nothing;
    end if;
  end loop;

  return new;
end;
$$;
