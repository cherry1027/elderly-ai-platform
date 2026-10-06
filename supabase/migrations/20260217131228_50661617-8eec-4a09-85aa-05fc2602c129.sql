
-- Storage bucket for generated PDFs
INSERT INTO storage.buckets (id, name, public) VALUES ('generated-pdfs', 'generated-pdfs', false);

-- Storage policies for generated PDFs
CREATE POLICY "Users can view their own PDFs" ON storage.objects FOR SELECT
  USING (bucket_id = 'generated-pdfs' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users can upload their own PDFs" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'generated-pdfs' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users can delete their own PDFs" ON storage.objects FOR DELETE
  USING (bucket_id = 'generated-pdfs' AND auth.uid()::text = (storage.foldername(name))[1]);
