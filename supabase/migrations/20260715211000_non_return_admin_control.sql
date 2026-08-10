-- Explicit, audited non-return administration.
--
-- No automatic non-return deadline is introduced. A super administrator must
-- make the decision, and retries reuse the original declaration timestamp.

alter table public.rental_sessions
  add column if not exists non_return_declared_at timestamptz,
  add column if not exists non_return_declared_by uuid;

create index if not exists rental_sessions_non_return_declared_idx
  on public.rental_sessions(non_return_declared_at)
  where non_return_declared_at is not null;

comment on column public.rental_sessions.non_return_declared_at is
  'Timestamp of an explicit super-admin non-return decision; never populated by an invented automatic deadline.';
comment on column public.rental_sessions.non_return_declared_by is
  'Authenticated user who explicitly declared the non-return.';
