
-- Runs: each marketing run
CREATE TABLE public.runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  device_id TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  distance_m NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX runs_device_idx ON public.runs(device_id, started_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.runs TO anon, authenticated;
GRANT ALL ON public.runs TO service_role;
ALTER TABLE public.runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon all runs" ON public.runs FOR ALL USING (true) WITH CHECK (true);

-- Run points: breadcrumb GPS samples
CREATE TABLE public.run_points (
  id BIGSERIAL PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES public.runs(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  accuracy NUMERIC,
  ts TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX run_points_run_idx ON public.run_points(run_id, ts);
CREATE INDEX run_points_device_idx ON public.run_points(device_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.run_points TO anon, authenticated;
GRANT ALL ON public.run_points TO service_role;
ALTER TABLE public.run_points ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon all run_points" ON public.run_points FOR ALL USING (true) WITH CHECK (true);

-- Leads + potential houses
CREATE TABLE public.leads (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  device_id TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'lead', -- 'lead' | 'potential'
  name TEXT,
  phone TEXT,
  required_kw NUMERIC,
  notes TEXT,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  status TEXT NOT NULL DEFAULT 'interested',
  visited BOOLEAN NOT NULL DEFAULT true,
  photos JSONB NOT NULL DEFAULT '[]'::jsonb, -- [{url, lat, lng, ts}]
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX leads_device_idx ON public.leads(device_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.leads TO anon, authenticated;
GRANT ALL ON public.leads TO service_role;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon all leads" ON public.leads FOR ALL USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public;
CREATE TRIGGER leads_updated BEFORE UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Settings (one per device)
CREATE TABLE public.settings (
  device_id TEXT PRIMARY KEY,
  sender_name TEXT NOT NULL DEFAULT 'Aureon',
  company_name TEXT NOT NULL DEFAULT 'VertX Energies',
  whatsapp_template TEXT NOT NULL DEFAULT 'Hi {name}, this is {sender} from {company}. I am following up on our chat about the {kw}kW solar system for your site...',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.settings TO anon, authenticated;
GRANT ALL ON public.settings TO service_role;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon all settings" ON public.settings FOR ALL USING (true) WITH CHECK (true);
