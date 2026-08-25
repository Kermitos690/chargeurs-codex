-- Pass Studio documents individual instance field updates (and the Wallet refresh
-- they trigger) as free. Keep this deliberately separate from the existing
-- global/broadcast push switch, which remains disabled because it is billed.
insert into public.app_settings (key, value, public, description)
values (
  'customer_wallet.pass_studio_instance_sync',
  '{"enabled": true, "reason": "free_per_holder_fields_and_refresh"}'::jsonb,
  false,
  'Controls free, per-holder Pass Studio field refreshes for Chargeurs+ passes only. Billed broadcasts remain disabled.'
)
on conflict (key) do update
set value = excluded.value,
    public = excluded.public,
    description = excluded.description,
    updated_at = now();

-- Refresh current active Chargeurs+ passes once through the individual endpoint.
-- The event key is new and idempotent, so this cannot alter balances, prices,
-- payments, rentals, or hardware state.
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
      'free_instance_fields_enabled',
      'free-instance-fields-v1:' || pass_row.id::text,
      null,
      jsonb_build_object('reason', 'free_per_holder_pass_studio_refresh'),
      now() + interval '1 day'
    );
  end loop;
end;
$block$;
