
-- ============================================================
-- PHASE 1: RBAC FOUNDATION
-- Convert role enum → text for scalability, add profile fields,
-- add audit_log, update helper functions.
-- ============================================================

-- 1. Extend profiles with RBAC fields
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS designation text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS manager_id uuid,
  ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_status_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_status_check CHECK (status IN ('active','disabled','suspended'));

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_manager_fk;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_manager_fk
  FOREIGN KEY (manager_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_manager ON public.profiles(manager_id);

-- 2. Drop functions that depend on app_role enum (recreate later with text)
DROP FUNCTION IF EXISTS public.has_role(uuid, public.app_role) CASCADE;
DROP FUNCTION IF EXISTS public.is_owner(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.sync_authorized_email_role() CASCADE;
DROP FUNCTION IF EXISTS public.handle_new_user() CASCADE;

-- 3. Convert role columns from enum → text
ALTER TABLE public.user_roles ALTER COLUMN role TYPE text USING role::text;
ALTER TABLE public.authorized_emails ALTER COLUMN role TYPE text USING role::text;

-- 4. Migrate values
UPDATE public.user_roles SET role = 'owner' WHERE role = 'admin';
UPDATE public.user_roles SET role = 'field_staff' WHERE role = 'surveyor';
UPDATE public.authorized_emails SET role = 'owner' WHERE role = 'admin';
UPDATE public.authorized_emails SET role = 'field_staff' WHERE role = 'surveyor';

-- 5. Add scalable CHECK constraint (extend by ALTER later, no schema break)
ALTER TABLE public.user_roles
  DROP CONSTRAINT IF EXISTS user_roles_role_check;
ALTER TABLE public.user_roles
  ADD CONSTRAINT user_roles_role_check
  CHECK (role IN ('owner','manager','field_staff'));

ALTER TABLE public.authorized_emails
  DROP CONSTRAINT IF EXISTS authorized_emails_role_check;
ALTER TABLE public.authorized_emails
  ADD CONSTRAINT authorized_emails_role_check
  CHECK (role IN ('owner','manager','field_staff'));

-- 6. Change default for authorized_emails.role
ALTER TABLE public.authorized_emails ALTER COLUMN role SET DEFAULT 'field_staff';

-- 7. Drop old enum type
DROP TYPE IF EXISTS public.app_role;

-- 8. Recreate helpers on text-based roles
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

CREATE OR REPLACE FUNCTION public.is_owner(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(_user_id, 'owner')
$$;

CREATE OR REPLACE FUNCTION public.is_manager(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(_user_id, 'manager')
$$;

-- Returns true if _manager manages _staff (staff.manager_id = _manager)
CREATE OR REPLACE FUNCTION public.manages_user(_manager_id uuid, _staff_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = _staff_id AND manager_id = _manager_id
  )
$$;

-- 9. Rewrite handle_new_user for new role names + profile fields
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  access_role text;
  keep_settings_device text;
BEGIN
  SELECT role INTO access_role
  FROM public.authorized_emails
  WHERE lower(email) = lower(NEW.email)
  LIMIT 1;

  -- Allow any email to sign up (owner will create most users). If listed in
  -- authorized_emails, honor that role; otherwise default to field_staff.
  IF access_role IS NULL THEN
    access_role := 'field_staff';
  END IF;

  INSERT INTO public.profiles (id, full_name, email, status)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email), NEW.email, 'active')
  ON CONFLICT (id) DO UPDATE
  SET full_name = EXCLUDED.full_name,
      email = EXCLUDED.email,
      updated_at = now();

  DELETE FROM public.user_roles WHERE user_id = NEW.id AND role <> access_role;
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, access_role)
  ON CONFLICT DO NOTHING;

  -- Migrate legacy anonymous data to first owner
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
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 10. Rewrite sync_authorized_email_role for text roles
CREATE OR REPLACE FUNCTION public.sync_authorized_email_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

DROP TRIGGER IF EXISTS trg_sync_authorized_email_role_ins ON public.authorized_emails;
DROP TRIGGER IF EXISTS trg_sync_authorized_email_role_upd ON public.authorized_emails;
DROP TRIGGER IF EXISTS trg_sync_authorized_email_role_del ON public.authorized_emails;
CREATE TRIGGER trg_sync_authorized_email_role_ins
AFTER INSERT ON public.authorized_emails
FOR EACH ROW EXECUTE FUNCTION public.sync_authorized_email_role();
CREATE TRIGGER trg_sync_authorized_email_role_upd
AFTER UPDATE ON public.authorized_emails
FOR EACH ROW EXECUTE FUNCTION public.sync_authorized_email_role();
CREATE TRIGGER trg_sync_authorized_email_role_del
AFTER DELETE ON public.authorized_emails
FOR EACH ROW EXECUTE FUNCTION public.sync_authorized_email_role();

-- 11. Restrict has_role/is_owner/is_manager/manages_user execution
REVOKE ALL ON FUNCTION public.has_role(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.is_owner(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_owner(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.is_manager(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_manager(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.manages_user(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.manages_user(uuid, uuid) TO authenticated;

-- 12. Update profiles policies: managers can view/update their team; owners see all
DROP POLICY IF EXISTS "Owners manage all profiles" ON public.profiles;
CREATE POLICY "Owners manage all profiles"
  ON public.profiles FOR ALL
  TO authenticated
  USING (public.is_owner(auth.uid()))
  WITH CHECK (public.is_owner(auth.uid()));

DROP POLICY IF EXISTS "Managers view their team profiles" ON public.profiles;
CREATE POLICY "Managers view their team profiles"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (manager_id = auth.uid());

-- 13. Audit log
CREATE TABLE IF NOT EXISTS public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_email text,
  action text NOT NULL,
  target_type text,
  target_id text,
  previous_value jsonb,
  new_value jsonb,
  ip_address text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.audit_log TO authenticated;
GRANT ALL ON public.audit_log TO service_role;

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners read audit log" ON public.audit_log;
CREATE POLICY "Owners read audit log"
  ON public.audit_log FOR SELECT
  TO authenticated
  USING (public.is_owner(auth.uid()));

DROP POLICY IF EXISTS "Authenticated users insert own audit entries" ON public.audit_log;
CREATE POLICY "Authenticated users insert own audit entries"
  ON public.audit_log FOR INSERT
  TO authenticated
  WITH CHECK (actor_id = auth.uid());

-- No UPDATE / DELETE policies → audit log is append-only under RLS.

CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON public.audit_log(actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_target ON public.audit_log(target_type, target_id, created_at DESC);
