
-- Guarantee owner authority for chamalghosh.ai@gmail.com
INSERT INTO public.authorized_emails (email, role, label, track_phone)
VALUES ('chamalghosh.ai@gmail.com', 'owner', 'Chamal Ghosh', true)
ON CONFLICT (email) DO UPDATE SET role = 'owner', track_phone = true;

-- Sync existing profile / role if the account already signed in
DO $$
DECLARE uid uuid;
BEGIN
  SELECT id INTO uid FROM public.profiles WHERE lower(email) = 'chamalghosh.ai@gmail.com' LIMIT 1;
  IF uid IS NOT NULL THEN
    DELETE FROM public.user_roles WHERE user_id = uid AND role <> 'owner';
    INSERT INTO public.user_roles (user_id, role) VALUES (uid, 'owner') ON CONFLICT DO NOTHING;
  END IF;
END $$;

-- RLS: expand authorized_emails to allow managers to see/manage field_staff rows
DROP POLICY IF EXISTS "Owners manage authorized emails" ON public.authorized_emails;

CREATE POLICY "Owners full access authorized_emails"
ON public.authorized_emails FOR ALL
TO authenticated
USING (public.is_owner(auth.uid()))
WITH CHECK (public.is_owner(auth.uid()));

CREATE POLICY "Managers view field staff access"
ON public.authorized_emails FOR SELECT
TO authenticated
USING (public.is_manager(auth.uid()) AND role = 'field_staff');

CREATE POLICY "Managers insert field staff access"
ON public.authorized_emails FOR INSERT
TO authenticated
WITH CHECK (public.is_manager(auth.uid()) AND role = 'field_staff');

CREATE POLICY "Managers update field staff access"
ON public.authorized_emails FOR UPDATE
TO authenticated
USING (public.is_manager(auth.uid()) AND role = 'field_staff')
WITH CHECK (public.is_manager(auth.uid()) AND role = 'field_staff');

CREATE POLICY "Managers delete field staff access"
ON public.authorized_emails FOR DELETE
TO authenticated
USING (public.is_manager(auth.uid()) AND role = 'field_staff');
