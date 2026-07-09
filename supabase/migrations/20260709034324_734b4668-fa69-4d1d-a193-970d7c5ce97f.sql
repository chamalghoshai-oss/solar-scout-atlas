
CREATE TYPE public.sim_job_status AS ENUM ('queued','processing','ready','failed');

CREATE TABLE public.sim_jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  title TEXT,
  status public.sim_job_status NOT NULL DEFAULT 'queued',
  provider TEXT NOT NULL DEFAULT 'mock',
  upload_paths TEXT[] NOT NULL DEFAULT '{}',
  mesh_url TEXT,
  kw_estimate NUMERIC,
  annual_kwh NUMERIC,
  notes TEXT,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sim_jobs TO authenticated;
GRANT ALL ON public.sim_jobs TO service_role;

ALTER TABLE public.sim_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own sim_jobs"
ON public.sim_jobs FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER sim_jobs_set_updated_at
BEFORE UPDATE ON public.sim_jobs
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX sim_jobs_user_created_idx ON public.sim_jobs(user_id, created_at DESC);
CREATE INDEX sim_jobs_lead_idx ON public.sim_jobs(lead_id);

-- Storage policies for sim-uploads bucket (folder = user id)
CREATE POLICY "sim-uploads read own"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'sim-uploads' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "sim-uploads insert own"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'sim-uploads' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "sim-uploads delete own"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'sim-uploads' AND auth.uid()::text = (storage.foldername(name))[1]);
