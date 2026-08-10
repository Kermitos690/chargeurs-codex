do $$
begin
  if not exists (select 1 from vault.secrets where name = 'transactional_email_dispatch_key') then
    perform vault.create_secret(encode(gen_random_bytes(32), 'hex'), 'transactional_email_dispatch_key', 'Internal key for Chargeurs transactional email outbox worker');
  end if;
end $$;

create or replace function public.internal_transactional_email_secret(p_name text)
returns text
language sql
stable
security definer
set search_path = public, vault
as $$
  select ds.decrypted_secret
  from vault.decrypted_secrets ds
  where ds.name = p_name
  limit 1
$$;
revoke all on function public.internal_transactional_email_secret(text) from public, anon, authenticated;
grant execute on function public.internal_transactional_email_secret(text) to service_role;

do $$
begin
  if not exists (select 1 from cron.job where jobname = 'chargeurs-transactional-email-outbox') then
    perform cron.schedule(
      'chargeurs-transactional-email-outbox',
      '* * * * *',
      $cron$
      select extensions.http_post(
        'https://xqepbqnaenoeyfjkjnzl.supabase.co/functions/v1/process-rental-email-outbox',
        jsonb_build_object(
          'dispatchKey', (select decrypted_secret from vault.decrypted_secrets where name = 'transactional_email_dispatch_key' limit 1)
        )
      );
      $cron$
    );
  end if;
end $$;
