ALTER TABLE public.books
  ADD COLUMN IF NOT EXISTS print_tier text,
  ADD COLUMN IF NOT EXISTS target_page_count integer;