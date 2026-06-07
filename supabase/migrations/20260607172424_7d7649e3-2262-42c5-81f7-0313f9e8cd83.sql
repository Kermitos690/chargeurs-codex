ALTER FUNCTION public.resolve_price_profile(text,text,text) SECURITY INVOKER;
ALTER FUNCTION public.compute_pricing(text,text,text,timestamptz,timestamptz,text,text,text) SECURITY INVOKER;
REVOKE ALL ON FUNCTION public.resolve_price_profile(text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.compute_pricing(text,text,text,timestamptz,timestamptz,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_price_profile(text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.compute_pricing(text,text,text,timestamptz,timestamptz,text,text,text) TO service_role;