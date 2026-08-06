-- The canonical 20260607153031 migration declares this index, but the staging
-- database is missing it. create-stripe-checkout upserts payments by
-- stripe_session_id, so Postgres rejects the upsert with 42P10 without this
-- unique partial index. Preflight confirmed no duplicate non-null values.
CREATE UNIQUE INDEX IF NOT EXISTS payments_stripe_session_key
  ON public.payments(stripe_session_id)
  WHERE stripe_session_id IS NOT NULL;
