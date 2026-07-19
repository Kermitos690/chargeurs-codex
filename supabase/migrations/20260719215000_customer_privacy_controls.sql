alter table public.profiles
  add column if not exists marketing_consent boolean not null default false,
  add column if not exists terms_accepted_at timestamptz,
  add column if not exists privacy_acknowledged_at timestamptz,
  add column if not exists deletion_requested_at timestamptz;

comment on column public.profiles.marketing_consent is
  'Optional consent, false by default and editable by the customer.';
comment on column public.profiles.deletion_requested_at is
  'Set while an account deletion is checked; active/unsettled rentals block deletion.';
