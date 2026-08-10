update public.rental_sessions
set completed_at = coalesce(closed_at, settled_at, updated_at)
where state = 'completed' and completed_at is null;
