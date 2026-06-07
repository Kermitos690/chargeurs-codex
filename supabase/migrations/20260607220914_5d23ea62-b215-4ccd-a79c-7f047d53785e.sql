-- Enrich api_coverage with the exhaustive ChargeNow matrix metadata
ALTER TABLE public.api_coverage
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS business_function text,
  ADD COLUMN IF NOT EXISTS consumer text,
  ADD COLUMN IF NOT EXISTS internal_route text,
  ADD COLUMN IF NOT EXISTS integration_state text,
  ADD COLUMN IF NOT EXISTS has_test boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS test_ref text,
  ADD COLUMN IF NOT EXISTS missing_test text,
  ADD COLUMN IF NOT EXISTS risk text,
  ADD COLUMN IF NOT EXISTS logging text,
  ADD COLUMN IF NOT EXISTS idempotent boolean,
  ADD COLUMN IF NOT EXISTS retry_policy text,
  ADD COLUMN IF NOT EXISTS proof_state text;