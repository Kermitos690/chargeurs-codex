-- ===== ROLE SYSTEM =====
CREATE TYPE public.app_role AS ENUM ('admin', 'staff', 'user');

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE POLICY "Users read own roles" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Admins read all roles" ON public.user_roles FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- ===== STATIONS =====
CREATE TABLE public.stations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id text UNIQUE NOT NULL,
  cabinet_id text,
  name text NOT NULL,
  location_name text,
  status text DEFAULT 'unknown',
  online boolean DEFAULT false,
  signal integer,
  rentable_count integer DEFAULT 0,
  returnable_count integer DEFAULT 0,
  total_count integer DEFAULT 0,
  currency text DEFAULT 'CHF',
  price_per_period numeric DEFAULT 2.00,
  last_sync_at timestamptz,
  raw_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.stations TO anon, authenticated;
GRANT ALL ON public.stations TO service_role;
ALTER TABLE public.stations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read stations" ON public.stations FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Admins manage stations" ON public.stations FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER trg_stations_updated BEFORE UPDATE ON public.stations FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ===== SLOTS =====
CREATE TABLE public.slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id text NOT NULL,
  slot_num integer NOT NULL,
  status text DEFAULT 'unknown',
  battery_id text,
  raw_data jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (station_id, slot_num)
);
GRANT SELECT ON public.slots TO anon, authenticated;
GRANT ALL ON public.slots TO service_role;
ALTER TABLE public.slots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read slots" ON public.slots FOR SELECT TO anon, authenticated USING (true);
CREATE TRIGGER trg_slots_updated BEFORE UPDATE ON public.slots FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ===== BATTERIES =====
CREATE TABLE public.batteries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  battery_id text UNIQUE NOT NULL,
  station_id text,
  slot_num integer,
  status text DEFAULT 'unknown',
  power_level integer,
  raw_data jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.batteries TO anon, authenticated;
GRANT ALL ON public.batteries TO service_role;
ALTER TABLE public.batteries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read batteries" ON public.batteries FOR SELECT TO anon, authenticated USING (true);
CREATE TRIGGER trg_batteries_updated BEFORE UPDATE ON public.batteries FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ===== RENTAL SESSIONS =====
CREATE TABLE public.rental_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id text NOT NULL,
  cabinet_id text,
  selected_slot_num integer,
  state text NOT NULL DEFAULT 'created',
  amount numeric DEFAULT 2.00,
  currency text DEFAULT 'CHF',
  apifox_trade_no text,
  stripe_checkout_session_id text,
  stripe_payment_intent_id text,
  checkout_url text,
  customer_language text DEFAULT 'fr',
  error_code text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz,
  ejected_at timestamptz,
  returned_at timestamptz,
  closed_at timestamptz
);
GRANT SELECT ON public.rental_sessions TO anon, authenticated;
GRANT ALL ON public.rental_sessions TO service_role;
ALTER TABLE public.rental_sessions ENABLE ROW LEVEL SECURITY;
-- Kiosk/mobile clients read a session by its hard-to-guess uuid; writes only via service_role edge functions.
CREATE POLICY "Public read rental sessions" ON public.rental_sessions FOR SELECT TO anon, authenticated USING (true);
CREATE TRIGGER trg_rental_updated BEFORE UPDATE ON public.rental_sessions FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ===== PAYMENTS =====
CREATE TABLE public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rental_session_id uuid REFERENCES public.rental_sessions(id) ON DELETE SET NULL,
  provider text DEFAULT 'stripe',
  stripe_session_id text,
  stripe_payment_intent_id text,
  amount numeric,
  currency text DEFAULT 'CHF',
  payment_method text,
  status text DEFAULT 'pending',
  raw_webhook jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.payments TO service_role;
GRANT SELECT ON public.payments TO authenticated;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read payments" ON public.payments FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'staff'));

-- ===== APIFOX ORDERS =====
CREATE TABLE public.apifox_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rental_session_id uuid REFERENCES public.rental_sessions(id) ON DELETE SET NULL,
  trade_no text,
  request jsonb,
  response jsonb,
  status text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.apifox_orders TO service_role;
GRANT SELECT ON public.apifox_orders TO authenticated;
ALTER TABLE public.apifox_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read apifox orders" ON public.apifox_orders FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'staff'));

-- ===== CABINET EVENTS =====
CREATE TABLE public.cabinet_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id text,
  event_type text,
  severity text DEFAULT 'info',
  payload jsonb,
  received_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.cabinet_events TO service_role;
GRANT SELECT ON public.cabinet_events TO authenticated;
ALTER TABLE public.cabinet_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read events" ON public.cabinet_events FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'staff'));

-- ===== API LOGS =====
CREATE TABLE public.api_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service text,
  endpoint text,
  method text,
  status_code integer,
  request jsonb,
  response jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.api_logs TO service_role;
GRANT SELECT ON public.api_logs TO authenticated;
ALTER TABLE public.api_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read api logs" ON public.api_logs FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- ===== MAINTENANCE ACTIONS =====
CREATE TABLE public.maintenance_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id text,
  action_type text,
  params jsonb,
  result jsonb,
  performed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.maintenance_actions TO service_role;
GRANT SELECT ON public.maintenance_actions TO authenticated;
ALTER TABLE public.maintenance_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read maintenance" ON public.maintenance_actions FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- ===== WEBHOOK EVENTS (idempotency) =====
CREATE TABLE public.webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text,
  external_id text UNIQUE,
  event_type text,
  payload jsonb,
  processed boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.webhook_events TO service_role;
ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;

-- ===== KIOSK SETTINGS / PRICE PROFILES =====
CREATE TABLE public.kiosk_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE NOT NULL,
  value jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.kiosk_settings TO anon, authenticated;
GRANT ALL ON public.kiosk_settings TO service_role;
ALTER TABLE public.kiosk_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read settings" ON public.kiosk_settings FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Admins manage settings" ON public.kiosk_settings FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TABLE public.price_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  amount numeric NOT NULL DEFAULT 2.00,
  currency text DEFAULT 'CHF',
  period_label text DEFAULT 'par 30 min',
  is_default boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.price_profiles TO anon, authenticated;
GRANT ALL ON public.price_profiles TO service_role;
ALTER TABLE public.price_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read prices" ON public.price_profiles FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Admins manage prices" ON public.price_profiles FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- ===== SEED DATA =====
INSERT INTO public.stations (station_id, cabinet_id, name, location_name, status, online, signal, rentable_count, returnable_count, total_count, price_per_period)
VALUES
  ('DTA21269','DTA21269','Chargeurs.ch Station 1','Bar Le Léman, Genève','online', true, 28, 5, 3, 8, 2.00),
  ('DTA21277','DTA21277','Chargeurs.ch Station 2','Hôtel Alpina, Lausanne','online', true, 24, 6, 2, 8, 2.00),
  ('DTA22032','DTA22032','Chargeurs.ch Station 3','Restaurant Bellevue, Zürich','offline', false, 0, 0, 0, 8, 2.00);

INSERT INTO public.price_profiles (name, amount, currency, period_label, is_default)
VALUES ('Standard', 2.00, 'CHF', 'par 30 min', true);

INSERT INTO public.kiosk_settings (key, value) VALUES
  ('simulation_mode', '{"enabled": true}'::jsonb),
  ('default_language', '{"value": "fr"}'::jsonb);