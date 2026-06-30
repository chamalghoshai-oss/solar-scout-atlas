CREATE TABLE IF NOT EXISTS public.authorized_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  role public.app_role NOT NULL DEFAULT 'surveyor',
  track_phone boolean NOT NULL DEFAULT true,
  label text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT authorized_emails_email_gmail CHECK (lower(email) LIKE '%@gmail.com'),
  CONSTRAINT authorized_emails_email_unique UNIQUE (email)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.authorized_emails TO authenticated;
GRANT ALL ON public.authorized_emails TO service_role;

ALTER TABLE public.authorized_emails ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners manage authorized emails" ON public.authorized_emails;
DROP POLICY IF EXISTS "Users read own authorized email" ON public.authorized_emails;

CREATE POLICY "Users read own authorized email"
  ON public.authorized_emails
  FOR SELECT
  TO authenticated
  USING (lower(email) = lower(auth.jwt() ->> 'email') OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Owners manage authorized emails"
  ON public.authorized_emails
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER authorized_emails_set_updated_at
  BEFORE UPDATE ON public.authorized_emails
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.authorized_emails (email, role, track_phone, label)
VALUES
  ('chamalghosh.ai@gmail.com', 'admin', true, 'Chamal Ghosh'),
  ('chamal.ghosh@gmail.com', 'admin', true, 'Chamal Ghosh')
ON CONFLICT (email) DO UPDATE
SET role = EXCLUDED.role,
    track_phone = EXCLUDED.track_phone,
    label = EXCLUDED.label,
    updated_at = now();

CREATE OR REPLACE FUNCTION public.sync_authorized_email_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  profile_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT id INTO profile_id FROM public.profiles WHERE lower(email) = lower(OLD.email) LIMIT 1;
    IF profile_id IS NOT NULL THEN
      DELETE FROM public.user_roles WHERE user_id = profile_id;
    END IF;
    RETURN OLD;
  END IF;

  SELECT id INTO profile_id FROM public.profiles WHERE lower(email) = lower(NEW.email) LIMIT 1;
  IF profile_id IS NOT NULL THEN
    DELETE FROM public.user_roles WHERE user_id = profile_id AND role <> NEW.role;
    INSERT INTO public.user_roles (user_id, role)
    VALUES (profile_id, NEW.role)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS authorized_emails_sync_role_insert ON public.authorized_emails;
DROP TRIGGER IF EXISTS authorized_emails_sync_role_update ON public.authorized_emails;
DROP TRIGGER IF EXISTS authorized_emails_sync_role_delete ON public.authorized_emails;

CREATE TRIGGER authorized_emails_sync_role_insert
  AFTER INSERT ON public.authorized_emails
  FOR EACH ROW EXECUTE FUNCTION public.sync_authorized_email_role();

CREATE TRIGGER authorized_emails_sync_role_update
  AFTER UPDATE OF email, role ON public.authorized_emails
  FOR EACH ROW EXECUTE FUNCTION public.sync_authorized_email_role();

CREATE TRIGGER authorized_emails_sync_role_delete
  AFTER DELETE ON public.authorized_emails
  FOR EACH ROW EXECUTE FUNCTION public.sync_authorized_email_role();

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  access_role public.app_role;
  keep_settings_device text;
BEGIN
  SELECT role INTO access_role
  FROM public.authorized_emails
  WHERE lower(email) = lower(NEW.email)
  LIMIT 1;

  IF access_role IS NULL THEN
    RAISE EXCEPTION 'Email is not allowed for VertX Field';
  END IF;

  INSERT INTO public.profiles (id, full_name, email)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email), NEW.email)
  ON CONFLICT (id) DO UPDATE
  SET full_name = EXCLUDED.full_name,
      email = EXCLUDED.email,
      updated_at = now();

  DELETE FROM public.user_roles WHERE user_id = NEW.id AND role <> access_role;
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, access_role)
  ON CONFLICT DO NOTHING;

  IF access_role = 'admin' THEN
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

REVOKE EXECUTE ON FUNCTION public.sync_authorized_email_role() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- Sync roles for existing profiles that match the seeded owner emails.
INSERT INTO public.user_roles (user_id, role)
SELECT p.id, ae.role
FROM public.profiles p
JOIN public.authorized_emails ae ON lower(ae.email) = lower(p.email)
ON CONFLICT DO NOTHING;