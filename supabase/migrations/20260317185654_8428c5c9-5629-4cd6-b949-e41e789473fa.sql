
-- Trigger function: reset inactivity reminder flags when book is edited
CREATE OR REPLACE FUNCTION public.reset_inactivity_flags()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Only reset if last_edited actually changed (user activity)
  IF NEW.last_edited IS DISTINCT FROM OLD.last_edited THEN
    NEW.inactivity_reminded_60d = false;
    NEW.inactivity_reminded_75d = false;
    NEW.inactivity_reminded_90d = false;
    NEW.inactivity_reminded_105d = false;
    NEW.inactivity_reminded_115d = false;
  END IF;
  RETURN NEW;
END;
$$;

-- Attach trigger to books table
CREATE TRIGGER reset_book_inactivity_flags
  BEFORE UPDATE ON public.books
  FOR EACH ROW
  EXECUTE FUNCTION public.reset_inactivity_flags();

-- Enable pg_cron and pg_net extensions for scheduled jobs
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
