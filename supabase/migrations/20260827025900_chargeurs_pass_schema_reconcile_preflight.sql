-- Reconciliation preflight for staging databases where an earlier interrupted
-- Pass rollout created RLS policies without recording the final migration.
-- Safe on a fresh database: every DROP is guarded by to_regclass().

do $preflight$
begin
  if to_regclass('public.loyalty_campaigns') is not null then
    execute 'drop policy if exists loyalty_campaigns_read_active on public.loyalty_campaigns';
  end if;
  if to_regclass('public.loyalty_campaign_enrollments') is not null then
    execute 'drop policy if exists loyalty_enrollments_read_own on public.loyalty_campaign_enrollments';
  end if;
  if to_regclass('public.loyalty_missions') is not null then
    execute 'drop policy if exists loyalty_missions_read_active on public.loyalty_missions';
  end if;
  if to_regclass('public.loyalty_mission_progress') is not null then
    execute 'drop policy if exists loyalty_progress_read_own on public.loyalty_mission_progress';
  end if;
  if to_regclass('public.rewards_catalog') is not null then
    execute 'drop policy if exists rewards_catalog_read_active on public.rewards_catalog';
  end if;
  if to_regclass('public.reward_redemptions') is not null then
    execute 'drop policy if exists reward_redemptions_read_own on public.reward_redemptions';
  end if;
  if to_regclass('public.wallet_rental_reservations') is not null then
    execute 'drop policy if exists wallet_reservations_read_own on public.wallet_rental_reservations';
  end if;
  if to_regclass('public.wallet_spend_allocations') is not null then
    execute 'drop policy if exists wallet_spend_allocations_read_own on public.wallet_spend_allocations';
  end if;
end
$preflight$;
