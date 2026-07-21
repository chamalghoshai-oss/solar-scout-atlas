
-- 1. Backfill orphan rows to first owner
DO $$
DECLARE owner_id uuid;
BEGIN
  SELECT ur.user_id INTO owner_id FROM public.user_roles ur
    JOIN public.profiles p ON p.id = ur.user_id
    WHERE ur.role='owner' ORDER BY p.created_at LIMIT 1;
  IF owner_id IS NOT NULL THEN
    UPDATE public.leads      SET user_id = owner_id WHERE user_id IS NULL;
    UPDATE public.runs       SET user_id = owner_id WHERE user_id IS NULL;
    UPDATE public.run_points SET user_id = owner_id WHERE user_id IS NULL;
    UPDATE public.settings   SET user_id = owner_id WHERE user_id IS NULL;
  END IF;
END $$;

-- 2. Enforce NOT NULL on user_id
ALTER TABLE public.leads      ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE public.runs       ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE public.run_points ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE public.settings   ALTER COLUMN user_id SET NOT NULL;

-- 3. Drop old device-based policies
DROP POLICY IF EXISTS "Direct device access leads create" ON public.leads;
DROP POLICY IF EXISTS "Direct device access leads delete" ON public.leads;
DROP POLICY IF EXISTS "Direct device access leads edit"   ON public.leads;
DROP POLICY IF EXISTS "Direct device access leads read"   ON public.leads;

DROP POLICY IF EXISTS "Direct device access runs create" ON public.runs;
DROP POLICY IF EXISTS "Direct device access runs delete" ON public.runs;
DROP POLICY IF EXISTS "Direct device access runs edit"   ON public.runs;
DROP POLICY IF EXISTS "Direct device access runs read"   ON public.runs;

DROP POLICY IF EXISTS "Direct device access run points create" ON public.run_points;
DROP POLICY IF EXISTS "Direct device access run points delete" ON public.run_points;
DROP POLICY IF EXISTS "Direct device access run points edit"   ON public.run_points;
DROP POLICY IF EXISTS "Direct device access run points read"   ON public.run_points;

DROP POLICY IF EXISTS "Direct device access settings create" ON public.settings;
DROP POLICY IF EXISTS "Direct device access settings delete" ON public.settings;
DROP POLICY IF EXISTS "Direct device access settings edit"   ON public.settings;
DROP POLICY IF EXISTS "Direct device access settings read"   ON public.settings;

-- 4. Revoke anon access
REVOKE ALL ON public.leads, public.runs, public.run_points, public.settings FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.leads      TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.runs       TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.run_points TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.settings   TO authenticated;
GRANT ALL ON public.leads, public.runs, public.run_points, public.settings TO service_role;

-- 5. Role-scoped policies for leads / runs / run_points
CREATE POLICY "Team read leads" ON public.leads FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.manages_user(auth.uid(), user_id) OR public.is_owner(auth.uid()));
CREATE POLICY "Team insert leads" ON public.leads FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() OR public.is_owner(auth.uid()));
CREATE POLICY "Team update leads" ON public.leads FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR public.manages_user(auth.uid(), user_id) OR public.is_owner(auth.uid()))
  WITH CHECK (user_id = auth.uid() OR public.manages_user(auth.uid(), user_id) OR public.is_owner(auth.uid()));
CREATE POLICY "Team delete leads" ON public.leads FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR public.manages_user(auth.uid(), user_id) OR public.is_owner(auth.uid()));

CREATE POLICY "Team read runs" ON public.runs FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.manages_user(auth.uid(), user_id) OR public.is_owner(auth.uid()));
CREATE POLICY "Team insert runs" ON public.runs FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() OR public.is_owner(auth.uid()));
CREATE POLICY "Team update runs" ON public.runs FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR public.manages_user(auth.uid(), user_id) OR public.is_owner(auth.uid()))
  WITH CHECK (user_id = auth.uid() OR public.manages_user(auth.uid(), user_id) OR public.is_owner(auth.uid()));
CREATE POLICY "Team delete runs" ON public.runs FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR public.manages_user(auth.uid(), user_id) OR public.is_owner(auth.uid()));

CREATE POLICY "Team read run points" ON public.run_points FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.manages_user(auth.uid(), user_id) OR public.is_owner(auth.uid()));
CREATE POLICY "Team insert run points" ON public.run_points FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() OR public.is_owner(auth.uid()));
CREATE POLICY "Team update run points" ON public.run_points FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR public.manages_user(auth.uid(), user_id) OR public.is_owner(auth.uid()))
  WITH CHECK (user_id = auth.uid() OR public.manages_user(auth.uid(), user_id) OR public.is_owner(auth.uid()));
CREATE POLICY "Team delete run points" ON public.run_points FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR public.manages_user(auth.uid(), user_id) OR public.is_owner(auth.uid()));

-- 6. Settings: per-user only (owners can read all for support)
CREATE POLICY "Own settings read" ON public.settings FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_owner(auth.uid()));
CREATE POLICY "Own settings insert" ON public.settings FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "Own settings update" ON public.settings FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR public.is_owner(auth.uid()))
  WITH CHECK (user_id = auth.uid() OR public.is_owner(auth.uid()));
CREATE POLICY "Own settings delete" ON public.settings FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR public.is_owner(auth.uid()));
