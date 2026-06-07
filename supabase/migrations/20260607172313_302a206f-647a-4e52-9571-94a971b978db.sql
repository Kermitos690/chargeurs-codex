-- ============================================================
-- Pricing engine: extend price_profiles, assignments, versions,
-- session snapshot columns, authoritative SQL functions, RLS.
-- All monetary fields are integer cents (*_cents).
-- ============================================================

-- 1. Extend price_profiles -----------------------------------
ALTER TABLE public.price_profiles
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS valid_from timestamptz,
  ADD COLUMN IF NOT EXISTS valid_to timestamptz,
  ADD COLUMN IF NOT EXISTS priority integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS updated_by uuid,
  ADD COLUMN IF NOT EXISTS initial_fee_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS included_minutes integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS period_minutes integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS price_per_period_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS grace_minutes integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS daily_cap_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_cap_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_amount_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deposit_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS late_fee_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unreturned_fee_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unreturned_after_minutes integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS min_amount_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rounding text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS tax_percent numeric NOT NULL DEFAULT 0;

-- Constraints (non-negative, valid rounding, period > 0)
ALTER TABLE public.price_profiles DROP CONSTRAINT IF EXISTS price_profiles_rounding_chk;
ALTER TABLE public.price_profiles ADD CONSTRAINT price_profiles_rounding_chk
  CHECK (rounding IN ('none','up_5','up_10'));
ALTER TABLE public.price_profiles DROP CONSTRAINT IF EXISTS price_profiles_period_chk;
ALTER TABLE public.price_profiles ADD CONSTRAINT price_profiles_period_chk
  CHECK (period_minutes > 0);
ALTER TABLE public.price_profiles DROP CONSTRAINT IF EXISTS price_profiles_nonneg_chk;
ALTER TABLE public.price_profiles ADD CONSTRAINT price_profiles_nonneg_chk
  CHECK (initial_fee_cents >= 0 AND price_per_period_cents >= 0 AND included_minutes >= 0
    AND grace_minutes >= 0 AND daily_cap_cents >= 0 AND total_cap_cents >= 0
    AND max_amount_cents >= 0 AND deposit_cents >= 0 AND late_fee_cents >= 0
    AND unreturned_fee_cents >= 0 AND unreturned_after_minutes >= 0
    AND min_amount_cents >= 0 AND tax_percent >= 0);

-- Migrate legacy numeric amount -> price_per_period_cents, drop hidden default
ALTER TABLE public.price_profiles ALTER COLUMN amount DROP DEFAULT;
UPDATE public.price_profiles
  SET price_per_period_cents = ROUND(amount * 100)::int
  WHERE price_per_period_cents = 0 AND amount IS NOT NULL;

-- 2. price_profile_versions (immutable history) --------------
CREATE TABLE IF NOT EXISTS public.price_profile_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  price_profile_id uuid NOT NULL REFERENCES public.price_profiles(id) ON DELETE CASCADE,
  version integer NOT NULL,
  snapshot jsonb NOT NULL,
  changed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.price_profile_versions TO authenticated;
GRANT ALL ON public.price_profile_versions TO service_role;
ALTER TABLE public.price_profile_versions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins read price versions" ON public.price_profile_versions;
CREATE POLICY "Admins read price versions" ON public.price_profile_versions
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin')
      OR public.has_role(auth.uid(),'operator') OR public.has_role(auth.uid(),'viewer'));

-- 3. price_assignments ---------------------------------------
CREATE TABLE IF NOT EXISTS public.price_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL CHECK (scope IN ('device','station','shop')),
  scope_ref text NOT NULL,
  price_profile_id uuid NOT NULL REFERENCES public.price_profiles(id) ON DELETE CASCADE,
  active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS price_assignments_scope_active_uidx
  ON public.price_assignments(scope, scope_ref) WHERE active;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.price_assignments TO authenticated;
GRANT ALL ON public.price_assignments TO service_role;
ALTER TABLE public.price_assignments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Staff read assignments" ON public.price_assignments;
CREATE POLICY "Staff read assignments" ON public.price_assignments
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin')
      OR public.has_role(auth.uid(),'operator') OR public.has_role(auth.uid(),'viewer'));
DROP POLICY IF EXISTS "Admins manage assignments" ON public.price_assignments;
CREATE POLICY "Admins manage assignments" ON public.price_assignments
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));
DROP TRIGGER IF EXISTS trg_price_assignments_touch ON public.price_assignments;
CREATE TRIGGER trg_price_assignments_touch BEFORE UPDATE ON public.price_assignments
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 4. rental_sessions snapshot columns ------------------------
ALTER TABLE public.rental_sessions
  ADD COLUMN IF NOT EXISTS pricing_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS price_profile_version integer,
  ADD COLUMN IF NOT EXISTS pricing_snapshot_hash text,
  ADD COLUMN IF NOT EXISTS kiosk_device_id text;

-- 5. RLS hardening on price_profiles -------------------------
DROP POLICY IF EXISTS "Public read prices" ON public.price_profiles;
DROP POLICY IF EXISTS "Staff read prices" ON public.price_profiles;
CREATE POLICY "Staff read prices" ON public.price_profiles
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin')
      OR public.has_role(auth.uid(),'operator') OR public.has_role(auth.uid(),'viewer'));
DROP POLICY IF EXISTS "Admins manage prices" ON public.price_profiles;
CREATE POLICY "Admins manage prices" ON public.price_profiles
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));

-- 6. version history trigger ---------------------------------
CREATE OR REPLACE FUNCTION public.price_profile_version_snapshot()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.version := COALESCE(OLD.version,1) + 1;
    NEW.updated_at := now();
  END IF;
  INSERT INTO public.price_profile_versions(price_profile_id, version, snapshot, changed_by)
  VALUES (NEW.id, NEW.version, to_jsonb(NEW), NEW.updated_by);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_price_profile_version ON public.price_profiles;
CREATE TRIGGER trg_price_profile_version
  AFTER INSERT OR UPDATE ON public.price_profiles
  FOR EACH ROW EXECUTE FUNCTION public.price_profile_version_snapshot();

-- 7. resolve_price_profile (authoritative priority) ----------
CREATE OR REPLACE FUNCTION public.resolve_price_profile(p_device text, p_station text, p_shop text)
RETURNS TABLE(profile_id uuid, source text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_shop text;
BEGIN
  IF p_device IS NOT NULL THEN
    SELECT pa.price_profile_id INTO v_id FROM price_assignments pa
      JOIN price_profiles pp ON pp.id = pa.price_profile_id
      WHERE pa.active AND pa.scope='device' AND pa.scope_ref=p_device AND pp.active
        AND (pp.valid_from IS NULL OR pp.valid_from <= now())
        AND (pp.valid_to IS NULL OR pp.valid_to >= now())
      ORDER BY pp.priority DESC LIMIT 1;
    IF v_id IS NOT NULL THEN profile_id:=v_id; source:='device'; RETURN NEXT; RETURN; END IF;
  END IF;
  IF p_station IS NOT NULL THEN
    SELECT pa.price_profile_id INTO v_id FROM price_assignments pa
      JOIN price_profiles pp ON pp.id = pa.price_profile_id
      WHERE pa.active AND pa.scope='station' AND pa.scope_ref=p_station AND pp.active
        AND (pp.valid_from IS NULL OR pp.valid_from <= now())
        AND (pp.valid_to IS NULL OR pp.valid_to >= now())
      ORDER BY pp.priority DESC LIMIT 1;
    IF v_id IS NOT NULL THEN profile_id:=v_id; source:='station'; RETURN NEXT; RETURN; END IF;
  END IF;
  v_shop := p_shop;
  IF v_shop IS NULL AND p_station IS NOT NULL THEN
    SELECT shop_id INTO v_shop FROM stations WHERE station_id=p_station;
  END IF;
  IF v_shop IS NOT NULL THEN
    SELECT pa.price_profile_id INTO v_id FROM price_assignments pa
      JOIN price_profiles pp ON pp.id = pa.price_profile_id
      WHERE pa.active AND pa.scope='shop' AND pa.scope_ref=v_shop AND pp.active
        AND (pp.valid_from IS NULL OR pp.valid_from <= now())
        AND (pp.valid_to IS NULL OR pp.valid_to >= now())
      ORDER BY pp.priority DESC LIMIT 1;
    IF v_id IS NOT NULL THEN profile_id:=v_id; source:='shop'; RETURN NEXT; RETURN; END IF;
  END IF;
  SELECT id INTO v_id FROM price_profiles
    WHERE is_default AND active
      AND (valid_from IS NULL OR valid_from <= now())
      AND (valid_to IS NULL OR valid_to >= now())
    ORDER BY priority DESC LIMIT 1;
  IF v_id IS NOT NULL THEN profile_id:=v_id; source:='default'; RETURN NEXT; RETURN; END IF;
  RETURN;
END $$;

-- 8. compute_pricing (single authoritative calculator) -------
CREATE OR REPLACE FUNCTION public.compute_pricing(
  p_device text, p_station text, p_shop text,
  p_start timestamptz, p_end timestamptz,
  p_rental_state text, p_return_state text, p_currency text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r record; pp price_profiles%ROWTYPE;
  v_start timestamptz := COALESCE(p_start, now());
  v_total_min int; v_billable_min int; v_periods int;
  v_initial int; v_duration int; v_fees int := 0;
  v_subtotal int; v_capped int; v_caps jsonb := '[]'::jsonb;
  v_days int; v_tax int; v_final int; v_currency text;
BEGIN
  SELECT * INTO r FROM resolve_price_profile(p_device, p_station, p_shop);
  IF r.profile_id IS NULL THEN
    RAISE EXCEPTION 'PRICING_NOT_CONFIGURED';
  END IF;
  SELECT * INTO pp FROM price_profiles WHERE id = r.profile_id;
  v_currency := COALESCE(pp.currency,'CHF');
  IF p_currency IS NOT NULL AND upper(p_currency) <> upper(v_currency) THEN
    RAISE EXCEPTION 'CURRENCY_MISMATCH';
  END IF;

  IF p_end IS NULL THEN
    -- Upfront kiosk charge: initial + one prepaid period.
    v_total_min := 0;
    v_periods := CASE WHEN pp.price_per_period_cents > 0 THEN 1 ELSE 0 END;
  ELSE
    v_total_min := GREATEST(0, CEIL(EXTRACT(EPOCH FROM (p_end - v_start)) / 60.0)::int);
    IF v_total_min <= pp.included_minutes + pp.grace_minutes THEN
      v_billable_min := 0;
    ELSE
      v_billable_min := v_total_min - pp.included_minutes;
    END IF;
    v_periods := CASE WHEN v_billable_min > 0 THEN CEIL(v_billable_min::numeric / pp.period_minutes)::int ELSE 0 END;
  END IF;

  v_initial := pp.initial_fee_cents;
  v_duration := v_periods * pp.price_per_period_cents;

  IF p_return_state = 'late' THEN v_fees := v_fees + pp.late_fee_cents; END IF;
  IF p_return_state = 'not_returned'
     OR (pp.unreturned_after_minutes > 0 AND v_total_min > pp.unreturned_after_minutes) THEN
    v_fees := v_fees + pp.unreturned_fee_cents;
  END IF;

  v_subtotal := v_initial + v_duration + v_fees;
  v_capped := v_subtotal;

  IF pp.daily_cap_cents > 0 THEN
    v_days := GREATEST(1, CEIL(v_total_min::numeric / 1440)::int);
    IF v_capped > pp.daily_cap_cents * v_days THEN
      v_capped := pp.daily_cap_cents * v_days;
      v_caps := v_caps || jsonb_build_object('type','daily','value',pp.daily_cap_cents * v_days);
    END IF;
  END IF;
  IF pp.total_cap_cents > 0 AND v_capped > pp.total_cap_cents THEN
    v_capped := pp.total_cap_cents;
    v_caps := v_caps || jsonb_build_object('type','total','value',pp.total_cap_cents);
  END IF;
  IF pp.max_amount_cents > 0 AND v_capped > pp.max_amount_cents THEN
    v_capped := pp.max_amount_cents;
    v_caps := v_caps || jsonb_build_object('type','max','value',pp.max_amount_cents);
  END IF;
  IF pp.min_amount_cents > 0 AND v_capped < pp.min_amount_cents THEN
    v_capped := pp.min_amount_cents;
    v_caps := v_caps || jsonb_build_object('type','min','value',pp.min_amount_cents);
  END IF;

  IF pp.rounding = 'up_5' THEN v_capped := CEIL(v_capped::numeric/5)*5;
  ELSIF pp.rounding = 'up_10' THEN v_capped := CEIL(v_capped::numeric/10)*10; END IF;

  v_tax := ROUND(v_capped * pp.tax_percent / 100.0)::int;
  v_final := v_capped + v_tax;

  RETURN jsonb_build_object(
    'profile_id', pp.id,
    'profile_name', pp.name,
    'profile_version', pp.version,
    'source', r.source,
    'currency', v_currency,
    'start', v_start,
    'end', p_end,
    'rental_state', p_rental_state,
    'return_state', p_return_state,
    'total_minutes', v_total_min,
    'billed_periods', v_periods,
    'period_minutes', pp.period_minutes,
    'initial_fee_cents', v_initial,
    'duration_cents', v_duration,
    'additional_fees_cents', v_fees,
    'subtotal_cents', v_subtotal,
    'caps_applied', v_caps,
    'tax_percent', pp.tax_percent,
    'tax_cents', v_tax,
    'final_cents', v_final,
    'amount', ROUND(v_final::numeric/100, 2),
    'deposit_cents', pp.deposit_cents,
    'computed_at', now()
  );
END $$;

-- 9. effective_price (kiosk-safe, single station only) -------
CREATE OR REPLACE FUNCTION public.effective_price(p_station text, p_device text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_shop text;
BEGIN
  SELECT shop_id INTO v_shop FROM stations WHERE station_id = p_station;
  RETURN public.compute_pricing(p_device, p_station, v_shop, now(), NULL, 'quote', 'normal', NULL);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('error', SQLERRM);
END $$;

GRANT EXECUTE ON FUNCTION public.effective_price(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_price_profile(text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.compute_pricing(text,text,text,timestamptz,timestamptz,text,text,text) TO authenticated, service_role;