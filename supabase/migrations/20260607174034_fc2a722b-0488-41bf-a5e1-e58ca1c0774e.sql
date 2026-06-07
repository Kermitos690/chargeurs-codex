DELETE FROM public.kiosk_devices WHERE label = 'VERIFY-TEMP';

DELETE FROM public.price_assignments
 WHERE price_profile_id IN (
   'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000002'
 );
DELETE FROM public.price_profiles
 WHERE id IN (
   'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000002'
 );