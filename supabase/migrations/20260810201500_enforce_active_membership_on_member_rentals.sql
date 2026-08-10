create or replace function public.enforce_active_membership_on_member_rental()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.customer_segment = 'member' then
    if new.customer_user_id is null or not exists (
      select 1
      from public.customer_memberships cm
      join public.customer_membership_plans p on p.id = cm.plan_id
      where cm.user_id = new.customer_user_id
        and cm.status = 'active'
        and (cm.starts_at is null or cm.starts_at <= now())
        and (cm.ends_at is null or cm.ends_at > now())
        and p.active = true
        and p.valid_from <= now()
        and (p.valid_to is null or p.valid_to > now())
    ) then
      raise exception 'MEMBER_PAIRING_REQUIRED';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_active_membership_on_member_rental on public.rental_sessions;
create trigger trg_enforce_active_membership_on_member_rental
before insert or update of customer_segment, customer_user_id
on public.rental_sessions
for each row execute function public.enforce_active_membership_on_member_rental();
