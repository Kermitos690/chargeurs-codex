-- Make the service-role-only Apple Wallet registration table explicitly deny
-- every browser role, even though table privileges are already revoked.

create policy "wallet device registrations deny anon"
on public.customer_wallet_device_registrations
as restrictive
for all
to anon
using (false)
with check (false);

create policy "wallet device registrations deny authenticated"
on public.customer_wallet_device_registrations
as restrictive
for all
to authenticated
using (false)
with check (false);

-- Existing customer_wallet_passes has a membership FK used by Wallet flows.
-- Add the missing covering index without changing business behavior.
create index if not exists customer_wallet_passes_membership_idx
  on public.customer_wallet_passes(membership_id);
