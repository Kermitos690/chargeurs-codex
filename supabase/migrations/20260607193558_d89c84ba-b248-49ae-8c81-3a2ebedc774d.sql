ALTER TABLE public.cabinet_events ADD COLUMN IF NOT EXISTS external_event_id text;
CREATE UNIQUE INDEX IF NOT EXISTS cabinet_events_external_event_id_uniq
  ON public.cabinet_events (external_event_id)
  WHERE external_event_id IS NOT NULL;