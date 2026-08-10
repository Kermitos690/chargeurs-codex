drop policy if exists "Admins can read api_coverage" on public.api_coverage;

create policy "operations read api_coverage"
on public.api_coverage
for select
to authenticated
using (
  public.has_any_role(
    auth.uid(),
    array['super_admin','admin','operations_admin','operator']::text[]
  )
);
