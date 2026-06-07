-- ============ INCRÉMENT 1 : modèle central Partenaires ============
CREATE TABLE public.partners (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  legal_name text NOT NULL,
  trade_name text,
  partner_type text NOT NULL DEFAULT 'company',
  address text,
  city text,
  country text DEFAULT 'CH',
  vat_number text,
  email text,
  phone text,
  manager_name text,
  billing_details jsonb,
  commission_rate numeric NOT NULL DEFAULT 0,
  billing_method text DEFAULT 'transfer',
  start_date date,
  end_date date,
  status text NOT NULL DEFAULT 'active',
  notes text,
  logo_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT partners_status_chk CHECK (status IN ('active','suspended','archived')),
  CONSTRAINT partners_commission_chk CHECK (commission_rate >= 0 AND commission_rate <= 100)
);

-- Data API grants (private back-office table — NO anon)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.partners TO authenticated;
GRANT ALL ON public.partners TO service_role;

ALTER TABLE public.partners ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage partners"
  ON public.partners FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'super_admin'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'super_admin'::app_role));

CREATE POLICY "Staff read partners"
  ON public.partners FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'super_admin'::app_role)
    OR has_role(auth.uid(),'staff'::app_role) OR has_role(auth.uid(),'operator'::app_role)
    OR has_role(auth.uid(),'viewer'::app_role)
  );

-- updated_at trigger (reuse existing touch_updated_at)
CREATE TRIGGER partners_touch_updated_at
  BEFORE UPDATE ON public.partners
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============ Relations ============
ALTER TABLE public.shops    ADD COLUMN IF NOT EXISTS partner_id uuid REFERENCES public.partners(id) ON DELETE SET NULL;
ALTER TABLE public.stations ADD COLUMN IF NOT EXISTS partner_id uuid REFERENCES public.partners(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_shops_partner    ON public.shops(partner_id);
CREATE INDEX IF NOT EXISTS idx_stations_partner ON public.stations(partner_id);
