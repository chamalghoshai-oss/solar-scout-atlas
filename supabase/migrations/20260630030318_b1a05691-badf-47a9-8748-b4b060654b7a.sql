-- Fix handle_new_user: reassigning multiple NULL settings rows to one user violates settings_user_id_unique.
-- Keep one NULL settings row per admin, delete the rest, then reassign.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  is_admin boolean := lower(NEW.email) = 'chamalghosh.ai@gmail.com';
  keep_settings_id uuid;
BEGIN
  INSERT INTO public.profiles (id, full_name, email)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email), NEW.email)
  ON CONFLICT (id) DO NOTHING;

  IF is_admin THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin')
      ON CONFLICT DO NOTHING;

    UPDATE public.leads      SET user_id = NEW.id WHERE user_id IS NULL;
    UPDATE public.runs       SET user_id = NEW.id WHERE user_id IS NULL;
    UPDATE public.run_points SET user_id = NEW.id WHERE user_id IS NULL;

    -- Avoid unique violation: if admin already has a settings row, delete legacy NULL rows;
    -- otherwise keep one legacy NULL row and assign it, delete the rest.
    IF EXISTS (SELECT 1 FROM public.settings WHERE user_id = NEW.id) THEN
      DELETE FROM public.settings WHERE user_id IS NULL;
    ELSE
      SELECT id INTO keep_settings_id FROM public.settings WHERE user_id IS NULL LIMIT 1;
      IF keep_settings_id IS NOT NULL THEN
        DELETE FROM public.settings WHERE user_id IS NULL AND id <> keep_settings_id;
        UPDATE public.settings SET user_id = NEW.id WHERE id = keep_settings_id;
      END IF;
    END IF;
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'surveyor')
      ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$function$;