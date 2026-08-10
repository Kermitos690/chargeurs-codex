-- create-stripe-checkout uses PostgREST's `on_conflict=stripe_session_id`.
-- That endpoint cannot infer a partial unique index, which made the original
-- partial index fail with PostgreSQL 42P10 after Stripe had already created a
-- Checkout Session. A real unique constraint is required. PostgreSQL allows
-- multiple NULL values in a UNIQUE constraint, so non-Stripe payment rows are
-- unaffected. Preflight confirmed no duplicate non-null Stripe session IDs.
ALTER TABLE public.payments
  ADD CONSTRAINT payments_stripe_session_id_key UNIQUE (stripe_session_id);
