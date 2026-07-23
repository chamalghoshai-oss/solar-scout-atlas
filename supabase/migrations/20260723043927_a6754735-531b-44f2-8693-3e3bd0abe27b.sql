
-- 1) Tighten storage SELECT policy on lead-photos
DROP POLICY IF EXISTS "authenticated read lead-photos" ON storage.objects;

CREATE POLICY "authenticated read own lead-photos"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'lead-photos'
  AND (
    owner = auth.uid()
    OR public.is_owner(auth.uid())
    OR public.manages_user(auth.uid(), owner)
  )
);

-- 2) Harden SECURITY DEFINER helper functions with in-function access checks
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL THEN false
    WHEN _user_id <> auth.uid() AND NOT EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role IN ('owner','manager')
    ) THEN false
    ELSE EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = _user_id AND role = _role
    )
  END
$$;

CREATE OR REPLACE FUNCTION public.is_owner(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL THEN false
    WHEN _user_id <> auth.uid() AND NOT EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role IN ('owner','manager')
    ) THEN false
    ELSE EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = _user_id AND role = 'owner'
    )
  END
$$;

CREATE OR REPLACE FUNCTION public.is_manager(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL THEN false
    WHEN _user_id <> auth.uid() AND NOT EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role IN ('owner','manager')
    ) THEN false
    ELSE EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = _user_id AND role = 'manager'
    )
  END
$$;

CREATE OR REPLACE FUNCTION public.manages_user(_manager_id uuid, _staff_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL THEN false
    WHEN _manager_id <> auth.uid() AND NOT EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role = 'owner'
    ) THEN false
    ELSE EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = _staff_id AND manager_id = _manager_id
    )
  END
$$;
