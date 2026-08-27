-- Redemption idempotency keys are client-scoped. Prevent one customer from
-- occupying another customer's key while preserving replay safety per user.

alter table public.reward_redemptions
  drop constraint if exists reward_redemptions_idempotency_key_key;

create unique index if not exists reward_redemptions_user_idempotency_key
  on public.reward_redemptions(user_id,idempotency_key);
