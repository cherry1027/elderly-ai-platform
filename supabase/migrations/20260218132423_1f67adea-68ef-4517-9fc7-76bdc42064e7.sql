
-- Table for interview conversation turns
CREATE TABLE public.interview_turns (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  book_id UUID NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  theme_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  question_text TEXT NOT NULL,
  user_answer TEXT NOT NULL,
  minna_response TEXT,
  conversation_history JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_interview_turns_book ON public.interview_turns(book_id);
CREATE INDEX idx_interview_turns_theme ON public.interview_turns(theme_id);

-- RLS
ALTER TABLE public.interview_turns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert their own interview turns"
ON public.interview_turns FOR INSERT
WITH CHECK (EXISTS (SELECT 1 FROM public.books WHERE books.id = interview_turns.book_id AND books.user_id = auth.uid()));

CREATE POLICY "Users can read their own interview turns"
ON public.interview_turns FOR SELECT
USING (EXISTS (SELECT 1 FROM public.books WHERE books.id = interview_turns.book_id AND books.user_id = auth.uid()));

CREATE POLICY "Users can delete their own interview turns"
ON public.interview_turns FOR DELETE
USING (EXISTS (SELECT 1 FROM public.books WHERE books.id = interview_turns.book_id AND books.user_id = auth.uid()));
