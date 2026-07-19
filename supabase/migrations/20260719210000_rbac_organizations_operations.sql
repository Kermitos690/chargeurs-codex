-- Consolidated production roles and organization-scoped access.
-- New enum values are compared through role::text in this migration so the
-- migration remains valid when Supabase applies it in a single transaction.

alter type public.app_role add value if not exists 'operations_admin';
alter type public.app_role add value if not exists 'finance_admin';
alter type public.app_role add value if not exists 'support_agent';
alter type public.app_role add value if not exists 'maintenance_technician';
alter type public.app_role add value if not exists 'partner_owner';
alter type public.app_role add value if not exists 'partner_staff';
alter type public.app_role add value if not exists 'api_client';

create or replace function public.has_role_name(_user_id uuid, _role text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _user_id and role::text = _role
  )
$$;

create or replace function public.has_any_role(_user_id uuid, _roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _user_id and role::text = any(_roles)
  )
$$;

revoke all on function public.has_role_name(uuid, text) from public, anon;
revoke all on function public.has_any_role(uuid, text[]) from public, anon;
grant execute on function public.has_role_name(uuid, text) to authenticated, service_role;
grant execute on function public.has_any_role(uuid, text[]) to authenticated, service_role;

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{2,62}$'),
  legal_name text not null,
  kind text not null default 'partner' check (kind in ('platform', 'partner', 'establishment')),
  status text not null default 'active' check (status in ('active', 'suspended', 'archived')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.organization_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (organization_id, user_id, role),
  constraint organization_memberships_partner_role check (
    role::text in ('partner_owner', 'partner_staff')
  )
);

create index if not exists organization_memberships_user_idx
  on public.organization_memberships(user_id, organization_id);

alter table public.partners
  add column if not exists organization_id uuid references public.organizations(id) on delete restrict;
create unique index if not exists partners_organization_key
  on public.partners(organization_id) where organization_id is not null;

insert into public.organizations (slug, legal_name, kind, status, metadata)
select
  'partner-' || replace(p.id::text, '-', ''),
  p.legal_name,
  'partner',
  case when p.status in ('active', 'suspended', 'archived') then p.status else 'active' end,
  jsonb_build_object('legacy_partner_id', p.id::text)
from public.partners p
where p.organization_id is null
on conflict (slug) do nothing;

update public.partners p
set organization_id = o.id
from public.organizations o
where p.organization_id is null
  and o.metadata ->> 'legacy_partner_id' = p.id::text;

alter table public.organizations enable row level security;
alter table public.organization_memberships enable row level security;
grant select on public.organizations, public.organization_memberships to authenticated;
grant all on public.organizations, public.organization_memberships to service_role;

drop policy if exists "internal staff manage organizations" on public.organizations;
create policy "internal staff manage organizations"
on public.organizations for all to authenticated
using (public.has_any_role(auth.uid(), array['super_admin','admin','operations_admin']))
with check (public.has_any_role(auth.uid(), array['super_admin','admin','operations_admin']));

drop policy if exists "members read own organization" on public.organizations;
create policy "members read own organization"
on public.organizations for select to authenticated
using (
  exists (
    select 1 from public.organization_memberships membership
    where membership.organization_id = organizations.id
      and membership.user_id = auth.uid()
  )
);

drop policy if exists "internal staff manage memberships" on public.organization_memberships;
create policy "internal staff manage memberships"
on public.organization_memberships for all to authenticated
using (public.has_any_role(auth.uid(), array['super_admin','admin','operations_admin']))
with check (public.has_any_role(auth.uid(), array['super_admin','admin','operations_admin']));

drop policy if exists "members read own membership" on public.organization_memberships;
create policy "members read own membership"
on public.organization_memberships for select to authenticated
using (user_id = auth.uid());

drop trigger if exists organizations_touch_updated_at on public.organizations;
create trigger organizations_touch_updated_at
before update on public.organizations
for each row execute function public.touch_updated_at();

-- Replace the historical all-partners staff policy with explicit global roles
-- and organization membership. Partner users can never enumerate peers.
drop policy if exists "Admins manage partners" on public.partners;
drop policy if exists "Staff read partners" on public.partners;
drop policy if exists "platform operators manage partners" on public.partners;
create policy "platform operators manage partners"
on public.partners for all to authenticated
using (public.has_any_role(auth.uid(), array['super_admin','admin','operations_admin']))
with check (public.has_any_role(auth.uid(), array['super_admin','admin','operations_admin']));

drop policy if exists "authorized staff read partners" on public.partners;
create policy "authorized staff read partners"
on public.partners for select to authenticated
using (
  public.has_any_role(
    auth.uid(),
    array['super_admin','admin','operations_admin','finance_admin','support_agent','maintenance_technician']
  )
  or exists (
    select 1 from public.organization_memberships membership
    where membership.organization_id = partners.organization_id
      and membership.user_id = auth.uid()
  )
);

drop policy if exists "partner members read own shops" on public.shops;
create policy "partner members read own shops"
on public.shops for select to authenticated
using (
  partner_id in (
    select partner.id
    from public.partners partner
    join public.organization_memberships membership
      on membership.organization_id = partner.organization_id
    where membership.user_id = auth.uid()
  )
);

-- Operational tables requested for production support. They remain private by
-- default and all mutations flow through service-role Edge Functions or the
-- narrowly scoped internal policies below.
create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  rental_session_id uuid unique references public.rental_sessions(id) on delete set null,
  customer_id uuid references auth.users(id) on delete set null,
  invoice_number text unique,
  status text not null default 'draft' check (status in ('draft','issued','paid','void','refunded')),
  subtotal_cents integer not null default 0 check (subtotal_cents >= 0),
  tax_cents integer not null default 0 check (tax_cents >= 0),
  total_cents integer not null default 0 check (total_cents >= 0),
  currency text not null default 'CHF' check (currency ~ '^[A-Z]{3}$'),
  issued_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.maintenance_tasks (
  id uuid primary key default gen_random_uuid(),
  station_id text references public.stations(station_id) on delete set null,
  incident_id uuid references public.system_incidents(id) on delete set null,
  title text not null,
  description text,
  severity text not null default 'medium' check (severity in ('low','medium','high','critical')),
  status text not null default 'open' check (status in ('open','assigned','in_progress','resolved','cancelled')),
  assigned_to uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  due_at timestamptz,
  resolved_at timestamptz,
  resolution text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists maintenance_tasks_station_status_idx
  on public.maintenance_tasks(station_id, status, created_at desc);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  channel text not null default 'in_app' check (channel in ('in_app','email','sms','webhook')),
  type text not null,
  title text not null,
  body text,
  data jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending','sent','failed','read')),
  idempotency_key text unique,
  sent_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_created_idx
  on public.notifications(user_id, created_at desc);

create table if not exists public.app_settings (
  key text primary key check (key ~ '^[a-z0-9_.-]{3,100}$'),
  value jsonb not null,
  public boolean not null default false,
  description text,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.system_incidents
  add column if not exists rental_session_id uuid references public.rental_sessions(id) on delete set null,
  add column if not exists station_id text references public.stations(station_id) on delete set null,
  add column if not exists assigned_to uuid references auth.users(id) on delete set null,
  add column if not exists resolved_at timestamptz,
  add column if not exists resolution text;

create index if not exists system_incidents_station_resolved_idx
  on public.system_incidents(station_id, resolved, created_at desc);
create index if not exists system_incidents_api_list_idx
  on public.system_incidents(resolved, severity, type, created_at desc);

alter table public.invoices enable row level security;
alter table public.maintenance_tasks enable row level security;
alter table public.notifications enable row level security;
alter table public.app_settings enable row level security;

grant select on public.invoices, public.maintenance_tasks, public.notifications, public.app_settings to authenticated;
grant update(status, read_at) on public.notifications to authenticated;
grant all on public.invoices, public.maintenance_tasks, public.notifications, public.app_settings to service_role;

create policy "finance staff read invoices" on public.invoices for select to authenticated
using (
  customer_id = auth.uid()
  or public.has_any_role(auth.uid(), array['super_admin','admin','finance_admin','support_agent'])
);

create policy "operations manage maintenance tasks" on public.maintenance_tasks for all to authenticated
using (public.has_any_role(auth.uid(), array['super_admin','admin','operations_admin','maintenance_technician']))
with check (public.has_any_role(auth.uid(), array['super_admin','admin','operations_admin','maintenance_technician']));

create policy "support reads maintenance tasks" on public.maintenance_tasks for select to authenticated
using (public.has_role_name(auth.uid(), 'support_agent'));

create policy "users read own notifications" on public.notifications for select to authenticated
using (user_id = auth.uid());
create policy "users mark own notifications read" on public.notifications for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid() and status = 'read');

create policy "internal staff read app settings" on public.app_settings for select to authenticated
using (public.has_any_role(auth.uid(), array['super_admin','admin','operations_admin','finance_admin','support_agent','maintenance_technician']));
create policy "super admins manage app settings" on public.app_settings for all to authenticated
using (public.has_any_role(auth.uid(), array['super_admin','admin']))
with check (public.has_any_role(auth.uid(), array['super_admin','admin']));

create policy "finance staff read payments" on public.payments for select to authenticated
using (public.has_any_role(auth.uid(), array['super_admin','admin','finance_admin','support_agent']));
create policy "finance staff read refunds" on public.refunds for select to authenticated
using (public.has_any_role(auth.uid(), array['super_admin','admin','finance_admin','support_agent']));
create policy "operations read incidents" on public.system_incidents for select to authenticated
using (public.has_any_role(auth.uid(), array['super_admin','admin','operations_admin','support_agent','maintenance_technician']));

drop trigger if exists invoices_touch_updated_at on public.invoices;
create trigger invoices_touch_updated_at before update on public.invoices
for each row execute function public.touch_updated_at();
drop trigger if exists maintenance_tasks_touch_updated_at on public.maintenance_tasks;
create trigger maintenance_tasks_touch_updated_at before update on public.maintenance_tasks
for each row execute function public.touch_updated_at();

-- Compatibility name for integrations while keeping `slots` as the only
-- writable source of truth.
create or replace view public.station_slots
with (security_invoker = true)
as select id, station_id, slot_num, status, battery_id, updated_at from public.slots;
grant select on public.station_slots to authenticated;

comment on table public.organization_memberships is
  'Organization-scoped partner access; mutations require an internal operator or service role.';
comment on view public.station_slots is
  'Read-only compatibility view; public.slots remains the canonical table.';
