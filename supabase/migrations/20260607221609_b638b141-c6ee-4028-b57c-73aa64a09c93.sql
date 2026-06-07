CREATE TABLE public.test_runs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  endpoint_code text NOT NULL,
  endpoint_name text,
  level text NOT NULL CHECK (level IN ('A','B','C')),
  verdict text NOT NULL CHECK (verdict IN ('mock_verified','live_verified','physical_test_required','blocked_by_safety','failed','pending')),
  environment text NOT NULL DEFAULT 'staging',
  cabinet_id text,
  correlation_id text,
  request_redacted jsonb,
  response_redacted jsonb,
  status_code integer,
  duration_ms integer,
  physical_test_required boolean NOT NULL DEFAULT true,
  error text,
  performed_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT ON public.test_runs TO authenticated;
GRANT ALL ON public.test_runs TO service_role;

ALTER TABLE public.test_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read test runs"
ON public.test_runs FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

CREATE INDEX idx_test_runs_endpoint ON public.test_runs (endpoint_code, created_at DESC);