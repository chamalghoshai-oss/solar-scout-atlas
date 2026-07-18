
-- 1. profiles: drop broad read
DROP POLICY IF EXISTS "Profiles readable by authenticated" ON public.profiles;
CREATE POLICY "Users read own profile" ON public.profiles
  FOR SELECT TO authenticated
  USING (auth.uid() = id);

-- 2. user_roles: drop broad read
DROP POLICY IF EXISTS "Authenticated can read roles" ON public.user_roles;
CREATE POLICY "Users read own roles" ON public.user_roles
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "Owners read all roles" ON public.user_roles
  FOR SELECT TO authenticated
  USING (public.is_owner(auth.uid()));
CREATE POLICY "Owners manage roles" ON public.user_roles
  FOR ALL TO authenticated
  USING (public.is_owner(auth.uid()))
  WITH CHECK (public.is_owner(auth.uid()));

-- 3. authorized_emails: explicit owner-only policies
DROP POLICY IF EXISTS "Owners manage authorized emails" ON public.authorized_emails;
DROP POLICY IF EXISTS "Owners read authorized emails" ON public.authorized_emails;
CREATE POLICY "Owners manage authorized emails" ON public.authorized_emails
  FOR ALL TO authenticated
  USING (public.is_owner(auth.uid()))
  WITH CHECK (public.is_owner(auth.uid()));

-- 4. lead-photos storage: require authenticated
DROP POLICY IF EXISTS "anon read lead-photos" ON storage.objects;
DROP POLICY IF EXISTS "anon write lead-photos" ON storage.objects;
DROP POLICY IF EXISTS "anon update lead-photos" ON storage.objects;
DROP POLICY IF EXISTS "anon delete lead-photos" ON storage.objects;

CREATE POLICY "authenticated read lead-photos" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'lead-photos');
CREATE POLICY "authenticated write lead-photos" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'lead-photos' AND owner = auth.uid());
CREATE POLICY "authenticated update own lead-photos" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'lead-photos' AND owner = auth.uid())
  WITH CHECK (bucket_id = 'lead-photos' AND owner = auth.uid());
CREATE POLICY "authenticated delete own lead-photos" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'lead-photos' AND owner = auth.uid());

-- 5. Revoke EXECUTE from anon/authenticated on SECURITY DEFINER helpers.
-- These are used inside RLS policies (run as function owner) and triggers, so
-- API roles do not need direct EXECUTE.
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, text) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_owner(uuid) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_manager(uuid) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.manages_user(uuid, uuid) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sync_authorized_email_role() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_updated_at() FROM anon, authenticated, PUBLIC;
