-- Chargeurs Pass wallet operations. Service-role only for financial mutations.

create or replace function public.append_wallet_entry_server(
  p_user_id uuid,
  p_amount_cents integer,
  p_type text,
  p_idempotency_key text,
  p_credit_kind text default 'other',
  p_source_type text default null,
  p_source_id text default null,
  p_campaign_id uuid default null,
  p_reward_id uuid default null,
  p_ref_rental_session_id uuid default null,
  p_ref_stripe_id text default null,
  p_note text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns table(entry_id uuid,wallet_id uuid,balance_after_cents integer,applied boolean)
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
declare
  v_wallet public.wallets%rowtype;
  v_entry public.wallet_ledger%rowtype;
begin
  if p_user_id is null or p_amount_cents=0 or coalesce(trim(p_idempotency_key),'')='' then raise exception 'WALLET_ENTRY_INVALID'; end if;
  if p_type not in ('credit','debit','hold','release','refund','adjust','bonus','topup') then raise exception 'WALLET_ENTRY_TYPE_INVALID'; end if;
  if p_credit_kind not in ('paid','promo','refund','reservation','other') then raise exception 'WALLET_CREDIT_KIND_INVALID'; end if;

  insert into public.wallets(user_id,currency) values(p_user_id,'CHF')
  on conflict(user_id,currency) do nothing;
  select * into v_wallet from public.wallets where user_id=p_user_id and currency='CHF' for update;
  if not found then raise exception 'WALLET_NOT_FOUND'; end if;

  select * into v_entry from public.wallet_ledger where idempotency_key=p_idempotency_key;
  if found then
    if v_entry.wallet_id<>v_wallet.id
       or v_entry.amount_cents<>p_amount_cents
       or v_entry.type<>p_type
       or v_entry.credit_kind<>p_credit_kind
       or v_entry.source_type is distinct from p_source_type
       or v_entry.source_id is distinct from p_source_id
       or v_entry.campaign_id is distinct from p_campaign_id
       or v_entry.reward_id is distinct from p_reward_id
       or v_entry.ref_rental_session_id is distinct from p_ref_rental_session_id
       or v_entry.ref_stripe_id is distinct from p_ref_stripe_id then
      raise exception 'WALLET_IDEMPOTENCY_CONFLICT';
    end if;
    return query select v_entry.id,v_wallet.id,coalesce(v_entry.balance_after_cents,0),false;
    return;
  end if;

  insert into public.wallet_ledger(
    wallet_id,type,amount_cents,currency,ref_rental_session_id,ref_stripe_id,idempotency_key,note,
    credit_kind,source_type,source_id,campaign_id,reward_id,metadata
  ) values(
    v_wallet.id,p_type,p_amount_cents,'CHF',p_ref_rental_session_id,p_ref_stripe_id,p_idempotency_key,p_note,
    p_credit_kind,p_source_type,p_source_id,p_campaign_id,p_reward_id,coalesce(p_metadata,'{}'::jsonb)
  ) returning * into v_entry;

  return query select v_entry.id,v_wallet.id,coalesce(v_entry.balance_after_cents,0),true;
end;
$function$;
revoke all on function public.append_wallet_entry_server(uuid,integer,text,text,text,text,text,uuid,uuid,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.append_wallet_entry_server(uuid,integer,text,text,text,text,text,uuid,uuid,uuid,text,text,jsonb) to service_role;

create or replace function public.confirm_chargeurs_pass_topup(
  p_topup_id uuid,
  p_stripe_checkout_session_id text,
  p_stripe_payment_intent_id text,
  p_amount_cents integer,
  p_currency text
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
declare
  v_topup public.wallet_topups%rowtype;
  v_wallet public.wallets%rowtype;
  v_campaign public.loyalty_campaigns%rowtype;
  v_entry record;
  v_enrollment_id uuid;
begin
  if coalesce(trim(p_stripe_checkout_session_id),'')='' or coalesce(trim(p_stripe_payment_intent_id),'')='' then
    raise exception 'PASS_TOPUP_STRIPE_REFERENCE_REQUIRED';
  end if;

  select * into v_topup from public.wallet_topups where id=p_topup_id for update;
  if not found then raise exception 'PASS_TOPUP_NOT_FOUND'; end if;
  select * into v_wallet from public.wallets where id=v_topup.wallet_id for update;
  if not found then raise exception 'PASS_WALLET_NOT_FOUND'; end if;
  select * into v_campaign from public.loyalty_campaigns where id=v_topup.campaign_id for update;
  if not found or v_campaign.code<>'launch_offer_45' then raise exception 'PASS_CAMPAIGN_INVALID'; end if;

  if v_topup.payment_purpose is distinct from 'chargeurs_pass_topup' then raise exception 'PASS_TOPUP_PURPOSE_MISMATCH'; end if;
  if upper(coalesce(p_currency,''))<>upper(v_campaign.currency)
     or p_amount_cents<>v_campaign.purchase_price_cents
     or v_topup.amount_cents<>v_campaign.purchase_price_cents
     or upper(v_topup.currency)<>upper(v_campaign.currency) then raise exception 'PASS_TOPUP_AMOUNT_MISMATCH'; end if;
  if v_topup.stripe_checkout_session_id is distinct from p_stripe_checkout_session_id then raise exception 'PASS_TOPUP_CHECKOUT_MISMATCH'; end if;
  if v_topup.stripe_payment_intent_id is not null
     and v_topup.stripe_payment_intent_id is distinct from p_stripe_payment_intent_id then raise exception 'PASS_TOPUP_PAYMENT_INTENT_MISMATCH'; end if;

  select * into v_entry from public.append_wallet_entry_server(
    v_wallet.user_id,v_campaign.purchased_credit_cents,'topup','pass_topup:'||p_stripe_checkout_session_id,
    'paid','stripe_topup',p_topup_id::text,v_campaign.id,null,null,p_stripe_payment_intent_id,
    'Chargeurs Pass — crédit acheté',jsonb_build_object('checkout_session_id',p_stripe_checkout_session_id,'campaign_code',v_campaign.code)
  );

  update public.wallet_topups set status='completed',stripe_payment_intent_id=p_stripe_payment_intent_id,
    confirmed_at=coalesce(confirmed_at,now()),updated_at=now() where id=p_topup_id;

  insert into public.loyalty_campaign_enrollments(
    campaign_id,user_id,wallet_topup_id,status,paid_amount_cents,purchased_credit_cents,activated_at
  ) values(v_campaign.id,v_wallet.user_id,p_topup_id,'active',p_amount_cents,v_campaign.purchased_credit_cents,now())
  on conflict(campaign_id,user_id) do update set
    wallet_topup_id=excluded.wallet_topup_id,
    status=case when public.loyalty_campaign_enrollments.status='pending' then 'active' else public.loyalty_campaign_enrollments.status end,
    paid_amount_cents=greatest(public.loyalty_campaign_enrollments.paid_amount_cents,excluded.paid_amount_cents),
    purchased_credit_cents=greatest(public.loyalty_campaign_enrollments.purchased_credit_cents,excluded.purchased_credit_cents),
    activated_at=coalesce(public.loyalty_campaign_enrollments.activated_at,now())
  returning id into v_enrollment_id;

  return jsonb_build_object('ok',true,'topup_id',p_topup_id,'enrollment_id',v_enrollment_id,
    'wallet_balance_cents',v_entry.balance_after_cents,'credited_cents',v_campaign.purchased_credit_cents,'replayed',not v_entry.applied);
end;
$function$;
revoke all on function public.confirm_chargeurs_pass_topup(uuid,text,text,integer,text) from public,anon,authenticated;
grant execute on function public.confirm_chargeurs_pass_topup(uuid,text,text,integer,text) to service_role;
