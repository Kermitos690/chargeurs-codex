-- Chargeurs Pass missions and rewards engine.
-- Rewards are driven by trusted server-side rental_completed events and by
-- audited wallet spend allocations. No frontend event can grant points.

create or replace function public.redeem_chargepoints_reward(
  p_reward_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
declare
  v_user uuid:=auth.uid();
  v_reward public.rewards_catalog%rowtype;
  v_enrollment public.loyalty_campaign_enrollments%rowtype;
  v_existing public.reward_redemptions%rowtype;
  v_redemption_id uuid:=gen_random_uuid();
  v_points_balance bigint;
  v_points_after bigint;
  v_count integer;
  v_wallet record;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  if coalesce(trim(p_idempotency_key),'')='' then raise exception 'REDEMPTION_IDEMPOTENCY_REQUIRED'; end if;

  perform pg_advisory_xact_lock(hashtextextended('chargeurs:reward:'||v_user::text,0));

  select * into v_existing from public.reward_redemptions
  where user_id=v_user and idempotency_key=p_idempotency_key;
  if found then
    return jsonb_build_object('ok',true,'redemption_id',v_existing.id,'replayed',true);
  end if;

  select * into v_reward from public.rewards_catalog
  where id=p_reward_id and active and valid_from<=now() and (valid_to is null or valid_to>now())
  for update;
  if not found then raise exception 'REWARD_UNAVAILABLE'; end if;

  if v_reward.max_redemptions_per_user is not null then
    select count(*) into v_count from public.reward_redemptions
    where user_id=v_user and reward_id=v_reward.id and status='completed';
    if v_count>=v_reward.max_redemptions_per_user then raise exception 'REWARD_USER_LIMIT_REACHED'; end if;
  end if;

  select coalesce(balance,0) into v_points_balance
  from public.customer_chargepoints_balances where user_id=v_user for update;
  v_points_balance:=coalesce(v_points_balance,0);
  if v_points_balance<v_reward.points_cost then raise exception 'INSUFFICIENT_CHARGEPOINTS'; end if;

  if v_reward.campaign_id is not null then
    select * into v_enrollment from public.loyalty_campaign_enrollments
    where campaign_id=v_reward.campaign_id and user_id=v_user and status in ('active','completed')
    for update;
    if not found then raise exception 'CAMPAIGN_ENROLLMENT_REQUIRED'; end if;
    if v_enrollment.campaign_points_earned-v_enrollment.campaign_points_spent<v_reward.points_cost then
      raise exception 'INSUFFICIENT_CAMPAIGN_POINTS';
    end if;
    if v_enrollment.reward_value_redeemed_cents+v_reward.reward_value_cents>v_enrollment.reward_value_unlocked_cents then
      raise exception 'REWARD_VALUE_NOT_YET_UNLOCKED';
    end if;
    if v_enrollment.reward_value_redeemed_cents+v_reward.reward_value_cents>
      (select reward_value_cap_cents from public.loyalty_campaigns where id=v_reward.campaign_id) then
      raise exception 'CAMPAIGN_REWARD_VALUE_CAP';
    end if;
  end if;

  v_points_after:=public.append_customer_chargepoints(
    v_user,
    -v_reward.points_cost,
    'redeem',
    'reward_redeemed',
    'reward',
    v_reward.id,
    null,
    p_idempotency_key||':points',
    jsonb_build_object('reward_code',v_reward.code,'reward_value_cents',v_reward.reward_value_cents)
  );

  if v_reward.reward_type='wallet_credit' then
    select * into v_wallet from public.append_wallet_entry_server(
      v_user,
      v_reward.wallet_credit_cents,
      'bonus',
      p_idempotency_key||':wallet',
      'promo',
      'reward',
      v_reward.id::text,
      v_reward.campaign_id,
      v_reward.id,
      null,
      null,
      'Récompense Charge Points',
      jsonb_build_object('reward_code',v_reward.code)
    );
  end if;

  insert into public.reward_redemptions(
    id,user_id,reward_id,campaign_id,enrollment_id,points_spent,reward_value_cents,status,idempotency_key,metadata
  ) values(
    v_redemption_id,v_user,v_reward.id,v_reward.campaign_id,
    case when v_reward.campaign_id is null then null else v_enrollment.id end,
    v_reward.points_cost,v_reward.reward_value_cents,'completed',p_idempotency_key,
    jsonb_build_object('reward_code',v_reward.code)
  );

  if v_reward.campaign_id is not null then
    update public.loyalty_campaign_enrollments set
      campaign_points_spent=campaign_points_spent+v_reward.points_cost,
      reward_value_redeemed_cents=reward_value_redeemed_cents+v_reward.reward_value_cents
    where id=v_enrollment.id;
  end if;

  return jsonb_build_object(
    'ok',true,
    'redemption_id',v_redemption_id,
    'points_balance',v_points_after,
    'wallet_balance_cents',case when v_reward.reward_type='wallet_credit' then v_wallet.balance_after_cents else null end,
    'replayed',false
  );
end;
$function$;
revoke all on function public.redeem_chargepoints_reward(uuid,text) from public,anon;
grant execute on function public.redeem_chargepoints_reward(uuid,text) to authenticated,service_role;

create or replace function public.apply_loyalty_missions_on_rental_event()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
declare
  v_session public.rental_sessions%rowtype;
  v_enrollment public.loyalty_campaign_enrollments%rowtype;
  v_campaign public.loyalty_campaigns%rowtype;
  v_mission public.loyalty_missions%rowtype;
  v_previous public.loyalty_mission_progress%rowtype;
  v_progress bigint;
  v_was_completed boolean;
  v_points_after bigint;
begin
  if new.event_type<>'rental_completed' then return new; end if;

  select * into v_session from public.rental_sessions where id=new.rental_id;
  if not found or v_session.customer_user_id is null then return new; end if;
  if coalesce(v_session.final_amount_cents,-1)<0 then return new; end if;

  for v_enrollment in
    select * from public.loyalty_campaign_enrollments
    where user_id=v_session.customer_user_id and status='active'
    for update
  loop
    select * into v_campaign from public.loyalty_campaigns
    where id=v_enrollment.campaign_id and active and valid_from<=now() and (valid_to is null or valid_to>now());
    if not found then continue; end if;

    for v_mission in
      select * from public.loyalty_missions
      where campaign_id=v_campaign.id and active
      order by sort_order,id
    loop
      if v_mission.metric='completed_rentals' then
        select count(distinct e.rental_id)::bigint into v_progress
        from public.rental_orchestrator_events e
        join public.rental_sessions r on r.id=e.rental_id
        where e.event_type='rental_completed'
          and e.occurred_at>=coalesce(v_enrollment.activated_at,v_enrollment.enrolled_at)
          and r.customer_user_id=v_session.customer_user_id;
      elsif v_mission.metric='distinct_stations' then
        select count(distinct r.station_id)::bigint into v_progress
        from public.rental_orchestrator_events e
        join public.rental_sessions r on r.id=e.rental_id
        where e.event_type='rental_completed'
          and e.occurred_at>=coalesce(v_enrollment.activated_at,v_enrollment.enrolled_at)
          and r.customer_user_id=v_session.customer_user_id;
      elsif v_mission.metric='campaign_paid_credit_spent_cents' then
        select coalesce(sum(a.amount_cents),0)::bigint into v_progress
        from public.wallet_spend_allocations a
        join public.wallet_ledger d on d.id=a.debit_entry_id
        join public.wallets w on w.id=d.wallet_id
        where a.campaign_id=v_campaign.id
          and a.credit_kind='paid'
          and d.source_type='rental'
          and w.user_id=v_session.customer_user_id
          and d.created_at>=coalesce(v_enrollment.activated_at,v_enrollment.enrolled_at);
      else
        select coalesce(sum(greatest(coalesce(r.final_amount_cents,0),0)),0)::bigint into v_progress
        from public.rental_sessions r
        where r.customer_user_id=v_session.customer_user_id
          and r.completed_at>=coalesce(v_enrollment.activated_at,v_enrollment.enrolled_at)
          and r.state in ('completed','closed');
      end if;

      select * into v_previous from public.loyalty_mission_progress
      where enrollment_id=v_enrollment.id and mission_id=v_mission.id for update;
      v_was_completed:=found and v_previous.status='completed';

      insert into public.loyalty_mission_progress(enrollment_id,mission_id,user_id,progress,status,completed_at)
      values(
        v_enrollment.id,v_mission.id,v_session.customer_user_id,v_progress,
        case when v_progress>=v_mission.threshold then 'completed' else 'in_progress' end,
        case when v_progress>=v_mission.threshold then now() else null end
      )
      on conflict(enrollment_id,mission_id) do update set
        progress=greatest(public.loyalty_mission_progress.progress,excluded.progress),
        status=case when excluded.progress>=v_mission.threshold then 'completed' else public.loyalty_mission_progress.status end,
        completed_at=case when excluded.progress>=v_mission.threshold then coalesce(public.loyalty_mission_progress.completed_at,now()) else public.loyalty_mission_progress.completed_at end,
        updated_at=now();

      if v_progress>=v_mission.threshold and not v_was_completed then
        if v_enrollment.reward_value_unlocked_cents+v_mission.reward_value_cents>v_campaign.reward_value_cap_cents then
          raise exception 'CAMPAIGN_UNLOCK_CAP_EXCEEDED';
        end if;

        v_points_after:=public.append_customer_chargepoints(
          v_session.customer_user_id,
          v_mission.reward_points,
          'earn',
          'mission_completed',
          'mission',
          v_mission.id,
          new.rental_id,
          'loyalty_mission:'||v_enrollment.id::text||':'||v_mission.id::text,
          jsonb_build_object('campaign_code',v_campaign.code,'mission_code',v_mission.code,'event_id',new.id)
        );

        update public.loyalty_campaign_enrollments set
          campaign_points_earned=campaign_points_earned+v_mission.reward_points,
          reward_value_unlocked_cents=reward_value_unlocked_cents+v_mission.reward_value_cents,
          status=case when reward_value_unlocked_cents+v_mission.reward_value_cents>=v_campaign.reward_value_cap_cents then 'completed' else status end,
          completed_at=case when reward_value_unlocked_cents+v_mission.reward_value_cents>=v_campaign.reward_value_cap_cents then coalesce(completed_at,now()) else completed_at end
        where id=v_enrollment.id;

        select * into v_enrollment from public.loyalty_campaign_enrollments where id=v_enrollment.id for update;
      end if;
    end loop;
  end loop;

  return new;
end;
$function$;

drop trigger if exists "chargeurs-apply-loyalty-missions" on public.rental_orchestrator_events;
create trigger "chargeurs-apply-loyalty-missions"
after insert on public.rental_orchestrator_events
for each row execute function public.apply_loyalty_missions_on_rental_event();

insert into public.loyalty_campaigns(
  code,name,description,currency,purchase_price_cents,purchased_credit_cents,reward_value_cap_cents,max_enrollments_per_user,active,config
) values(
  'launch_offer_45','Offre lancement CHF 45',
  'CHF 45 de crédit acheté + jusqu’à CHF 45 de récompenses à débloquer.',
  'CHF',4500,4500,4500,1,true,
  '{"marketing_promise":"CHF 45 chargés + jusqu’à CHF 45 de récompenses à débloquer"}'::jsonb
)
on conflict(code) do update set
  name=excluded.name,description=excluded.description,currency='CHF',purchase_price_cents=4500,
  purchased_credit_cents=4500,reward_value_cap_cents=4500,max_enrollments_per_user=1,active=true,updated_at=now();

with c as (select id from public.loyalty_campaigns where code='launch_offer_45')
insert into public.loyalty_missions(
  campaign_id,code,name,description,metric,threshold,reward_points,reward_value_cents,sort_order
)
select c.id,v.code,v.name,v.description,v.metric,v.threshold,v.points,v.value_cents,v.sort_order
from c cross join (values
  ('first_rental','Première location','Terminer une première location correctement.','completed_rentals',1::bigint,250::bigint,200,10),
  ('first_return','Premier retour','Rendre correctement une première batterie.','completed_rentals',1::bigint,250::bigint,200,20),
  ('three_rentals','3 locations','Terminer trois locations correctement.','completed_rentals',3::bigint,600::bigint,500,30),
  ('explore_network','Explorer le réseau','Utiliser au moins deux bornes différentes.','distinct_stations',2::bigint,600::bigint,500,40),
  ('spent_10','CHF 10 utilisés','Utiliser CHF 10 du crédit payé de lancement.','campaign_paid_credit_spent_cents',1000::bigint,1000::bigint,800,50),
  ('spent_25','CHF 25 utilisés','Utiliser CHF 25 du crédit payé de lancement.','campaign_paid_credit_spent_cents',2500::bigint,1500::bigint,1300,60),
  ('spent_45','Pack entièrement utilisé','Utiliser les CHF 45 du crédit payé de lancement.','campaign_paid_credit_spent_cents',4500::bigint,1800::bigint,1000,70)
) as v(code,name,description,metric,threshold,points,value_cents,sort_order)
on conflict(campaign_id,code) do update set
  name=excluded.name,description=excluded.description,metric=excluded.metric,threshold=excluded.threshold,
  reward_points=excluded.reward_points,reward_value_cents=excluded.reward_value_cents,sort_order=excluded.sort_order,
  active=true,updated_at=now();

with c as (select id from public.loyalty_campaigns where code='launch_offer_45')
insert into public.rewards_catalog(
  campaign_id,code,name,description,reward_type,points_cost,reward_value_cents,wallet_credit_cents,active,max_redemptions_per_user
)
select c.id,v.code,v.name,v.description,'wallet_credit',v.points,v.value_cents,v.credit_cents,true,v.max_count
from c cross join (values
  ('launch_credit_2','CHF 2 de crédit','Ajoute CHF 2 au crédit Chargeurs.',500::bigint,200,200,null::integer),
  ('launch_credit_5','CHF 5 de crédit','Ajoute CHF 5 au crédit Chargeurs.',1100::bigint,500,500,null::integer),
  ('launch_credit_10','CHF 10 de crédit','Ajoute CHF 10 au crédit Chargeurs.',2000::bigint,1000,1000,null::integer),
  ('launch_credit_45','CHF 45 de crédit','Récompense maximale de lancement, disponible après progression complète.',6000::bigint,4500,4500,1::integer)
) as v(code,name,description,points,value_cents,credit_cents,max_count)
on conflict(code) do update set
  campaign_id=excluded.campaign_id,name=excluded.name,description=excluded.description,
  points_cost=excluded.points_cost,reward_value_cents=excluded.reward_value_cents,
  wallet_credit_cents=excluded.wallet_credit_cents,active=true,max_redemptions_per_user=excluded.max_redemptions_per_user,
  updated_at=now();

do $assertions$
declare
  v_value integer;
  v_points bigint;
  v_campaign public.loyalty_campaigns%rowtype;
begin
  select * into v_campaign from public.loyalty_campaigns where code='launch_offer_45';
  if v_campaign.purchase_price_cents<>4500 or v_campaign.purchased_credit_cents<>4500 or v_campaign.reward_value_cap_cents<>4500 then
    raise exception 'PASS_LAUNCH_CAMPAIGN_ASSERTION_FAILED';
  end if;
  select coalesce(sum(reward_value_cents),0),coalesce(sum(reward_points),0) into v_value,v_points
  from public.loyalty_missions where campaign_id=v_campaign.id and active;
  if v_value<>4500 then raise exception 'PASS_LAUNCH_MISSION_VALUE_SUM_%',v_value; end if;
  if v_points<>6000 then raise exception 'PASS_LAUNCH_MISSION_POINTS_SUM_%',v_points; end if;
end
$assertions$;
