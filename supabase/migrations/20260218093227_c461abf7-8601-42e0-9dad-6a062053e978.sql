-- Add UPDATE policies for book-audio and generated-pdfs (needed for upsert)
CREATE POLICY "Users can update their own audio"
ON storage.objects
FOR UPDATE
USING (bucket_id = 'book-audio' AND (auth.uid())::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can update their own PDFs"
ON storage.objects
FOR UPDATE
USING (bucket_id = 'generated-pdfs' AND (auth.uid())::text = (storage.foldername(name))[1]);

-- Add UPDATE policy for book-images too
CREATE POLICY "Users can update their own images"
ON storage.objects
FOR UPDATE
USING (bucket_id = 'book-images' AND (auth.uid())::text = (storage.foldername(name))[1]);