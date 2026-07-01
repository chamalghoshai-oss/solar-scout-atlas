GRANT SELECT, INSERT, UPDATE, DELETE ON public.leads TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.runs TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.run_points TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.settings TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.run_points_id_seq TO anon, authenticated;

DROP POLICY IF EXISTS "Users manage own leads or owners manage all" ON public.leads;
DROP POLICY IF EXISTS "Users manage own runs or owners manage all" ON public.runs;
DROP POLICY IF EXISTS "Users manage own run points or owners manage all" ON public.run_points;
DROP POLICY IF EXISTS "Users manage own settings or owners manage all" ON public.settings;
DROP POLICY IF EXISTS "Surveyors manage own leads" ON public.leads;
DROP POLICY IF EXISTS "Surveyors manage own runs" ON public.runs;
DROP POLICY IF EXISTS "Surveyors manage own run_points" ON public.run_points;
DROP POLICY IF EXISTS "Users manage own settings" ON public.settings;

CREATE POLICY "Direct app access leads"
  ON public.leads
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Direct app access runs"
  ON public.runs
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Direct app access run points"
  ON public.run_points
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Direct app access settings"
  ON public.settings
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);