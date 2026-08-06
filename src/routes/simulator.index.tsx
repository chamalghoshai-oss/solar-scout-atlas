import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Upload, Boxes, CheckCircle2, Clock, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { uploadSimFile } from "@/lib/sim-uploads";
import { activeProvider } from "@/lib/photogrammetry";

export const Route = createFileRoute("/simulator")({
  head: () => ({
    meta: [
      { title: "3D Solar Simulator — VertX Field" },
      { name: "description", content: "Upload site photos or video to reconstruct a rooftop 3D model and estimate solar output." },
    ],
  }),
  component: SimulatorList,
});

type Job = {
  id: string;
  lead_id: string | null;
  title: string | null;
  status: "queued" | "processing" | "ready" | "failed";
  provider: string;
  upload_paths: string[];
  kw_estimate: number | null;
  annual_kwh: number | null;
  created_at: string;
};

function SimulatorList() {
  const navigate = useNavigate();
  const search = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
  const linkedLeadId = search?.get("leadId") ?? null;

  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("sim_jobs")
        .select("id,lead_id,title,status,provider,upload_paths,kw_estimate,annual_kwh,created_at")
        .order("created_at", { ascending: false });
      setJobs((data as Job[]) ?? []);
      setLoading(false);
    })();
  }, []);

  async function createJob() {
    if (!files.length) {
      toast.error("Add at least one photo or video");
      return;
    }
    setCreating(true);
    try {
      const { data: session } = await supabase.auth.getUser();
      const userId = session.user?.id;
      if (!userId) {
        toast.error("Please sign in first");
        return;
      }
      const paths: string[] = [];
      for (const f of files) paths.push(await uploadSimFile(userId, f));

      const { data: inserted, error } = await supabase
        .from("sim_jobs")
        .insert({
          user_id: userId,
          lead_id: linkedLeadId,
          title: title.trim() || null,
          status: "queued",
          provider: activeProvider.id,
          upload_paths: paths,
        })
        .select("id")
        .single();
      if (error || !inserted) throw error ?? new Error("Insert failed");

      // Kick the provider (mock returns quickly).
      const { providerJobId } = await activeProvider.submit({ jobId: inserted.id, uploadPaths: paths });
      await supabase.from("sim_jobs").update({ status: "processing", notes: providerJobId }).eq("id", inserted.id);

      // Poll once (mock is instant). Real providers would use webhooks/polling.
      const result = await activeProvider.poll?.(providerJobId);
      if (result) {
        await supabase
          .from("sim_jobs")
          .update({
            status: result.status,
            mesh_url: result.meshUrl ?? null,
            kw_estimate: result.kwEstimate ?? null,
            annual_kwh: result.annualKwh ?? null,
            notes: result.notes ?? null,
            error: result.error ?? null,
          })
          .eq("id", inserted.id);
      }

      toast.success("Simulation ready");
      navigate({ to: "/simulator/$id", params: { id: inserted.id } });
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to create job");
    } finally {
      setCreating(false);
    }
  }

  return (
    <AppShell>
      <header className="mb-4 flex items-center gap-2">
        <Boxes className="h-6 w-6 text-primary" />
        <div className="flex-1">
          <h1 className="text-xl font-bold leading-tight">3D Solar Simulator</h1>
          <p className="text-xs text-muted-foreground">
            {linkedLeadId ? "Linking to a lead" : "Upload site photos or a walk-around video"}
          </p>
        </div>
      </header>

      <section className="mb-6 rounded-xl border border-border bg-card p-3">
        <Label htmlFor="sim-title" className="text-xs">Job title (optional)</Label>
        <Input
          id="sim-title"
          className="mb-3 mt-1"
          placeholder="e.g. Ravi's rooftop, Chevayur"
          value={title}
          maxLength={120}
          onChange={(e) => setTitle(e.target.value)}
        />

        <label className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-border py-6 text-center">
          <Upload className="h-6 w-6 text-muted-foreground" />
          <span className="text-sm font-medium">Choose photos or a video</span>
          <span className="text-[11px] text-muted-foreground">Walk around the house, 20–40 photos or a 30–60 s clip</span>
          <input
            type="file"
            accept="image/*,video/*"
            multiple
            className="hidden"
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
          />
        </label>
        {files.length > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">{files.length} file{files.length === 1 ? "" : "s"} selected</p>
        )}

        <Button className="mt-3 w-full" onClick={createJob} disabled={creating || !files.length}>
          {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Boxes className="mr-2 h-4 w-4" />}
          {creating ? "Uploading & processing…" : "Start reconstruction"}
        </Button>
        <p className="mt-2 text-[10px] leading-snug text-muted-foreground">
          Provider: <span className="font-mono">{activeProvider.id}</span>. Swap to a real photogrammetry service in{" "}
          <span className="font-mono">src/lib/photogrammetry.ts</span>.
        </p>
      </section>

      <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Recent jobs</h2>
      {loading ? (
        <div className="flex h-24 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
      ) : jobs.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
          No simulator jobs yet.
        </p>
      ) : (
        <ul className="space-y-2">
          {jobs.map((j) => (
            <li key={j.id}>
              <Link
                to="/simulator/$id"
                params={{ id: j.id }}
                className="flex items-center gap-3 rounded-lg border border-border bg-card p-3 hover:bg-muted"
              >
                <StatusIcon status={j.status} />
                <div className="flex-1 overflow-hidden">
                  <p className="truncate text-sm font-semibold">{j.title || `Job ${j.id.slice(0, 8)}`}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {j.upload_paths.length} file{j.upload_paths.length === 1 ? "" : "s"} · {new Date(j.created_at).toLocaleString()}
                  </p>
                </div>
                {j.kw_estimate != null && (
                  <div className="text-right">
                    <div className="text-sm font-bold text-primary">{j.kw_estimate.toFixed(1)} kW</div>
                    {j.annual_kwh != null && <div className="text-[10px] text-muted-foreground">{j.annual_kwh} kWh/yr</div>}
                  </div>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </AppShell>
  );
}

function StatusIcon({ status }: { status: Job["status"] }) {
  if (status === "ready") return <CheckCircle2 className="h-5 w-5 text-emerald-500" />;
  if (status === "failed") return <AlertCircle className="h-5 w-5 text-red-500" />;
  if (status === "processing") return <Loader2 className="h-5 w-5 animate-spin text-primary" />;
  return <Clock className="h-5 w-5 text-muted-foreground" />;
}