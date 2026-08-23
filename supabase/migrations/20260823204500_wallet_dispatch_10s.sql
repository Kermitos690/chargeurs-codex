-- Keep Chargeurs+ realtime Wallet delivery close to the 10-second pricing scanner.
-- This only changes the dispatcher cadence; rental/payment/return/settlement paths remain asynchronous.

do $$
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

  perform cron.alter_job(job_id := v_jobid, schedule := '10 seconds');
end $$;
