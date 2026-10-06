
-- Add inactivity reminder flags (Del 8 timeline: day 60, 75, 90, 105, 115)
ALTER TABLE public.books 
  ADD COLUMN IF NOT EXISTS inactivity_reminded_60d boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS inactivity_reminded_75d boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS inactivity_reminded_90d boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS inactivity_reminded_105d boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS inactivity_reminded_115d boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_deleted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS deleted_at timestamp with time zone;

-- Create backup table for deleted books (30-day recovery window)
CREATE TABLE public.deleted_books_backup (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  original_book_id uuid NOT NULL,
  user_id uuid NOT NULL,
  title text NOT NULL,
  book_data jsonb NOT NULL,
  deleted_at timestamp with time zone NOT NULL DEFAULT now(),
  backup_expires_at timestamp with time zone NOT NULL DEFAULT (now() + interval '30 days'),
  restored boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.deleted_books_backup ENABLE ROW LEVEL SECURITY;

-- Only admins can view/manage backups (recovery via support request)
CREATE POLICY "Admins can view deleted book backups"
  ON public.deleted_books_backup
  FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can insert deleted book backups"
  ON public.deleted_books_backup
  FOR INSERT
  TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update deleted book backups"
  ON public.deleted_books_backup
  FOR UPDATE
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));
