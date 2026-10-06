
-- Books
CREATE TABLE public.books (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  title TEXT NOT NULL DEFAULT 'Min bok',
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  plan_type TEXT NOT NULL DEFAULT 'freemium',
  page_count INTEGER NOT NULL DEFAULT 0,
  image_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  last_edited TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  scheduled_deletion TIMESTAMP WITH TIME ZONE,
  deletion_reminded_1m BOOLEAN NOT NULL DEFAULT FALSE,
  deletion_reminded_2w BOOLEAN NOT NULL DEFAULT FALSE,
  deletion_reminded_1d BOOLEAN NOT NULL DEFAULT FALSE
);

ALTER TABLE public.books ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own books" ON public.books FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create their own books" ON public.books FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own books" ON public.books FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own books" ON public.books FOR DELETE USING (auth.uid() = user_id);

-- Pages
CREATE TABLE public.pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id UUID NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  page_number INTEGER NOT NULL,
  title TEXT,
  content TEXT,
  audio_url TEXT,
  audio_duration INTEGER,
  layout_type TEXT NOT NULL DEFAULT 'standard',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(book_id, page_number)
);

ALTER TABLE public.pages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view pages of their books" ON public.pages FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.books WHERE books.id = pages.book_id AND books.user_id = auth.uid()));
CREATE POLICY "Users can create pages in their books" ON public.pages FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.books WHERE books.id = pages.book_id AND books.user_id = auth.uid()));
CREATE POLICY "Users can update pages in their books" ON public.pages FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.books WHERE books.id = pages.book_id AND books.user_id = auth.uid()));
CREATE POLICY "Users can delete pages in their books" ON public.pages FOR DELETE
  USING (EXISTS (SELECT 1 FROM public.books WHERE books.id = pages.book_id AND books.user_id = auth.uid()));

-- Images
CREATE TABLE public.images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id UUID REFERENCES public.pages(id) ON DELETE CASCADE,
  book_id UUID NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  thumbnail_url TEXT,
  caption TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  width INTEGER,
  height INTEGER,
  file_size INTEGER,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.images ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view images of their books" ON public.images FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.books WHERE books.id = images.book_id AND books.user_id = auth.uid()));
CREATE POLICY "Users can create images in their books" ON public.images FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.books WHERE books.id = images.book_id AND books.user_id = auth.uid()));
CREATE POLICY "Users can update images in their books" ON public.images FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.books WHERE books.id = images.book_id AND books.user_id = auth.uid()));
CREATE POLICY "Users can delete images in their books" ON public.images FOR DELETE
  USING (EXISTS (SELECT 1 FROM public.books WHERE books.id = images.book_id AND books.user_id = auth.uid()));

-- Print Orders
CREATE TABLE public.print_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id UUID REFERENCES public.books(id),
  user_id UUID NOT NULL,
  order_type TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  price DECIMAL(10,2),
  status TEXT NOT NULL DEFAULT 'pending',
  shipping_address JSONB,
  tracking_number TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.print_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own orders" ON public.print_orders FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create their own orders" ON public.print_orders FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own orders" ON public.print_orders FOR UPDATE USING (auth.uid() = user_id);

-- User Settings
CREATE TABLE public.user_settings (
  user_id UUID PRIMARY KEY NOT NULL,
  email_notifications BOOLEAN NOT NULL DEFAULT TRUE,
  deletion_reminders BOOLEAN NOT NULL DEFAULT TRUE,
  newsletter BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own settings" ON public.user_settings FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create their own settings" ON public.user_settings FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own settings" ON public.user_settings FOR UPDATE USING (auth.uid() = user_id);

-- Indexes
CREATE INDEX idx_books_user_id ON public.books(user_id);
CREATE INDEX idx_books_status ON public.books(status);
CREATE INDEX idx_pages_book_id ON public.pages(book_id);
CREATE INDEX idx_images_book_id ON public.images(book_id);
CREATE INDEX idx_images_page_id ON public.images(page_id);
CREATE INDEX idx_scheduled_deletion ON public.books(scheduled_deletion) WHERE scheduled_deletion IS NOT NULL;

-- Triggers for updated_at
CREATE TRIGGER update_books_updated_at BEFORE UPDATE ON public.books FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_pages_updated_at BEFORE UPDATE ON public.pages FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_print_orders_updated_at BEFORE UPDATE ON public.print_orders FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Storage buckets for audio and images
INSERT INTO storage.buckets (id, name, public) VALUES ('book-audio', 'book-audio', false);
INSERT INTO storage.buckets (id, name, public) VALUES ('book-images', 'book-images', true);

-- Storage policies
CREATE POLICY "Users can upload their own audio" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'book-audio' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users can view their own audio" ON storage.objects FOR SELECT
  USING (bucket_id = 'book-audio' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users can delete their own audio" ON storage.objects FOR DELETE
  USING (bucket_id = 'book-audio' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Anyone can view book images" ON storage.objects FOR SELECT
  USING (bucket_id = 'book-images');
CREATE POLICY "Users can upload their own images" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'book-images' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users can delete their own images" ON storage.objects FOR DELETE
  USING (bucket_id = 'book-images' AND auth.uid()::text = (storage.foldername(name))[1]);
