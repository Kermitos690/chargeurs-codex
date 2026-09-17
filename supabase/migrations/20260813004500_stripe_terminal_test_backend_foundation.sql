-- Stripe Terminal TEST backend foundation.
-- Adds server-owned station bindings, per-rental payment-rail claims and Terminal attempt correlation.
-- No pricing, ejection, return or settlement semantics are changed.

create table if not exists public.stripe_terminal_station_bindings (
  station_id text primary key references public.stations(id) on delete cascade,
  stripe_location_id text not null,
  stripe_reader_id text,
  environment text not null default 'test' check (environment in ('test','live')),
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.rental_payment_rail_claims (
  rental_session_id uuid primary key references public.rental_sessions(id) on delete cascade,
  rail text not null check (rail in ('qr_checkout','stripe_terminal')),
  claimed_at timestamptz not null default now(),
  correlation_id uuid,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.stripe_terminal_payment_attempts (
  id uuid primary key default gen_random_uuid(),
  rental_session_id uuid not null unique references public.rental_sessions(id) on delete cascade,
  station_id text not null references public.stations(id) on delete restrict,
  kiosk_device_id uuid,
  stripe_payment_intent_id text unique,
  stripe_location_id text not null,
  stripe_reader_id text,
  amount_cents integer not null check (amount_cents > 0),
  currency text not null default 'chf',
  status text not null default 'creating' check (status in ('creating','requires_payment_method','requires_confirmation','requires_action','processing','requires_capture','succeeded','canceled','failed')),
  idempotency_key text not null unique,
  correlation_id uuid,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists stripe_terminal_attempts_station_idx
  on public.stripe_terminal_payment_attempts(station_id, created_at desc);
create index if not exists stripe_terminal_attempts_reader_idx
  on public.stripe_terminal_payment_attempts(stripe_reader_id, created_at desc)
  where stripe_reader_id is not null;

alter table public.stripe_terminal_station_bindings enable row level security;
alter table public.rental_payment_rail_claims enable row level security;
alter table public.stripe_terminal_payment_attempts enable row level security;

revoke all on public.stripe_terminal_station_bindings from anon, authenticated;
revoke all on public.rental_payment_rail_claims from anon, authenticated;
revoke all on public.stripe_terminal_payment_attempts from anon, authenticated;
grant all on public.stripe_terminal_station_bindings to service_role;
grant all on public.rental_payment_rail_claims to service_role;
grant all on public.stripe_terminal_payment_attempts to service_role;

create or replace function public.claim_rental_payment_rail(
  p_rental_id uuid,
  p_rail text,
  p_correlation_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.rental_payment_rail_claims%rowtype;
  v_checkout_id text;
begin
  if p_rail not in ('qr_checkout','stripe_terminal') then
    raise exception 'PAYMENT_RAIL_INVALID';
  end if;

  -- Serialize rail selection on the canonical rental row.
  select stripe_checkout_session_id into v_checkout_id
  from public.rental_sessions
  where id = p_rental_id
  for update;

  if not found then
    raise exception 'RENTAL_NOT_FOUND';
  end if;

  select * into v_existing
  from public.rental_payment_rail_claims
  where rental_session_id = p_rental_id;

  if found then
    if v_existing.rail <> p_rail then
      raise exception 'PAYMENT_RAIL_ALREADY_CLAIMED:%', v_existing.rail;
    end if;
    return v_existing.rail;
  end if;

  -- Existing QR Checkout created before this migration remains authoritative.
  if p_rail = 'stripe_terminal' and coalesce(v_checkout_id, '') <> '' then
    raise exception 'PAYMENT_RAIL_ALREADY_CLAIMED:qr_checkout';
  end if;

  insert into public.rental_payment_rail_claims(rental_session_id, rail, correlation_id, metadata)
  values (p_rental_id, p_rail, p_correlation_id, coalesce(p_metadata, '{}'::jsonb));

  return p_rail;
end;
$$;

revoke all on function public.claim_rental_payment_rail(uuid,text,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.claim_rental_payment_rail(uuid,text,uuid,jsonb) to service_role;

comment on table public.stripe_terminal_station_bindings is 'Server-owned Stripe Terminal station -> Location/reader binding. TEST disabled by default.';
comment on table public.rental_payment_rail_claims is 'Atomic first-payment-rail claim. QR Checkout and Stripe Terminal are mutually exclusive per rental attempt.';
comment on table public.stripe_terminal_payment_attempts is 'TEST Terminal PaymentIntent correlation: rentalSession <-> PaymentIntent <-> station <-> Stripe Location/reader.';