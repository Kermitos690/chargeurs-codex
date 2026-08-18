-- DTA21269 staging pilot: permit creation of the rental/session envelope while
-- retaining the physical-release quarantine. This aligns the database trigger
-- with create-rental-session's already-scoped pilot_flow_allowed contract.
--
-- Safety invariant: ONLY the exact DTA21269 staging pilot with exactly one
-- active quarantine reason SUPPLIER_SINGLE_SLOT_RENTAL_CONTRACT_UNVERIFIED may
-- insert a session. The quarantine row remains active. Payment/release/provider
-- mutation gates are independent and are not changed by this migration.

create or replace function public.block_new_rental_on_hardware_quarantine()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_active_quarantine_count integer := 0;
  v_exact_pilot_exception boolean := false;
begin
  select count(*)
    into v_active_quarantine_count
    from public.station_hardware_quarantines q
   where q.station_id = new.station_id
     and q.active = true;

  if v_active_quarantine_count = 0 then
    return new;
  end if;

  select (
    new.station_id = 'DTA21269'
    and v_active_quarantine_count = 1
    and exists (
      select 1
        from public.stations s
       where s.station_id = new.station_id
         and s.environment = 'staging'
         and s.is_pilot = true
    )
    and exists (
      select 1
        from public.station_hardware_quarantines q
       where q.station_id = new.station_id
         and q.active = true
         and q.reason_code = 'SUPPLIER_SINGLE_SLOT_RENTAL_CONTRACT_UNVERIFIED'
    )
  ) into v_exact_pilot_exception;

  if v_exact_pilot_exception then
    return new;
  end if;

  raise exception using
    errcode = 'P0001',
    message = 'STATION_HARDWARE_QUARANTINED';
end;
$function$;

comment on function public.block_new_rental_on_hardware_quarantine() is
  'Fail closed for active hardware quarantine; sole exception permits DTA21269 staging pilot session creation while the exact single-slot supplier quarantine remains active. Physical release gates are unchanged.';
