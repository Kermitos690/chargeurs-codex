-- pgsql-http's jsonb overload did not send a body that the Edge worker parsed as
-- JSON in this staging runtime. Use the explicit text + content-type overload so
-- the private dispatch key reaches process-rental-email-outbox correctly.
do $$
declare
  v_job_id bigint;
  v_command text;
begin
  select jobid into v_job_id
  from cron.job
  where jobname = 'chargeurs-transactional-email-outbox'
  limit 1;

  if v_job_id is null then
    raise exception 'transactional email cron job not found';
  end if;

  v_command := $cmd$
    select extensions.http_post(
      'https://xqepbqnaenoeyfjkjnzl.supabase.co/functions/v1/process-rental-email-outbox',
      jsonb_build_object(
        'dispatchKey', (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'transactional_email_dispatch_key'
          limit 1
        )
      )::text,
      'application/json'
    );
  $cmd$;

  perform cron.alter_job(v_job_id, '* * * * *', v_command, null, null, true);
end $$;
