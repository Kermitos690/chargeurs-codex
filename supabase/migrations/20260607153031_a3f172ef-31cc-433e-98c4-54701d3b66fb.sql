ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'viewer';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'operator';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'super_admin';

ALTER TABLE public.rental_sessions
  ADD COLUMN IF NOT EXISTS public_session_code text,
  ADD COLUMN IF NOT EXISTS shop_id text,
  ADD COLUMN IF NOT EXISTS price_profile_id uuid REFERENCES public.price_profiles(id),
  ADD COLUMN IF NOT EXISTS amount_expected numeric,
  ADD COLUMN IF NOT EXISTS amount_paid numeric,
  ADD COLUMN IF NOT EXISTS stripe_payment_method_type text,
  ADD COLUMN IF NOT EXISTS stripe_customer_id text,
  ADD COLUMN IF NOT EXISTS chargenow_order_id text,
  ADD COLUMN IF NOT EXISTS chargenow_status text,
  ADD COLUMN IF NOT EXISTS checkout_url_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS failure_code text,
  ADD COLUMN IF NOT EXISTS failure_message text,
  ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS rental_sessions_public_code_key
  ON public.rental_sessions(public_session_code) WHERE public_session_code IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS rental_sessions_checkout_session_key
  ON public.rental_sessions(stripe_checkout_session_id) WHERE stripe_checkout_session_id IS NOT NULL;

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS refund_id text,
  ADD COLUMN IF NOT EXISTS refunded_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS payments_stripe_session_key
  ON public.payments(stripe_session_id) WHERE stripe_session_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS apifox_orders_session_key
  ON public.apifox_orders(rental_session_id) WHERE rental_session_id IS NOT NULL;

ALTER TABLE public.price_profiles
  ADD COLUMN IF NOT EXISTS chargenow_price_id text,
  ADD COLUMN IF NOT EXISTS shop_id text,
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.stations
  ADD COLUMN IF NOT EXISTS shop_id text;