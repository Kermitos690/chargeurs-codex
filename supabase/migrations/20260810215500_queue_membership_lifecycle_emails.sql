create or replace function public.queue_membership_lifecycle_email()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_template text;
  v_email text;
  v_locale text := 'fr';
  v_plan record;
  v_key text;
begin
  if new.status = 'active' and old.status is distinct from 'active' then
    v_template := 'membership_activated';
  elsif new.status = 'active' and new.cancel_at_period_end = true and coalesce(old.cancel_at_period_end, false) = false then
    v_template := 'membership_cancellation_scheduled';
  elsif new.status = 'active' and new.cancel_at_period_end = false and coalesce(old.cancel_at_period_end, false) = true then
    v_template := 'membership_renewal_resumed';
  elsif new.status = 'active' and old.status = 'active'
        and new.stripe_current_period_start is distinct from old.stripe_current_period_start
        and new.stripe_current_period_start is not null then
    v_template := 'membership_renewed';
  elsif new.status = 'past_due' and old.status is distinct from 'past_due' then
    v_template := 'membership_payment_failed';
  elsif new.status in ('cancelled','expired') and old.status not in ('cancelled','expired') then
    v_template := 'membership_cancelled';
  else
    return new;
  end if;

  select u.email into v_email from auth.users u where u.id = new.user_id;
  if v_email is null or btrim(v_email) = '' then
    return new;
  end if;

  select case when p.preferred_language in ('fr','de','en') then p.preferred_language else 'fr' end
    into v_locale
  from public.profiles p
  where p.id = new.user_id;
  v_locale := coalesce(v_locale, 'fr');

  select p.code, p.name, p.currency, p.annual_fee_cents, p.renewal_credit_cents,
         p.hourly_cents, p.daily_cap_cents, p.billing_interval, p.billing_interval_count
    into v_plan
  from public.customer_membership_plans p
  where p.id = new.plan_id;

  v_key := v_template || ':' || new.id::text || ':' || coalesce(new.last_stripe_event_id, new.updated_at::text);

  insert into public.membership_email_outbox(
    membership_id, template_key, idempotency_key, to_email, locale, payload
  ) values (
    new.id,
    v_template,
    v_key,
    v_email,
    v_locale,
    jsonb_build_object(
      'planCode', v_plan.code,
      'planName', coalesce(v_plan.name, 'Chargeurs+'),
      'currency', coalesce(v_plan.currency, 'CHF'),
      'annualFeeCents', coalesce(v_plan.annual_fee_cents, 0),
      'renewalCreditCents', coalesce(v_plan.renewal_credit_cents, 0),
      'hourlyCents', coalesce(v_plan.hourly_cents, 0),
      'dailyCapCents', coalesce(v_plan.daily_cap_cents, 0),
      'billingInterval', v_plan.billing_interval,
      'billingIntervalCount', coalesce(v_plan.billing_interval_count, 1),
      'periodEnd', new.stripe_current_period_end,
      'status', new.status,
      'cancelAtPeriodEnd', new.cancel_at_period_end
    )
  ) on conflict (idempotency_key) do nothing;

  return new;
end;
$$;

drop trigger if exists trg_queue_membership_lifecycle_email on public.customer_memberships;
create trigger trg_queue_membership_lifecycle_email
after update of status, cancel_at_period_end, stripe_current_period_start, stripe_current_period_end, last_stripe_event_id
on public.customer_memberships
for each row execute function public.queue_membership_lifecycle_email();
