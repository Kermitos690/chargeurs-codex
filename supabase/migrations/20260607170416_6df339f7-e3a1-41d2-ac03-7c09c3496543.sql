
-- ============ Remove demo default prices (no hardcoded 2 CHF) ============
ALTER TABLE public.stations ALTER COLUMN price_per_period DROP DEFAULT;
ALTER TABLE public.rental_sessions ALTER COLUMN amount DROP DEFAULT;

-- ============ PROFILES ============
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text,
  email text,
  phone text,
  locale text DEFAULT 'fr',
  preferred_language text DEFAULT 'fr',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own profile" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "Users upsert own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE POLICY "Admins read all profiles" ON public.profiles FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============ SHOPS ============
CREATE TABLE public.shops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  chargenow_shop_id text,
  address text,
  city text,
  contact_name text,
  contact_email text,
  contact_phone text,
  opening_hours jsonb,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.shops TO authenticated;
GRANT ALL ON public.shops TO service_role;
ALTER TABLE public.shops ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage shops" ON public.shops FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER trg_shops_updated BEFORE UPDATE ON public.shops FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============ KIOSK DEVICES ============
CREATE TABLE public.kiosk_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id text NOT NULL,
  label text,
  token_hash text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (token_hash)
);
GRANT ALL ON public.kiosk_devices TO service_role;
ALTER TABLE public.kiosk_devices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage kiosk devices" ON public.kiosk_devices FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER trg_kiosk_devices_updated BEFORE UPDATE ON public.kiosk_devices FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============ RENTAL EVENTS ============
CREATE TABLE public.rental_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rental_session_id uuid REFERENCES public.rental_sessions(id) ON DELETE CASCADE,
  type text NOT NULL,
  source text,
  data jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_rental_events_session ON public.rental_events(rental_session_id);
GRANT ALL ON public.rental_events TO service_role;
GRANT SELECT ON public.rental_events TO authenticated;
ALTER TABLE public.rental_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read rental events" ON public.rental_events FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- ============ CHARGENOW CALLBACKS ============
CREATE TABLE public.chargenow_callbacks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_no text,
  station_id text,
  status text,
  idempotency_key text UNIQUE,
  raw jsonb,
  processed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_cn_callbacks_trade ON public.chargenow_callbacks(trade_no);
GRANT ALL ON public.chargenow_callbacks TO service_role;
ALTER TABLE public.chargenow_callbacks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read cn callbacks" ON public.chargenow_callbacks FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- ============ REFUNDS ============
CREATE TABLE public.refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rental_session_id uuid REFERENCES public.rental_sessions(id) ON DELETE SET NULL,
  amount numeric NOT NULL,
  currency text NOT NULL DEFAULT 'CHF',
  stripe_refund_id text UNIQUE,
  status text NOT NULL DEFAULT 'pending',
  reason text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.refunds TO service_role;
GRANT SELECT ON public.refunds TO authenticated;
ALTER TABLE public.refunds ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read refunds" ON public.refunds FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER trg_refunds_updated BEFORE UPDATE ON public.refunds FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============ AUDIT LOGS ============
CREATE TABLE public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor uuid,
  action text NOT NULL,
  target text,
  data jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.audit_logs TO service_role;
GRANT SELECT ON public.audit_logs TO authenticated;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read audit logs" ON public.audit_logs FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- ============ SYSTEM INCIDENTS ============
CREATE TABLE public.system_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL,
  severity text NOT NULL DEFAULT 'warning',
  message text,
  data jsonb,
  resolved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.system_incidents TO service_role;
GRANT SELECT ON public.system_incidents TO authenticated;
ALTER TABLE public.system_incidents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read incidents" ON public.system_incidents FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER trg_incidents_updated BEFORE UPDATE ON public.system_incidents FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============ WALLETS ============
CREATE TABLE public.wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  currency text NOT NULL DEFAULT 'CHF',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, currency)
);
GRANT SELECT ON public.wallets TO authenticated;
GRANT ALL ON public.wallets TO service_role;
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own wallet" ON public.wallets FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Admins read wallets" ON public.wallets FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER trg_wallets_updated BEFORE UPDATE ON public.wallets FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============ WALLET LEDGER (immutable) ============
CREATE TABLE public.wallet_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id uuid NOT NULL REFERENCES public.wallets(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('credit','debit','hold','release','refund','adjust','bonus','topup')),
  amount_cents integer NOT NULL,
  currency text NOT NULL DEFAULT 'CHF',
  balance_after_cents integer,
  ref_rental_session_id uuid,
  ref_stripe_id text,
  idempotency_key text UNIQUE,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_wallet_ledger_wallet ON public.wallet_ledger(wallet_id);
-- Immutable: only service_role may insert; nobody may update/delete.
GRANT SELECT ON public.wallet_ledger TO authenticated;
GRANT SELECT, INSERT ON public.wallet_ledger TO service_role;
REVOKE UPDATE, DELETE ON public.wallet_ledger FROM service_role;
ALTER TABLE public.wallet_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own ledger" ON public.wallet_ledger FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.wallets w WHERE w.id = wallet_ledger.wallet_id AND w.user_id = auth.uid()));
CREATE POLICY "Admins read ledger" ON public.wallet_ledger FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- Compute running balance + block negative balances at the DB level.
CREATE OR REPLACE FUNCTION public.wallet_ledger_apply()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE prev integer;
BEGIN
  SELECT balance_after_cents INTO prev FROM public.wallet_ledger
    WHERE wallet_id = NEW.wallet_id ORDER BY created_at DESC, id DESC LIMIT 1;
  prev := COALESCE(prev, 0);
  NEW.balance_after_cents := prev + NEW.amount_cents;
  IF NEW.balance_after_cents < 0 THEN
    RAISE EXCEPTION 'WALLET_NEGATIVE_BALANCE';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER trg_wallet_ledger_apply BEFORE INSERT ON public.wallet_ledger
  FOR EACH ROW EXECUTE FUNCTION public.wallet_ledger_apply();

-- Block any UPDATE/DELETE attempt (defense in depth beyond GRANT).
CREATE OR REPLACE FUNCTION public.wallet_ledger_immutable()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN RAISE EXCEPTION 'WALLET_LEDGER_IMMUTABLE'; END; $$;
CREATE TRIGGER trg_wallet_ledger_no_update BEFORE UPDATE ON public.wallet_ledger
  FOR EACH ROW EXECUTE FUNCTION public.wallet_ledger_immutable();
CREATE TRIGGER trg_wallet_ledger_no_delete BEFORE DELETE ON public.wallet_ledger
  FOR EACH ROW EXECUTE FUNCTION public.wallet_ledger_immutable();

-- ============ WALLET TOPUPS ============
CREATE TABLE public.wallet_topups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id uuid NOT NULL REFERENCES public.wallets(id) ON DELETE CASCADE,
  amount_cents integer NOT NULL,
  currency text NOT NULL DEFAULT 'CHF',
  stripe_checkout_session_id text UNIQUE,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.wallet_topups TO authenticated;
GRANT ALL ON public.wallet_topups TO service_role;
ALTER TABLE public.wallet_topups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own topups" ON public.wallet_topups FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.wallets w WHERE w.id = wallet_topups.wallet_id AND w.user_id = auth.uid()));
CREATE POLICY "Admins read topups" ON public.wallet_topups FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER trg_wallet_topups_updated BEFORE UPDATE ON public.wallet_topups FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
