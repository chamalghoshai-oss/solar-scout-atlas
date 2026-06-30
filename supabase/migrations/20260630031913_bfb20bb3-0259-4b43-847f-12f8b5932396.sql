CREATE OR REPLACE FUNCTION public.is_owner(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = 'admin'
  )
$$;

REVOKE EXECUTE ON FUNCTION public.is_owner(uuid) FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS "Admins manage roles" ON public.user_roles;
DROP POLICY IF EXISTS "Surveyors manage own leads" ON public.leads;
DROP POLICY IF EXISTS "Surveyors manage own runs" ON public.runs;
DROP POLICY IF EXISTS "Surveyors manage own run_points" ON public.run_points;
DROP POLICY IF EXISTS "Users manage own settings" ON public.settings;
DROP POLICY IF EXISTS "Users read own authorized email" ON public.authorized_emails;
DROP POLICY IF EXISTS "Owners manage authorized emails" ON public.authorized_emails;

CREATE POLICY "Owners manage roles"
  ON public.user_roles
  FOR ALL
  TO authenticated
  USING (public.is_owner(auth.uid()))
  WITH CHECK (public.is_owner(auth.uid()));

CREATE POLICY "Users manage own leads or owners manage all"
  ON public.leads
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id OR public.is_owner(auth.uid()))
  WITH CHECK (auth.uid() = user_id OR public.is_owner(auth.uid()));

CREATE POLICY "Users manage own runs or owners manage all"
  ON public.runs
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id OR public.is_owner(auth.uid()))
  WITH CHECK (auth.uid() = user_id OR public.is_owner(auth.uid()));

CREATE POLICY "Users manage own run points or owners manage all"
  ON public.run_points
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id OR public.is_owner(auth.uid()))
  WITH CHECK (auth.uid() = user_id OR public.is_owner(auth.uid()));

CREATE POLICY "Users manage own settings or owners manage all"
  ON public.settings
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id OR public.is_owner(auth.uid()))
  WITH CHECK (auth.uid() = user_id OR public.is_owner(auth.uid()));

CREATE POLICY "Users read own authorized email"
  ON public.authorized_emails
  FOR SELECT
  TO authenticated
  USING (lower(email) = lower(auth.jwt() ->> 'email') OR public.is_owner(auth.uid()));

CREATE POLICY "Owners manage authorized emails"
  ON public.authorized_emails
  FOR ALL
  TO authenticated
  USING (public.is_owner(auth.uid()))
  WITH CHECK (public.is_owner(auth.uid()));

REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM authenticated;