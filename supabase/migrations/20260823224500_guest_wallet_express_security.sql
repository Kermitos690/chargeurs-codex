-- Harden Chargeurs Express internal trigger functions.
-- Trigger execution does not require client EXECUTE grants.

revoke all on function public.auto_link_guest_wallet_from_rental_email() from public, anon, authenticated;
revoke all on function public.queue_guest_wallet_rental_state_event() from public, anon, authenticated;
grant execute on function public.auto_link_guest_wallet_from_rental_email() to service_role;
grant execute on function public.queue_guest_wallet_rental_state_event() to service_role;

-- Make INSERT/UPDATE handling explicit so OLD is never inspected on INSERT.
create or replace function public.auto_link_guest_wallet_from_rental_email()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  wallet_id uuid;
  email_digest text;
begin
  if new.customer_segment <> 'guest' or nullif(trim(new.customer_email),'') is null then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if old.customer_email is not distinct from new.customer_email then
      return new;
    end if;
  end if;

  email_digest := encode(extensions.digest(lower(trim(new.customer_email)), 'sha256'), 'hex');
  select id into wallet_id
  from public.guest_wallet_passes
  where email_hash = email_digest
    and status = 'active'
    and revoked_at is null
  order by updated_at desc
  limit 1;

  if wallet_id is not null then
    insert into public.guest_wallet_rental_links(rental_id, guest_wallet_pass_id)
    values (new.id, wallet_id)
    on conflict (rental_id) do nothing;

    update public.guest_wallet_passes
    set current_rental_id = new.id, updated_at = now()
    where id = wallet_id;

    perform public.enqueue_guest_wallet_event(
      new.id,
      'rental_attached',
      'guest-wallet:rental:' || new.id || ':attached',
      null,
      jsonb_build_object('source','email_reuse'),
      now() + interval '2 hours'
    );
  end if;
  return new;
end;
$$;

revoke all on function public.auto_link_guest_wallet_from_rental_email() from public, anon, authenticated;
grant execute on function public.auto_link_guest_wallet_from_rental_email() to service_role;
