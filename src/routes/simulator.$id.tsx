import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Loader2, Boxes, Trash2, RefreshCcw } from "lucide-react";
import { signSimUrls, isVideo } from "@/lib/sim-uploads";
import { activeProvider } from "@/lib/photogrammetry";
import { ShadeStudio } from "@/components/ShadeStudio";
import { CadStudio } from "@/components/cad/CadStudio";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";

export const Route = createFileRoute("/simulator/$id")({
  head: () => ({
    meta: [{ title: "Simulation — VertX Field" }, { name: "description", content: "3D rooftop simulation and solar estimate." }],
  }),
  component: SimulatorDetail,
});

type Job = {
  id: string;
  lead_id: string | null;
  title: string | null;
  status: "queued" | "processing" | "ready" | "failed";
  provider: string;
  upload_paths: string[];
  mesh_url: string | null;
  kw_estimate: number | null;
  annual_kwh: number | null;
  notes: string | null;
  error: string | null;
  created_at: string;
};

function SimulatorDetail() {
  const { id } = Route.useParams();
  const [job, setJob] = useState<Job | null>(null);
  const [signed, setSigned] = useState<Record<string, string>>({});
  const [reprocessing, setReprocessing] = useState(false);
  const firstImage =
    job?.upload_paths.map((p) => signed[p]).find((u, i) => u && !isVideo(job.upload_paths[i])) ?? null;

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("sim_jobs").select("*").eq("id", id).maybeSingle();
      if (data) {
        setJob(data as Job);
        setSigned(await signSimUrls((data as Job).upload_paths));
      }
    })();
  }, [id]);

  async function reprocess() {
    if (!job) return;
    setReprocessing(true);
    try {
      await supabase.from("sim_jobs").update({ status: "processing", error: null }).eq("id", job.id);
      const { providerJobId } = await activeProvider.submit({
        jobId: job.id,
        uploadPaths: job.upload_paths,
      });
      const result = await activeProvider.poll?.(providerJobId);
      if (result) {
        const patch = {
          status: result.status,
          mesh_url: result.meshUrl ?? null,
          kw_estimate: result.kwEstimate ?? null,
          annual_kwh: result.annualKwh ?? null,
          notes: result.notes ?? null,
          error: result.error ?? null,
        };
        await supabase.from("sim_jobs").update(patch).eq("id", job.id);
        setJob({ ...job, ...patch });
      }
      toast.success("Reprocessed");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setReprocessing(false);
    }
  }

  async function remove() {
    if (!job) return;
    if (!confirm("Delete this simulation?")) return;
    await supabase.from("sim_jobs").delete().eq("id", job.id);
    toast.success("Deleted");
    window.location.href = "/simulator";
  }

  if (!job) {
    return (
      <AppShell>
        <div className="flex h-40 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <header className="mb-4 flex items-center gap-2">
        <Link to="/simulator" className="rounded-full p-1.5 hover:bg-muted" aria-label="Back"><ArrowLeft className="h-5 w-5" /></Link>
        <div className="flex-1">
          <h1 className="flex items-center gap-1.5 text-xl font-bold leading-tight">
            <Boxes className="h-5 w-5 text-primary" />
            {job.title || `Job ${job.id.slice(0, 8)}`}
          </h1>
          <p className="text-[11px] text-muted-foreground">
            {new Date(job.created_at).toLocaleString()} · provider <span className="font-mono">{job.provider}</span>
          </p>
        </div>
      </header>

      <div className="mb-4 grid grid-cols-3 gap-2 text-center">
        <Metric label="Status" value={job.status} accent={job.status === "ready"} />
        <Metric label="System" value={job.kw_estimate != null ? `${job.kw_estimate.toFixed(1)} kW` : "—"} accent />
        <Metric label="Annual" value={job.annual_kwh != null ? `${job.annual_kwh} kWh` : "—"} />
      </div>

      <div className="mb-4">
        <Tabs defaultValue="cad">
          <TabsList className="mb-3 grid w-full grid-cols-2">
            <TabsTrigger value="cad">Manual 3D design</TabsTrigger>
            <TabsTrigger value="quick">Quick estimate</TabsTrigger>
          </TabsList>
          <TabsContent value="cad">
            <CadStudio imageUrl={firstImage} />
            <p className="mt-2 text-[10px] leading-snug text-muted-foreground">
              Draw the roof outline over the site image, set the roof form, drop obstructions and panel grids, then
              scrub the date and time sliders (6 am–6 pm) to watch real shadows move across the design.
            </p>
          </TabsContent>
          <TabsContent value="quick">
            <ShadeStudio kwEstimate={job.kw_estimate} />
            <p className="mt-2 text-[10px] leading-snug text-muted-foreground">
              Enter the roof dimensions and any nearby obstruction, then scrub time of day (6 am–6 pm) and day of year
              to watch the shade move across the array.
            </p>
          </TabsContent>
        </Tabs>
      </div>

      {job.notes && (
        <div className="mb-4 rounded-md border border-border bg-muted/40 p-3 text-xs">{job.notes}</div>
      )}
      {job.error && (
        <div className="mb-4 rounded-md border border-red-300 bg-red-50 p-3 text-xs text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {job.error}
        </div>
      )}

      <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Uploads ({job.upload_paths.length})</h2>
      <div className="mb-6 grid grid-cols-3 gap-2">
        {job.upload_paths.map((p) => (
          <a key={p} href={signed[p]} target="_blank" rel="noreferrer" className="block">
            <div className="aspect-square overflow-hidden rounded-md border bg-muted">
              {signed[p] ? (
                isVideo(p) ? (
                  <video src={signed[p]} className="h-full w-full object-cover" muted playsInline />
                ) : (
                  <img src={signed[p]} alt="upload" className="h-full w-full object-cover" />
                )
              ) : (
                <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">…</div>
              )}
            </div>
          </a>
        ))}
      </div>

      {job.lead_id && (
        <Link
          to="/leads/$id"
          params={{ id: job.lead_id }}
          className="mb-3 block rounded-md border border-border bg-card px-3 py-2 text-center text-sm hover:bg-muted"
        >
          Open linked lead →
        </Link>
      )}

      <div className="flex gap-2">
        <Button variant="outline" className="flex-1" onClick={remove}>
          <Trash2 className="mr-2 h-4 w-4" /> Delete
        </Button>
        <Button className="flex-1" onClick={reprocess} disabled={reprocessing}>
          {reprocessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCcw className="mr-2 h-4 w-4" />}
          Reprocess
        </Button>
      </div>
    </AppShell>
  );
}

function Metric({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`rounded-md border px-2 py-1.5 ${accent ? "border-primary/30 bg-primary/10" : ""}`}>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-sm font-bold capitalize ${accent ? "text-primary" : ""}`}>{value}</div>
    </div>
  );
}