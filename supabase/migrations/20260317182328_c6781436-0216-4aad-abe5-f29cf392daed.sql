
-- Add inspiration_frequency to user_settings
ALTER TABLE public.user_settings
ADD COLUMN inspiration_frequency text NOT NULL DEFAULT 'weekly';

-- Add onboarding_completed to profiles  
ALTER TABLE public.profiles
ADD COLUMN onboarding_completed boolean NOT NULL DEFAULT false;
