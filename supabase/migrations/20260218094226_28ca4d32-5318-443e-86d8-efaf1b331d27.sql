
-- Add new columns to books for the record-everything flow
ALTER TABLE books 
ADD COLUMN IF NOT EXISTS raw_audio_url TEXT,
ADD COLUMN IF NOT EXISTS raw_audio_duration INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS transcription_text TEXT,
ADD COLUMN IF NOT EXISTS transcription_status TEXT DEFAULT 'not_started',
ADD COLUMN IF NOT EXISTS transcription_language TEXT DEFAULT 'sv';

-- Add chapter-related columns to pages
ALTER TABLE pages
ADD COLUMN IF NOT EXISTS start_position INTEGER,
ADD COLUMN IF NOT EXISTS end_position INTEGER,
ADD COLUMN IF NOT EXISTS chapter_number INTEGER;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_books_transcription_status ON books(transcription_status);
CREATE INDEX IF NOT EXISTS idx_pages_book_chapter ON pages(book_id, chapter_number);
