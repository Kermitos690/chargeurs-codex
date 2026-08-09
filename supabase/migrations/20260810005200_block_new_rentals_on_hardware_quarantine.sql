-- Fail before Checkout/payment when a station is hardware-quarantined.
-- Existing rentals and return/settlement flows remain untouched.

create or replace function public.block_new_rental_on_hardware_quarantine()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1
    from public.station_hardware_quarantines q
    where q.station_id = new.station_id
      and q.active = true
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'STATION_HARDWARE_QUARANTINED';
  end if;
  return new;
end;
$$;

revoke all on function public.block_new_rental_on_hardware_quarantine() from public;

drop trigger if exists trg_block_new_rental_on_hardware_quarantine on public.rental_sessions;
create trigger trg_block_new_rental_on_hardware_quarantine
before insert on public.rental_sessions
for each row
execute function public.block_new_rental_on_hardware_quarantine();
