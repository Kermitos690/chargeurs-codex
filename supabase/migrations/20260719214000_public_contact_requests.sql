create table if not exists public.public_contact_requests (
  id uuid primary key default gen_random_uuid(),
  request_type text not null check (request_type in ('support', 'partner_installation')),
  name text not null check (char_length(name) between 2 and 120),
  email text not null check (char_length(email) between 5 and 254),
  phone text check (phone is null or char_length(phone) <= 40),
  organization text check (organization is null or char_length(organization) <= 160),
  station_id text check (station_id is null or station_id ~ '^[A-Za-z0-9_-]{4,32}$'),
  message text not null check (char_length(message) between 10 and 4000),
  status text not null default 'new' check (status in ('new','in_progress','resolved','spam')),
  source_locale text not null default 'fr' check (source_locale in ('fr','de','it','en')),
  ip_hash text not null check (ip_hash ~ '^[0-9a-f]{64}$'),
  assigned_to uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists public_contact_requests_queue_idx
  on public.public_contact_requests(status, request_type, created_at desc);
create index if not exists public_contact_requests_rate_idx
  on public.public_contact_requests(ip_hash, created_at desc);

alter table public.public_contact_requests enable row level security;
revoke all on public.public_contact_requests from public, anon;
grant select, update on public.public_contact_requests to authenticated;
grant all on public.public_contact_requests to service_role;

create policy "authorized staff read contact requests"
on public.public_contact_requests for select to authenticated
using (public.has_any_role(auth.uid(), array['super_admin','admin','operations_admin','support_agent']));

create policy "authorized staff update contact requests"
on public.public_contact_requests for update to authenticated
using (public.has_any_role(auth.uid(), array['super_admin','admin','operations_admin','support_agent']))
with check (public.has_any_role(auth.uid(), array['super_admin','admin','operations_admin','support_agent']));

drop trigger if exists public_contact_requests_touch_updated_at on public.public_contact_requests;
create trigger public_contact_requests_touch_updated_at
before update on public.public_contact_requests
for each row execute function public.touch_updated_at();

comment on table public.public_contact_requests is
  'Server-validated public support and installation requests. IP addresses are never stored, only salted hashes for abuse control.';
