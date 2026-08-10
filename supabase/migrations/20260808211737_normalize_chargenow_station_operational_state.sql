create or replace function public.normalize_chargenow_station_operational_state()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- ChargeNow business code 2009 means the cabinet is reachable but no charger
  -- is currently rentable because batteries are recharging. It is not an
  -- offline signal.
  if new.provider_last_error in ('HTTP_200_CODE_2009', 'CHARGENOW_ALL_CHARGERS_RECHARGING') then
    new.status := 'online';
    new.online := true;
    new.rentable_count := 0;
    return new;
  end if;

  -- ChargeNow business code 2005 is an explicit physical/provider offline signal.
  if new.provider_last_error in ('HTTP_200_CODE_2005', 'CHARGENOW_DEVICE_OFFLINE') then
    new.status := 'offline';
    new.online := false;
    return new;
  end if;

  -- Unknown provider/transport failures must not be rewritten as a proven
  -- physical offline state. Fail closed for rentals while keeping truthfulness
  -- in the UI by exposing a nullable online state.
  if new.status = 'unknown' and new.online = false and new.provider_last_error is not null then
    new.online := null;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_normalize_chargenow_station_operational_state on public.stations;
create trigger trg_normalize_chargenow_station_operational_state
before insert or update on public.stations
for each row
execute function public.normalize_chargenow_station_operational_state();

-- Re-normalize rows already carrying a known ChargeNow business state.
update public.stations
set provider_last_error = provider_last_error
where provider_last_error in (
  'HTTP_200_CODE_2009',
  'CHARGENOW_ALL_CHARGERS_RECHARGING',
  'HTTP_200_CODE_2005',
  'CHARGENOW_DEVICE_OFFLINE'
);
