-- The historical `noop` dispatcher processes Web Push and Wallet outboxes only.
-- It is not part of Stripe confirmation, hardware/ejection, rental settlement,
-- or safety reconciliation. A five-minute cadence preserves bounded outbox
-- retries while avoiding an unnecessary fixed Edge Function hot loop.
do $cron$
declare
  v_jobid bigint;
begin
  select jobid into v_jobid
  from cron.job
  where jobname = 'chargeurs-plus-push-outbox'
  limit 1;

  if v_jobid is null then
    raise exception 'CHARGEURS_PLUS_PUSH_OUTBOX_CRON_MISSING';
  end if;

  perform cron.alter_job(
    job_id := v_jobid,
    schedule := '*/5 * * * *'
  );
end
$cron$;
