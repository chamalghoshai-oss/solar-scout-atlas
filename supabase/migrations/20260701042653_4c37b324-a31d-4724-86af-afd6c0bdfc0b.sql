DROP POLICY IF EXISTS "Direct app access leads" ON public.leads;
DROP POLICY IF EXISTS "Direct app access runs" ON public.runs;
DROP POLICY IF EXISTS "Direct app access run points" ON public.run_points;
DROP POLICY IF EXISTS "Direct app access settings" ON public.settings;

CREATE POLICY "Direct device access leads read"
  ON public.leads
  FOR SELECT
  TO anon, authenticated
  USING (device_id IS NOT NULL AND length(device_id) > 0);

CREATE POLICY "Direct device access leads create"
  ON public.leads
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (device_id IS NOT NULL AND length(device_id) > 0);

CREATE POLICY "Direct device access leads edit"
  ON public.leads
  FOR UPDATE
  TO anon, authenticated
  USING (device_id IS NOT NULL AND length(device_id) > 0)
  WITH CHECK (device_id IS NOT NULL AND length(device_id) > 0);

CREATE POLICY "Direct device access leads delete"
  ON public.leads
  FOR DELETE
  TO anon, authenticated
  USING (device_id IS NOT NULL AND length(device_id) > 0);

CREATE POLICY "Direct device access runs read"
  ON public.runs
  FOR SELECT
  TO anon, authenticated
  USING (device_id IS NOT NULL AND length(device_id) > 0);

CREATE POLICY "Direct device access runs create"
  ON public.runs
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (device_id IS NOT NULL AND length(device_id) > 0);

CREATE POLICY "Direct device access runs edit"
  ON public.runs
  FOR UPDATE
  TO anon, authenticated
  USING (device_id IS NOT NULL AND length(device_id) > 0)
  WITH CHECK (device_id IS NOT NULL AND length(device_id) > 0);

CREATE POLICY "Direct device access runs delete"
  ON public.runs
  FOR DELETE
  TO anon, authenticated
  USING (device_id IS NOT NULL AND length(device_id) > 0);

CREATE POLICY "Direct device access run points read"
  ON public.run_points
  FOR SELECT
  TO anon, authenticated
  USING (device_id IS NOT NULL AND length(device_id) > 0);

CREATE POLICY "Direct device access run points create"
  ON public.run_points
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (device_id IS NOT NULL AND length(device_id) > 0);

CREATE POLICY "Direct device access run points edit"
  ON public.run_points
  FOR UPDATE
  TO anon, authenticated
  USING (device_id IS NOT NULL AND length(device_id) > 0)
  WITH CHECK (device_id IS NOT NULL AND length(device_id) > 0);

CREATE POLICY "Direct device access run points delete"
  ON public.run_points
  FOR DELETE
  TO anon, authenticated
  USING (device_id IS NOT NULL AND length(device_id) > 0);

CREATE POLICY "Direct device access settings read"
  ON public.settings
  FOR SELECT
  TO anon, authenticated
  USING (device_id IS NOT NULL AND length(device_id) > 0);

CREATE POLICY "Direct device access settings create"
  ON public.settings
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (device_id IS NOT NULL AND length(device_id) > 0);

CREATE POLICY "Direct device access settings edit"
  ON public.settings
  FOR UPDATE
  TO anon, authenticated
  USING (device_id IS NOT NULL AND length(device_id) > 0)
  WITH CHECK (device_id IS NOT NULL AND length(device_id) > 0);

CREATE POLICY "Direct device access settings delete"
  ON public.settings
  FOR DELETE
  TO anon, authenticated
  USING (device_id IS NOT NULL AND length(device_id) > 0);