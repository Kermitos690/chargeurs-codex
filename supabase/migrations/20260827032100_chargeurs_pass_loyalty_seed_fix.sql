-- Keep the launch campaign reward budget exact while avoiding two rewards for
-- the same rental_completed event.
with c as (
  select id from public.loyalty_campaigns where code='launch_offer_45'
)
update public.loyalty_missions m
set name='Première location réussie',
    description='Terminer et rendre correctement une première location.',
    metric='completed_rentals',
    threshold=1,
    reward_points=500,
    reward_value_cents=400,
    active=true,
    updated_at=now()
from c
where m.campaign_id=c.id and m.code='first_rental';

with c as (
  select id from public.loyalty_campaigns where code='launch_offer_45'
)
update public.loyalty_missions m
set active=false,
    updated_at=now()
from c
where m.campaign_id=c.id and m.code='first_return';

do $assertions$
declare
  v_campaign_id uuid;
  v_value integer;
  v_points bigint;
  v_first_return_active boolean;
begin
  select id into v_campaign_id from public.loyalty_campaigns where code='launch_offer_45';
  if v_campaign_id is null then raise exception 'PASS_LAUNCH_CAMPAIGN_MISSING'; end if;

  select coalesce(sum(reward_value_cents),0),coalesce(sum(reward_points),0)
    into v_value,v_points
  from public.loyalty_missions
  where campaign_id=v_campaign_id and active;

  if v_value<>4500 then raise exception 'PASS_LAUNCH_ACTIVE_MISSION_VALUE_SUM_%',v_value; end if;
  if v_points<>6000 then raise exception 'PASS_LAUNCH_ACTIVE_MISSION_POINTS_SUM_%',v_points; end if;

  select active into v_first_return_active
  from public.loyalty_missions
  where campaign_id=v_campaign_id and code='first_return';
  if coalesce(v_first_return_active,true) then raise exception 'PASS_DUPLICATE_FIRST_RETURN_MISSION_ACTIVE'; end if;
end
$assertions$;
