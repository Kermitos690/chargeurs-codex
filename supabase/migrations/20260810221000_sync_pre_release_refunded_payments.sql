create or replace function public.sync_pre_release_refunded_payment()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_refunded bigint := coalesce(new.amount_refunded_cents, 0);
  v_authorized bigint := coalesce(new.amount_authorized_cents, 0);
  v_captured bigint := coalesce(new.amount_captured_cents, 0);
  v_required bigint := greatest(v_authorized, v_captured);
begin
  if new.rental_session_id is null or new.status <> 'refunded' or v_required <= 0 or v_refunded < v_required then
    return new;
  end if;

  update public.rental_sessions rs
  set state = 'refunded',
      settlement_status = 'settled',
      settlement_error = coalesce(rs.settlement_error, rs.failure_code, 'PRE_RELEASE_COMPENSATED'),
      refunded_amount_cents = greatest(coalesce(rs.refunded_amount_cents, 0), v_refunded),
      failure_code = null,
      failure_message = null,
      chargenow_status = 'compensated_before_hardware',
      closed_at = coalesce(rs.closed_at, new.refunded_at, now())
  where rs.id = new.rental_session_id
    and rs.ejected_at is null
    and rs.started_at is null
    and not exists (
      select 1
      from public.hardware_release_attempts h
      where h.rental_session_id = rs.id
        and (
          h.command_sent_at is not null
          or h.result in ('command_sent', 'single_release', 'multi_release')
        )
    );

  return new;
end;
$$;

drop trigger if exists trg_sync_pre_release_refunded_payment on public.payments;
create trigger trg_sync_pre_release_refunded_payment
after insert or update of status, amount_refunded_cents, amount_authorized_cents, amount_captured_cents
on public.payments
for each row
execute function public.sync_pre_release_refunded_payment();

-- Repair only already-refunded sessions for which no physical command was sent.
update public.rental_sessions rs
set state = 'refunded',
    settlement_status = 'settled',
    settlement_error = coalesce(rs.settlement_error, rs.failure_code, 'PRE_RELEASE_COMPENSATED'),
    refunded_amount_cents = greatest(coalesce(rs.refunded_amount_cents, 0), coalesce(p.amount_refunded_cents, 0)),
    failure_code = null,
    failure_message = null,
    chargenow_status = 'compensated_before_hardware',
    closed_at = coalesce(rs.closed_at, p.refunded_at, now())
from public.payments p
where p.rental_session_id = rs.id
  and p.status = 'refunded'
  and greatest(coalesce(p.amount_authorized_cents, 0), coalesce(p.amount_captured_cents, 0)) > 0
  and coalesce(p.amount_refunded_cents, 0) >= greatest(coalesce(p.amount_authorized_cents, 0), coalesce(p.amount_captured_cents, 0))
  and rs.ejected_at is null
  and rs.started_at is null
  and not exists (
    select 1 from public.hardware_release_attempts h
    where h.rental_session_id = rs.id
      and (h.command_sent_at is not null or h.result in ('command_sent','single_release','multi_release'))
  );