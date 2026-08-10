-- Full platform role catalogue. Additive only: roles without an explicit RLS
-- policy remain fail-closed. This migration does not grant cross-organization
-- access and does not create any user.

alter type public.app_role add value if not exists 'platform_admin';
alter type public.app_role add value if not exists 'support_manager';
alter type public.app_role add value if not exists 'maintenance_manager';
alter type public.app_role add value if not exists 'powerbank_manager';
alter type public.app_role add value if not exists 'mifi_manager';
alter type public.app_role add value if not exists 'advertising_manager';
alter type public.app_role add value if not exists 'reports_analyst';
alter type public.app_role add value if not exists 'franchise_owner';
alter type public.app_role add value if not exists 'franchise_admin';
alter type public.app_role add value if not exists 'franchise_staff';
alter type public.app_role add value if not exists 'agency_owner';
alter type public.app_role add value if not exists 'agency_admin';
alter type public.app_role add value if not exists 'agency_staff';
alter type public.app_role add value if not exists 'venue_manager';
alter type public.app_role add value if not exists 'venue_staff';
alter type public.app_role add value if not exists 'vip_customer';

alter table public.organization_memberships
  drop constraint if exists organization_memberships_partner_role;
alter table public.organization_memberships
  drop constraint if exists organization_memberships_allowed_role;
alter table public.organization_memberships
  add constraint organization_memberships_allowed_role check (
    role::text in (
      'super_admin', 'admin', 'platform_admin', 'operations_admin',
      'finance_admin', 'support_manager', 'support_agent',
      'maintenance_manager', 'maintenance_technician', 'powerbank_manager',
      'mifi_manager', 'advertising_manager', 'reports_analyst',
      'franchise_owner', 'franchise_admin', 'franchise_staff',
      'agency_owner', 'agency_admin', 'agency_staff',
      'partner_owner', 'partner_staff', 'venue_manager', 'venue_staff',
      'viewer', 'operator', 'staff'
    )
  );

-- Historical policies only recognised `admin`. Super-admins must not lose
-- observability merely because their role is more restrictive by name.
drop policy if exists "Admins read all roles" on public.user_roles;
create policy "Platform admins read all roles"
  on public.user_roles for select to authenticated
  using (
    public.has_role(auth.uid(), 'admin')
    or public.has_role(auth.uid(), 'super_admin')
  );

drop policy if exists "Admins read api logs" on public.api_logs;
create policy "Platform admins read api logs"
  on public.api_logs for select to authenticated
  using (
    public.has_role(auth.uid(), 'admin')
    or public.has_role(auth.uid(), 'super_admin')
  );

comment on type public.app_role is
  'Chargeurs.ch role matrix. RLS policies remain the authority; unlisted roles are fail-closed.';
