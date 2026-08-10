create or replace function public.chargeurs_get_chargenow_credentials()
returns table(secret_username text, secret_password text)
language sql
security definer
set search_path = pg_catalog, vault
as $$
  select
    max(decrypted_secret) filter (where name = 'chargenow_basic_username')::text,
    max(decrypted_secret) filter (where name = 'chargenow_basic_password')::text
  from vault.decrypted_secrets
  where name in ('chargenow_basic_username','chargenow_basic_password');
$$;

revoke all on function public.chargeurs_get_chargenow_credentials() from public;
revoke all on function public.chargeurs_get_chargenow_credentials() from anon;
revoke all on function public.chargeurs_get_chargenow_credentials() from authenticated;
grant execute on function public.chargeurs_get_chargenow_credentials() to service_role;

comment on function public.chargeurs_get_chargenow_credentials() is
'Backend-only access to encrypted ChargeNow Basic credentials stored in Supabase Vault. Never expose through frontend or public API.';
