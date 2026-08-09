import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { STATUSES, StatusBadgePlaceholder } from "./leads-helpers";
import { ArrowLeft, MapPin, MessageCircle, Save, Trash2, Camera, Loader2, SunMedium, ImagePlus, Boxes } from "lucide-react";
import { buildWhatsAppLink } from "@/lib/whatsapp";
import { getSignedUrls, uploadPhoto, type PhotoMeta } from "@/lib/photos";
import { toast } from "sonner";
import { RoofPlanner, type RoofPlan } from "@/components/RoofPlanner";
import { GeoCamera } from "@/components/GeoCamera";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CadStudio } from "@/components/cad/CadStudio";
import type { CadModel } from "@/lib/cad-model";

type SavedDesign = {
  model: CadModel;
  shots: { top: string | null; side: string | null };
  kw: number;
  savedAt: string;
};

export const Route = createFileRoute("/leads/$id")({
  head: () => ({
    meta: [{ title: "Lead — VertX Field" }, { name: "description", content: "Lead detail with WhatsApp follow-up." }],
  }),
  component: LeadDetail,
});

type Lead = {
  id: string;
  name: string | null;
  phone: string | null;
  required_kw: number | null;
  notes: string | null;
  lat: number;
  lng: number;
  status: string;
  type: string;
  visited: boolean;
  photos: PhotoMeta[];
  roof_plan: RoofPlan | null;
  cad_design: SavedDesign | null;
  created_at: string;
};

type Settings = { sender_name: string; company_name: string; whatsapp_template: string };

function LeadDetail() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const [lead, setLead] = useState<Lead | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [plannerOpen, setPlannerOpen] = useState(false);
  const [cadOpen, setCadOpen] = useState(false);

  useEffect(() => {
    (async () => {
      const [{ data: l }, { data: s }] = await Promise.all([
        supabase.from("leads").select("*").eq("id", id).maybeSingle(),
        supabase.from("settings").select("sender_name,company_name,whatsapp_template").maybeSingle(),
      ]);
      if (l) {
        const lead = l as unknown as Lead;
        setLead(lead);
        const paths = (lead.photos || []).map((p) => p.path);
        if (paths.length) setSignedUrls(await getSignedUrls(paths));
      }
      setSettings(
        (s as Settings) ?? {
          sender_name: "Aureon",
          company_name: "VertX Energies",
          whatsapp_template: "Hi {name}, this is {sender} from {company}. I am following up on our chat about the {kw}kW solar system for your site...",
        }
      );
    })();
  }, [id]);

  const waLink = useMemo(() => {
    if (!lead?.phone || !settings) return null;
    return buildWhatsAppLink({
      phone: lead.phone,
      name: lead.name,
      kw: lead.required_kw,
      template: settings.whatsapp_template,
      sender: settings.sender_name,
      company: settings.company_name,
      business: typeof window !== "undefined" && localStorage.getItem("wa_business") === "1",
    });
  }, [lead, settings]);

  async function update<K extends keyof Lead>(key: K, value: Lead[K]) {
    if (!lead) return;
    setLead({ ...lead, [key]: value });
  }
  async function save() {
    if (!lead) return;
    setSaving(true);
    const { error } = await supabase
      .from("leads")
      .update({
        name: lead.name,
        phone: lead.phone,
        required_kw: lead.required_kw,
        notes: lead.notes,
        status: lead.status,
        visited: lead.visited,
        photos: lead.photos,
        roof_plan: lead.roof_plan,
      })
      .eq("id", lead.id);
    setSaving(false);
    if (error) toast.error(error.message);
    else toast.success("Saved");
  }
  async function remove() {
    if (!lead) return;
    if (!confirm("Delete this lead?")) return;
    await supabase.from("leads").delete().eq("id", lead.id);
    toast.success("Deleted");
    navigate({ to: "/leads" });
  }
  async function addPhotos(files: FileList | null) {
    if (!files?.length || !lead) return;
    setUploading(true);
    try {
      const added: PhotoMeta[] = [];
      for (const f of Array.from(files)) added.push(await uploadPhoto(f, { lat: lead.lat, lng: lead.lng }));
      const next = [...(lead.photos || []), ...added];
      setLead({ ...lead, photos: next });
      const newSigned = await getSignedUrls(added.map((a) => a.path));
      setSignedUrls((s) => ({ ...s, ...newSigned }));
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function onGeoCaptured(meta: PhotoMeta) {
    if (!lead) return;
    const next = [...(lead.photos || []), meta];
    setLead({ ...lead, photos: next });
    const newSigned = await getSignedUrls([meta.path]);
    setSignedUrls((s) => ({ ...s, ...newSigned }));
    // persist immediately so the geotag photo is saved even before "Save"
    await supabase.from("leads").update({ photos: next }).eq("id", lead.id);
  }


  if (!lead) {
    return (
      <AppShell>
        <div className="flex h-40 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
      </AppShell>
    );
  }

  const isPotential = lead.type === "potential";
  const planSummary = lead.roof_plan
    ? {
        active: lead.roof_plan.panels.length - (lead.roof_plan.disabled?.length ?? 0),
        total: lead.roof_plan.panels.length,
        kw: ((lead.roof_plan.panels.length - (lead.roof_plan.disabled?.length ?? 0)) * lead.roof_plan.spec.watt) / 1000,
      }
    : null;

  return (
    <AppShell>
      <header className="mb-4 flex items-center gap-2">
        <Link to="/leads" className="rounded-full p-1.5 hover:bg-muted" aria-label="Back">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex-1">
          <h1 className="text-xl font-bold leading-tight">{lead.name || (isPotential ? "Potential house" : "Lead")}</h1>
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <MapPin className="h-3 w-3" />
            {lead.lat.toFixed(5)}, {lead.lng.toFixed(5)}
          </p>
        </div>
        <StatusBadgePlaceholder status={lead.status} type={lead.type} />
      </header>

      {waLink ? (
        <a
          href={waLink}
          target="_blank"
          rel="noopener noreferrer"
          className="mb-4 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#25D366] text-sm font-semibold text-white shadow active:opacity-90"
        >
          <MessageCircle className="h-5 w-5" /> Contact on WhatsApp
        </a>
      ) : (
        <div className="mb-4 rounded-xl border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
          Add a phone number to enable WhatsApp follow-up.
        </div>
      )}

      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Name</Label>
            <Input value={lead.name ?? ""} maxLength={100} onChange={(e) => update("name", e.target.value)} />
          </div>
          <div>
            <Label>Phone</Label>
            <Input value={lead.phone ?? ""} maxLength={20} onChange={(e) => update("phone", e.target.value)} inputMode="tel" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Required kW</Label>
            <Input
              type="number"
              inputMode="decimal"
              value={lead.required_kw ?? ""}
              onChange={(e) => update("required_kw", e.target.value === "" ? null : Number(e.target.value))}
            />
          </div>
          <div>
            <Label>Status</Label>
            <Select value={lead.status} onValueChange={(v) => update("status", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div>
          <Label>Notes</Label>
          <Textarea value={lead.notes ?? ""} maxLength={1000} rows={3} onChange={(e) => update("notes", e.target.value)} />
        </div>

        <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
          <Label htmlFor="visited">Visited</Label>
          <Switch id="visited" checked={lead.visited} onCheckedChange={(v) => update("visited", v)} />
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <Label>Photos</Label>
            <div className="flex items-center gap-1.5">
              <Button size="sm" variant="default" className="h-7 px-2 text-xs" onClick={() => setCameraOpen(true)}>
                <Camera className="mr-1 h-3.5 w-3.5" /> Geo photo
              </Button>
              <label className="flex cursor-pointer items-center gap-1 rounded-md border border-border px-2 py-1 text-xs">
                {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />} Upload
                <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => addPhotos(e.target.files)} />
              </label>
            </div>
          </div>
          {(lead.photos?.length ?? 0) === 0 ? (
            <p className="rounded-md border border-dashed border-border p-3 text-center text-xs text-muted-foreground">No photos yet.</p>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {lead.photos.map((p) => (
                <a key={p.path} href={signedUrls[p.path]} target="_blank" rel="noreferrer" className="block">
                  <div className="aspect-square overflow-hidden rounded-md border bg-muted">
                    {signedUrls[p.path] ? (
                      <img src={signedUrls[p.path]} alt="lead" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">…</div>
                    )}
                  </div>
                  {p.lat != null && (
                    <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                      {p.lat.toFixed(4)},{p.lng?.toFixed(4)}{p.stamped ? " · stamped" : ""}
                    </p>
                  )}
                </a>
              ))}
            </div>
          )}
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <Label className="flex items-center gap-1"><SunMedium className="h-3.5 w-3.5 text-primary" /> Roof & solar plan</Label>
            <Button
              size="sm"
              variant="default"
              className="h-7 px-2 text-xs"
              onClick={() => setPlannerOpen(true)}
            >
              {planSummary ? "Edit plan" : "Plan roof"}
            </Button>
          </div>
          {planSummary ? (
            <div className="rounded-md border border-border bg-card p-3">
              <div className="grid grid-cols-3 gap-2 text-center">
                <Mini label="Panels" value={`${planSummary.active}/${planSummary.total}`} />
                <Mini label="System" value={`${planSummary.kw.toFixed(2)} kW`} accent />
                <Mini label="Azimuth" value={`${lead.roof_plan!.spec.azimuthDeg}° / ${lead.roof_plan!.spec.tiltDeg}°`} />
              </div>
            </div>
          ) : (
            <p className="rounded-md border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
              Draw the roof on satellite imagery, then auto-fit south-facing panels at 11° tilt.
            </p>
          )}
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <Label className="flex items-center gap-1"><Boxes className="h-3.5 w-3.5 text-primary" /> 3D design & report</Label>
            <Button size="sm" className="h-7 px-2 text-xs" onClick={() => setCadOpen(true)}>
              {lead.cad_design ? "Open design" : "Build 3D design"}
            </Button>
          </div>
          {lead.cad_design ? (
            <div className="rounded-md border border-border bg-card p-3">
              <div className="grid grid-cols-2 gap-2 text-center">
                <Mini label="Saved system" value={`${lead.cad_design.kw.toFixed(2)} kW`} accent />
                <Mini label="Saved on" value={new Date(lead.cad_design.savedAt).toLocaleDateString()} />
              </div>
              {(lead.cad_design.shots?.top || lead.cad_design.shots?.side) && (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {lead.cad_design.shots.top && (
                    <img src={lead.cad_design.shots.top} alt="3D top view" className="rounded border" />
                  )}
                  {lead.cad_design.shots.side && (
                    <img src={lead.cad_design.shots.side} alt="3D side view" className="rounded border" />
                  )}
                </div>
              )}
            </div>
          ) : (
            <p className="rounded-md border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
              Model the roof in 3D, run the shadow study and generate a full production + ROI report.
            </p>
          )}
        </div>

        <div className="flex gap-2 pt-2">
          <Button variant="outline" className="flex-1" onClick={remove}>
            <Trash2 className="mr-2 h-4 w-4" /> Delete
          </Button>
          <Button className="flex-1" onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Save className="mr-2 h-4 w-4" /> Save</>}
          </Button>
        </div>

        <Link
          to="/simulator"
          search={{ leadId: lead.id } as never}
          className="flex items-center justify-center gap-2 rounded-md border border-primary/40 bg-primary/10 px-3 py-2.5 text-sm font-semibold text-primary hover:bg-primary/15"
        >
          <Boxes className="h-4 w-4" /> Open 3D Solar Simulator
        </Link>
      </div>

      <GeoCamera
        open={cameraOpen}
        onOpenChange={setCameraOpen}
        fallbackLatLng={{ lat: lead.lat, lng: lead.lng }}
        onCaptured={onGeoCaptured}
      />

      <Dialog open={cadOpen} onOpenChange={setCadOpen}>
        <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto p-3 sm:p-5">
          <DialogHeader>
            <DialogTitle className="text-base">3D solar design — {lead.name || "Lead"}</DialogTitle>
          </DialogHeader>
          <CadStudio
            lat={lead.lat}
            lng={lead.lng}
            imageUrl={lead.photos?.[0] ? signedUrls[lead.photos[0].path] : null}
            initialModel={lead.cad_design?.model ?? null}
            reportMeta={{
              title: lead.name || `Lead ${lead.id.slice(0, 8)}`,
              customer: lead.name,
              phone: lead.phone,
              company: settings?.company_name,
              photos: (lead.photos ?? [])
                .filter((p) => signedUrls[p.path])
                .map((p) => ({ url: signedUrls[p.path], lat: p.lat, lng: p.lng })),
            }}
            onSaveDesign={async (model, shots) => {
              const design: SavedDesign = {
                model,
                shots,
                kw:
                  model.groups.reduce((a, g) => a + g.cols * g.rows, 0) * model.panel.watt / 1000,
                savedAt: new Date().toISOString(),
              };
              const { error } = await supabase
                .from("leads")
                .update({ cad_design: design as unknown as never })
                .eq("id", lead.id);
              if (error) return toast.error(error.message);
              setLead({ ...lead, cad_design: design });
              toast.success("3D design saved to this lead");
            }}
          />
        </DialogContent>
      </Dialog>

      <RoofPlanner
        open={plannerOpen}
        onOpenChange={setPlannerOpen}
        center={{ lat: lead.lat, lng: lead.lng }}
        initial={lead.roof_plan}
        onSave={async (plan) => {
          const active = plan.panels.length - (plan.disabled?.length ?? 0);
          const kwFromPlan = (active * plan.spec.watt) / 1000;
          const nextKw = lead.required_kw ?? Math.round(kwFromPlan * 100) / 100;
          const { error } = await supabase
            .from("leads")
            .update({ roof_plan: plan, required_kw: nextKw })
            .eq("id", lead.id);
          if (error) {
            toast.error(error.message);
            return;
          }
          setLead({ ...lead, roof_plan: plan, required_kw: nextKw });
          toast.success("Roof plan saved");
          setPlannerOpen(false);
        }}
      />
    </AppShell>
  );
}

function Mini({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`rounded-md border px-2 py-1.5 ${accent ? "border-primary/30 bg-primary/10" : ""}`}>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-sm font-bold ${accent ? "text-primary" : ""}`}>{value}</div>
    </div>
  );
}