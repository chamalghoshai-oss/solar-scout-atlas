CREATE TABLE public.lead_categories (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  key text NOT NULL,
  label text NOT NULL,
  color text NOT NULL DEFAULT '#3b82f6',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_categories TO authenticated;
GRANT ALL ON public.lead_categories TO service_role;

ALTER TABLE public.lead_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Team read lead categories" ON public.lead_categories
  FOR SELECT TO authenticated
  USING ((user_id = auth.uid()) OR manages_user(auth.uid(), user_id) OR is_owner(auth.uid()));

CREATE POLICY "Insert own lead categories" ON public.lead_categories
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Update own lead categories" ON public.lead_categories
  FOR UPDATE TO authenticated
  USING ((user_id = auth.uid()) OR is_owner(auth.uid()))
  WITH CHECK ((user_id = auth.uid()) OR is_owner(auth.uid()));

CREATE POLICY "Delete own lead categories" ON public.lead_categories
  FOR DELETE TO authenticated
  USING ((user_id = auth.uid()) OR is_owner(auth.uid()));