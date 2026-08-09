select to_regclass('public.local_gateway_observations') is not null as observation_table_ready,
       to_regprocedure('public.self_enroll_staging_kiosk(text,text,uuid,text)') is not null as self_enrollment_ready;
