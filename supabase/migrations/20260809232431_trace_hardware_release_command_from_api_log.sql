-- Safety-net traceability for rental ejection commands.
--
-- The provider request is already logged in api_logs. If an Edge Function
-- returns/crashes before updating hardware_release_attempts, preserve the fact
-- that one command reached the provider by correlating its immutable tradeNo.
-- This trigger NEVER calls ChargeNow and never creates another hardware command.

create or replace function public.trace_hardware_release_command_from_api_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trade_no text;
  v_rental_id uuid;
begin
  if new.service is distinct from 'chargenow'
     or new.endpoint is distinct from '/cabinet/ejectByRent' then
    return new;
  end if;

  v_trade_no := nullif(btrim(coalesce(new.request ->> 'tradeNo', '')), '');
  if v_trade_no is null then return new; end if;

  select rs.id into v_rental_id
  from public.rental_sessions rs
  where rs.apifox_trade_no = v_trade_no
  order by rs.created_at desc
  limit 1;

  if v_rental_id is null then return new; end if;

  update public.hardware_release_attempts h
  set command_sent_at = coalesce(h.command_sent_at, new.created_at, now()),
      result = case when h.result = 'prepared' then 'command_sent' else h.result end,
      updated_at = now()
  where h.rental_session_id = v_rental_id;

  return new;
end;
$$;

revoke all on function public.trace_hardware_release_command_from_api_log() from public;

drop trigger if exists trg_trace_hardware_release_command_from_api_log on public.api_logs;
create trigger trg_trace_hardware_release_command_from_api_log
after insert on public.api_logs
for each row
when (new.service = 'chargenow' and new.endpoint = '/cabinet/ejectByRent')
execute function public.trace_hardware_release_command_from_api_log();

with matched as (
  select distinct on (rs.id) rs.id as rental_id, l.created_at as command_at
  from public.rental_sessions rs
  join public.api_logs l
    on l.service = 'chargenow'
   and l.endpoint = '/cabinet/ejectByRent'
   and l.request ->> 'tradeNo' = rs.apifox_trade_no
  where rs.apifox_trade_no is not null
  order by rs.id, l.created_at asc
)
update public.hardware_release_attempts h
set command_sent_at = coalesce(h.command_sent_at, matched.command_at),
    result = case when h.result = 'prepared' then 'command_sent' else h.result end,
    updated_at = now()
from matched
where h.rental_session_id = matched.rental_id
  and h.command_sent_at is null;
