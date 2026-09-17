-- Preserve QR Checkout while enforcing first-rail-wins against Stripe Terminal.
-- Existing QR Checkout remains unchanged when no Terminal claim exists.

create or replace function public.guard_qr_checkout_payment_rail()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claim text;
begin
  if new.stripe_checkout_session_id is distinct from old.stripe_checkout_session_id
     and new.stripe_checkout_session_id is not null then
    select rail into v_claim
    from public.rental_payment_rail_claims
    where rental_session_id = new.id;

    if v_claim = 'stripe_terminal' then
      raise exception 'PAYMENT_RAIL_ALREADY_CLAIMED:stripe_terminal';
    end if;

    insert into public.rental_payment_rail_claims(rental_session_id, rail, metadata)
    values (new.id, 'qr_checkout', jsonb_build_object('source','rental_sessions_checkout_projection'))
    on conflict (rental_session_id) do nothing;

    select rail into v_claim
    from public.rental_payment_rail_claims
    where rental_session_id = new.id;

    if v_claim <> 'qr_checkout' then
      raise exception 'PAYMENT_RAIL_ALREADY_CLAIMED:%', coalesce(v_claim,'unknown');
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.guard_qr_checkout_payment_rail() from public, anon, authenticated;
grant execute on function public.guard_qr_checkout_payment_rail() to service_role;

drop trigger if exists rental_sessions_guard_qr_checkout_payment_rail on public.rental_sessions;
create trigger rental_sessions_guard_qr_checkout_payment_rail
before update of stripe_checkout_session_id on public.rental_sessions
for each row execute function public.guard_qr_checkout_payment_rail();
