GRANT EXECUTE ON FUNCTION public.effective_price(text,text) TO supabase_read_only_user;
GRANT EXECUTE ON FUNCTION public.compute_pricing(text,text,text,timestamptz,timestamptz,text,text,text) TO supabase_read_only_user;
GRANT EXECUTE ON FUNCTION public.resolve_price_profile(text,text,text) TO supabase_read_only_user;