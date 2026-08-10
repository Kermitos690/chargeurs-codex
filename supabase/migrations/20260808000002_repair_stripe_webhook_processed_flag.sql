-- `processing_status` is canonical for the retry inbox, but legacy rows left
-- the compatibility boolean false after successful processing. Repair the
-- projection so operators can trace an event without mistaking it for pending.
UPDATE public.webhook_events
SET processed = true
WHERE provider = 'stripe'
  AND processing_status = 'processed'
  AND processed = false;
