
-- 1) Managers can read roles of users they manage (so subordinate profiles show real role)
CREATE POLICY "Managers read team roles" ON public.user_roles
  FOR SELECT TO authenticated
  USING (public.manages_user(auth.uid(), user_id));

-- 2) Scope authorized_emails visibility for managers to rows they created
DROP POLICY IF EXISTS "Managers view field staff access" ON public.authorized_emails;
DROP POLICY IF EXISTS "Managers update field staff access" ON public.authorized_emails;
DROP POLICY IF EXISTS "Managers delete field staff access" ON public.authorized_emails;
DROP POLICY IF EXISTS "Managers insert field staff access" ON public.authorized_emails;

CREATE POLICY "Managers view own field staff access" ON public.authorized_emails
  FOR SELECT TO authenticated
  USING (public.is_manager(auth.uid()) AND role = 'field_staff' AND created_by = auth.uid());
CREATE POLICY "Managers insert own field staff access" ON public.authorized_emails
  FOR INSERT TO authenticated
  WITH CHECK (public.is_manager(auth.uid()) AND role = 'field_staff' AND created_by = auth.uid());
CREATE POLICY "Managers update own field staff access" ON public.authorized_emails
  FOR UPDATE TO authenticated
  USING (public.is_manager(auth.uid()) AND role = 'field_staff' AND created_by = auth.uid())
  WITH CHECK (public.is_manager(auth.uid()) AND role = 'field_staff' AND created_by = auth.uid());
CREATE POLICY "Managers delete own field staff access" ON public.authorized_emails
  FOR DELETE TO authenticated
  USING (public.is_manager(auth.uid()) AND role = 'field_staff' AND created_by = auth.uid());

-- 3) Update handle_new_user to also assign manager_id from authorized_emails.created_by
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  access_role text;
  creator_id uuid;
  keep_settings_device text;
BEGIN
  SELECT role, created_by INTO access_role, creator_id
  FROM public.authorized_emails
  WHERE lower(email) = lower(NEW.email)
  LIMIT 1;

  IF access_role IS NULL THEN
    access_role := 'field_staff';
  END IF;

  INSERT INTO public.profiles (id, full_name, email, status, manager_id)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email), NEW.email, 'active', creator_id)
  ON CONFLICT (id) DO UPDATE
  SET full_name = EXCLUDED.full_name,
      email = EXCLUDED.email,
      manager_id = COALESCE(public.profiles.manager_id, EXCLUDED.manager_id),
      updated_at = now();

  DELETE FROM public.user_roles WHERE user_id = NEW.id AND role <> access_role;
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, access_role)
  ON CONFLICT DO NOTHING;

  IF access_role = 'owner' THEN
    UPDATE public.leads      SET user_id = NEW.id WHERE user_id IS NULL;
    UPDATE public.runs       SET user_id = NEW.id WHERE user_id IS NULL;
    UPDATE public.run_points SET user_id = NEW.id WHERE user_id IS NULL;

    IF EXISTS (SELECT 1 FROM public.settings WHERE user_id = NEW.id) THEN
      DELETE FROM public.settings WHERE user_id IS NULL;
    ELSE
      SELECT device_id INTO keep_settings_device FROM public.settings WHERE user_id IS NULL LIMIT 1;
      IF keep_settings_device IS NOT NULL THEN
        DELETE FROM public.settings WHERE user_id IS NULL AND device_id <> keep_settings_device;
        UPDATE public.settings SET user_id = NEW.id WHERE device_id = keep_settings_device;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- 4) Backfill manager_id for existing profiles based on authorized_emails.created_by
UPDATE public.profiles p
SET manager_id = ae.created_by
FROM public.authorized_emails ae
WHERE lower(ae.email) = lower(p.email)
  AND ae.created_by IS NOT NULL
  AND ae.role <> 'owner'
  AND p.manager_id IS NULL
  AND ae.created_by <> p.id;
