-- Auditable allocation of wallet debits back to the credit entries that funded
-- them. This preserves paid-vs-promo accounting without exposing complexity to
-- the customer.

create table if not exists public.wallet_spend_allocations (
  id uuid primary key default gen_random_uuid(),
  debit_entry_id uuid not null references public.wallet_ledger(id),
  credit_entry_id uuid not null references public.wallet_ledger(id),
  amount_cents integer not null check (amount_cents > 0),
  credit_kind text not null check (credit_kind in ('paid','promo','refund','other')),
  campaign_id uuid,
  created_at timestamptz not null default now(),
  unique (debit_entry_id, credit_entry_id)
);
create index if not exists wallet_spend_allocations_credit_idx on public.wallet_spend_allocations(credit_entry_id);
create index if not exists wallet_spend_allocations_campaign_idx on public.wallet_spend_allocations(campaign_id,credit_kind);

alter table public.wallet_spend_allocations enable row level security;
revoke all on public.wallet_spend_allocations from public,anon,authenticated;
grant select on public.wallet_spend_allocations to authenticated;
grant all on public.wallet_spend_allocations to service_role;
create policy wallet_spend_allocations_read_own on public.wallet_spend_allocations for select to authenticated
using (exists (
  select 1 from public.wallet_ledger d join public.wallets w on w.id=d.wallet_id
  where d.id=wallet_spend_allocations.debit_entry_id and w.user_id=auth.uid()
));

alter table public.loyalty_missions drop constraint if exists loyalty_missions_metric_check;
alter table public.loyalty_missions add constraint loyalty_missions_metric_check
  check (metric in ('completed_rentals','distinct_stations','spent_cents','campaign_paid_credit_spent_cents'));

create or replace function public.allocate_wallet_debit_server(p_debit_entry_id uuid)
returns integer
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
declare
  v_debit public.wallet_ledger%rowtype;
  v_credit record;
  v_needed integer;
  v_take integer;
  v_allocated integer:=0;
begin
  select * into v_debit from public.wallet_ledger where id=p_debit_entry_id for update;
  if not found or v_debit.amount_cents>=0 or v_debit.type<>'debit' then raise exception 'WALLET_DEBIT_ENTRY_REQUIRED'; end if;
  if exists(select 1 from public.wallet_spend_allocations where debit_entry_id=p_debit_entry_id) then
    select coalesce(sum(amount_cents),0)::integer into v_allocated from public.wallet_spend_allocations where debit_entry_id=p_debit_entry_id;
    return v_allocated;
  end if;
  v_needed := -v_debit.amount_cents;

  for v_credit in
    select l.id,l.amount_cents,l.credit_kind,l.campaign_id,
      greatest(0,l.amount_cents-coalesce((select sum(a.amount_cents) from public.wallet_spend_allocations a where a.credit_entry_id=l.id),0))::integer as remaining
    from public.wallet_ledger l
    where l.wallet_id=v_debit.wallet_id and l.amount_cents>0
      and l.type in ('topup','bonus','credit','refund')
      and l.created_at<=v_debit.created_at
    order by l.created_at,l.id
    for update
  loop
    exit when v_needed<=0;
    if v_credit.remaining<=0 then continue; end if;
    v_take:=least(v_needed,v_credit.remaining);
    insert into public.wallet_spend_allocations(debit_entry_id,credit_entry_id,amount_cents,credit_kind,campaign_id)
    values(v_debit.id,v_credit.id,v_take,
      case when v_credit.credit_kind in ('paid','promo','refund','other') then v_credit.credit_kind else 'other' end,
      v_credit.campaign_id);
    v_needed:=v_needed-v_take;
    v_allocated:=v_allocated+v_take;
  end loop;

  if v_needed<>0 then raise exception 'WALLET_DEBIT_ALLOCATION_INCOMPLETE'; end if;
  return v_allocated;
end;
$function$;
revoke all on function public.allocate_wallet_debit_server(uuid) from public,anon,authenticated;
grant execute on function public.allocate_wallet_debit_server(uuid) to service_role;
