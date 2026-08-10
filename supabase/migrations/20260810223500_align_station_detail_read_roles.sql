drop policy if exists "Admins read events" on public.cabinet_events;
create policy "operations read cabinet events"
on public.cabinet_events
for select
to authenticated
using (
  public.has_any_role(
    auth.uid(),
    array['super_admin','admin','operations_admin','support_agent','maintenance_technician','staff','operator','viewer']::text[]
  )
);

drop policy if exists "Staff can read rental sessions" on public.rental_sessions;
create policy "internal staff read rental sessions"
on public.rental_sessions
for select
to authenticated
using (
  public.has_any_role(
    auth.uid(),
    array['super_admin','admin','operations_admin','finance_admin','support_agent','maintenance_technician','staff','operator','viewer']::text[]
  )
);
