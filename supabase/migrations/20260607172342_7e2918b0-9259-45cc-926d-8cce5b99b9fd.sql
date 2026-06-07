-- Remove default PUBLIC execute and restrict to intended callers.
REVOKE ALL ON FUNCTION public.resolve_price_profile(text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.compute_pricing(text,text,text,timestamptz,timestamptz,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.effective_price(text,text) FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION public.resolve_price_profile(text,text,text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.compute_pricing(text,text,text,timestamptz,timestamptz,text,text,text) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.resolve_price_profile(text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.compute_pricing(text,text,text,timestamptz,timestamptz,text,text,text) TO service_role;

-- effective_price: kiosk needs it (anon kiosk tablets) — intentional public read of a SINGLE station quote only.
GRANT EXECUTE ON FUNCTION public.effective_price(text,text) TO anon, authenticated, service_role;