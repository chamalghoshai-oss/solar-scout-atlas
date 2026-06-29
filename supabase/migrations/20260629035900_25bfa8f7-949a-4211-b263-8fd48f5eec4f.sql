
-- =========================================================
-- 1. Roles infrastructure
-- =========================================================
CREATE TYPE public.app_role AS ENUM ('admin', 'surveyor');

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE POLICY "Authenticated can read roles"
  ON public.user_roles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage roles"
  ON public.user_roles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- =========================================================
-- 2. Profiles
-- =========================================================
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text,
  email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Profiles readable by authenticated"
  ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users update own profile"
  ON public.profiles FOR UPDATE TO authenticated
  USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

CREATE TRIGGER profiles_set_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================================
-- 3. New-user trigger: profile + role + backfill orphan rows
-- =========================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  is_admin boolean := lower(NEW.email) = 'chamalghosh.ai@gmail.com';
BEGIN
  INSERT INTO public.profiles (id, full_name, email)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email), NEW.email)
  ON CONFLICT (id) DO NOTHING;

  IF is_admin THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin')
      ON CONFLICT DO NOTHING;
    -- Reassign all legacy device-mode rows to first admin
    UPDATE public.leads      SET user_id = NEW.id WHERE user_id IS NULL;
    UPDATE public.runs       SET user_id = NEW.id WHERE user_id IS NULL;
    UPDATE public.run_points SET user_id = NEW.id WHERE user_id IS NULL;
    UPDATE public.settings   SET user_id = NEW.id WHERE user_id IS NULL;
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'surveyor')
      ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =========================================================
-- 4. Add user_id to existing tables + settings PK fix
-- =========================================================
ALTER TABLE public.leads      ADD COLUMN user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.runs       ADD COLUMN user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.run_points ADD COLUMN user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.settings   ADD COLUMN user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_leads_user_id      ON public.leads(user_id);
CREATE INDEX IF NOT EXISTS idx_runs_user_id       ON public.runs(user_id);
CREATE INDEX IF NOT EXISTS idx_run_points_user_id ON public.run_points(user_id);
CREATE INDEX IF NOT EXISTS idx_settings_user_id   ON public.settings(user_id);

-- =========================================================
-- 5. Replace open anon policies with auth-scoped + admin policies
-- =========================================================
DROP POLICY IF EXISTS "anon all leads"       ON public.leads;
DROP POLICY IF EXISTS "anon all runs"        ON public.runs;
DROP POLICY IF EXISTS "anon all run_points"  ON public.run_points;
DROP POLICY IF EXISTS "anon all settings"    ON public.settings;

REVOKE ALL ON public.leads, public.runs, public.run_points, public.settings FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.leads      TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.runs       TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.run_points TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.settings   TO authenticated;
GRANT ALL ON public.leads, public.runs, public.run_points, public.settings TO service_role;

-- LEADS
CREATE POLICY "Surveyors manage own leads" ON public.leads
  FOR ALL TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

-- RUNS
CREATE POLICY "Surveyors manage own runs" ON public.runs
  FOR ALL TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

-- RUN_POINTS
CREATE POLICY "Surveyors manage own run_points" ON public.run_points
  FOR ALL TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

-- SETTINGS
CREATE POLICY "Users manage own settings" ON public.settings
  FOR ALL TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
