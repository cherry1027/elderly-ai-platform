
-- Make the insert policy slightly more restrictive - require at least an email
DROP POLICY "Anyone can create support tickets" ON public.support_tickets;
CREATE POLICY "Authenticated users can create support tickets"
ON public.support_tickets
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);
