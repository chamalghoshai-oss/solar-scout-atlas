import { useEffect, useRef, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Camera, MapPin, Loader2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getDeviceId } from "@/lib/device";
import { uploadPhoto, type PhotoMeta } from "@/lib/photos";
import { toast } from "sonner";

export type LeadDraft = {
  /** "lead", "potential", or a user-defined category key */
  type: string;
  lat: number;
  lng: number;
};

export const STATUSES = [
  { value: "hot", label: "Hot" },
  { value: "warm", label: "Warm" },
  { value: "cold", label: "Cold (Quoted)" },
  { value: "reference", label: "Reference" },
  { value: "not_interested", label: "Not Interested" },
];

export function LeadFormSheet({
  open,
  onOpenChange,
  draft,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  draft: LeadDraft | null;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("+91");
  const [kw, setKw] = useState("");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState("hot");
  const [photos, setPhotos] = useState<PhotoMeta[]>([]);
  const [latStr, setLatStr] = useState("");
  const [lngStr, setLngStr] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setName("");
      setPhone("+91");
      setKw("");
      setNotes("");
      setStatus("hot");
      setPhotos([]);
      setLatStr(draft ? String(draft.lat.toFixed(6)) : "");
      setLngStr(draft ? String(draft.lng.toFixed(6)) : "");
    }
  }, [open, draft?.lat, draft?.lng]);

  if (!draft) return null;
  const isPotential = draft.type === "potential";
  const latNum = Number(latStr);
  const lngNum = Number(lngStr);
  const coordsValid =
    latStr.trim() !== "" &&
    lngStr.trim() !== "" &&
    Number.isFinite(latNum) &&
    Number.isFinite(lngNum) &&
    Math.abs(latNum) <= 90 &&
    Math.abs(lngNum) <= 180;

  async function handlePhotos(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    try {
      const geotag = draft ? { lat: draft.lat, lng: draft.lng } : null;
      const uploaded: PhotoMeta[] = [];
      for (const f of Array.from(files)) {
        uploaded.push(await uploadPhoto(f, geotag));
      }
      setPhotos((p) => [...p, ...uploaded]);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Upload failed";
      toast.error(msg);
    } finally {
      setUploading(false);
    }
  }

  async function save() {
    if (!draft) return;
    const la = Number(latStr);
    const ln = Number(lngStr);
    if (!Number.isFinite(la) || !Number.isFinite(ln) || Math.abs(la) > 90 || Math.abs(ln) > 180) {
      toast.error("Enter a valid latitude and longitude");
      return;
    }
    setBusy(true);
    try {
      const uid = (await supabase.auth.getSession()).data.session?.user?.id;
      if (!uid) throw new Error("Please sign in again");
      const payload = {
        device_id: getDeviceId(),
        user_id: uid,
        type: draft.type,
        lat: la,
        lng: ln,
        name: name.trim() || null,
        phone: phone.trim() || null,
        required_kw: kw ? Number(kw) : null,
        notes: notes.trim() || null,
        status,
        photos,
        visited: true,
      };
      const { error } = await supabase.from("leads").insert(payload);
      if (error) throw error;
      toast.success(isPotential ? "House pinned" : "Lead saved");
      onSaved();
      onOpenChange(false);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Save failed";
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[92dvh] overflow-y-auto rounded-t-2xl">
        <SheetHeader className="text-left">
          <SheetTitle>{isPotential ? "Mark potential house" : "New lead"}</SheetTitle>
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <MapPin className="h-3 w-3" />
            Pinned at {draft.lat.toFixed(5)}, {draft.lng.toFixed(5)}
          </p>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="lat">Latitude</Label>
              <Input
                id="lat"
                value={latStr}
                inputMode="decimal"
                onChange={(e) => setLatStr(e.target.value)}
                placeholder="11.25874"
              />
            </div>
            <div>
              <Label htmlFor="lng">Longitude</Label>
              <Input
                id="lng"
                value={lngStr}
                inputMode="decimal"
                onChange={(e) => setLngStr(e.target.value)}
                placeholder="75.78041"
              />
            </div>
          </div>
          {!coordsValid && (
            <p className="-mt-2 text-[11px] text-destructive">Enter valid coordinates (lat ±90, lng ±180).</p>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="name">Name</Label>
              <Input id="name" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} placeholder="Customer name" />
            </div>
            <div>
              <Label htmlFor="phone">Phone</Label>
              <Input id="phone" value={phone} maxLength={20} onChange={(e) => setPhone(e.target.value)} placeholder="+91…" inputMode="tel" />
            </div>
          </div>

          {!isPotential && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="kw">Required kW</Label>
                <Input id="kw" value={kw} type="number" inputMode="decimal" onChange={(e) => setKw(e.target.value)} placeholder="e.g. 5" />
              </div>
              <div>
                <Label>Status</Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          <div>
            <Label htmlFor="notes">Notes</Label>
            <Textarea id="notes" value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} placeholder="Roof type, access, follow-up time…" rows={3} />
          </div>

          <div>
            <Label>Photos (geotagged)</Label>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              className="hidden"
              onChange={(e) => handlePhotos(e.target.files)}
            />
            <div className="mt-2 flex flex-wrap gap-2">
              {photos.map((p, i) => (
                <div key={p.path} className="relative h-16 w-16 overflow-hidden rounded-md border bg-muted">
                  <div className="absolute inset-0 flex items-center justify-center text-[10px] text-muted-foreground">
                    Photo {i + 1}
                  </div>
                  <button
                    type="button"
                    onClick={() => setPhotos((arr) => arr.filter((x) => x.path !== p.path))}
                    className="absolute -right-1 -top-1 rounded-full bg-foreground/80 p-0.5 text-background"
                    aria-label="Remove"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="flex h-16 w-16 flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed border-border text-xs text-muted-foreground hover:bg-muted disabled:opacity-50"
              >
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
                <span>{uploading ? "Uploading" : "Add"}</span>
              </button>
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button className="flex-1" onClick={save} disabled={busy || !coordsValid}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}