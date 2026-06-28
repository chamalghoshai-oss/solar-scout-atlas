import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Camera, Loader2, RotateCcw, Check, X, MapPin } from "lucide-react";
import { uploadPhotoBlob } from "@/lib/photos";
import type { PhotoMeta } from "@/lib/photos";
import { toast } from "sonner";

type Fix = {
  lat: number;
  lng: number;
  accuracy: number;
  heading: number | null;
  ts: number;
};

export function GeoCamera({
  open,
  onOpenChange,
  fallbackLatLng,
  onCaptured,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  fallbackLatLng?: { lat: number; lng: number } | null;
  onCaptured: (photo: PhotoMeta) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const compassUnsub = useRef<(() => void) | null>(null);
  const [fix, setFix] = useState<Fix | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [heading, setHeading] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ blob: Blob; url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Start camera + GPS.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(null);
    setPreview(null);
    setFix(null);
    setAddress(null);

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Camera unavailable");
      }
    })();

    if ("geolocation" in navigator) {
      watchIdRef.current = navigator.geolocation.watchPosition(
        (p) => {
          setFix({
            lat: p.coords.latitude,
            lng: p.coords.longitude,
            accuracy: p.coords.accuracy ?? 0,
            heading: Number.isFinite(p.coords.heading as number) ? (p.coords.heading as number) : null,
            ts: p.timestamp,
          });
        },
        () => {},
        { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 }
      );
    }

    // Compass heading (DeviceOrientation).
    const onOrient = (e: DeviceOrientationEvent & { webkitCompassHeading?: number }) => {
      const h =
        typeof e.webkitCompassHeading === "number"
          ? e.webkitCompassHeading
          : e.alpha != null
            ? 360 - e.alpha
            : null;
      if (h != null && !Number.isNaN(h)) setHeading(h);
    };
    window.addEventListener("deviceorientation", onOrient as EventListener);
    compassUnsub.current = () => window.removeEventListener("deviceorientation", onOrient as EventListener);
    // iOS permission
    const Req = (DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> })
      .requestPermission;
    if (typeof Req === "function") {
      Req().catch(() => {});
    }

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
      compassUnsub.current?.();
      compassUnsub.current = null;
    };
  }, [open]);

  // Reverse-geocode address (debounced).
  useEffect(() => {
    if (!fix) return;
    let cancelled = false;
    const t = window.setTimeout(async () => {
      try {
        const u = `https://connector-gateway.lovable.dev/google_maps/maps/api/geocode/json?latlng=${fix.lat},${fix.lng}`;
        const r = await fetch(u, {
          headers: {
            Authorization: `Bearer ${import.meta.env.VITE_LOVABLE_API_KEY ?? ""}`,
            "X-Connection-Api-Key": import.meta.env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_API_KEY ?? "",
          },
        });
        if (!r.ok) return;
        const j = await r.json();
        if (!cancelled && j?.results?.[0]?.formatted_address) setAddress(j.results[0].formatted_address);
      } catch {
        /* ignore */
      }
    }, 800);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [fix?.lat, fix?.lng]);

  function snapshot() {
    const v = videoRef.current;
    if (!v || !v.videoWidth) {
      toast.error("Camera not ready");
      return;
    }
    const w = v.videoWidth;
    const h = v.videoHeight;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(v, 0, 0, w, h);

    // Stamp overlay
    const now = new Date();
    const lat = fix?.lat ?? fallbackLatLng?.lat;
    const lng = fix?.lng ?? fallbackLatLng?.lng;
    const acc = fix?.accuracy;
    const lines = [
      `${now.toLocaleString()}`,
      lat != null && lng != null ? `${lat.toFixed(6)}, ${lng.toFixed(6)}${acc ? `  ±${Math.round(acc)} m` : ""}` : "Location unavailable",
      heading != null ? `Heading ${Math.round(heading)}° ${compass(heading)}` : "",
      address ?? "",
    ].filter(Boolean) as string[];

    const pad = Math.round(w * 0.018);
    const font = Math.max(18, Math.round(w * 0.022));
    ctx.font = `600 ${font}px system-ui, -apple-system, Segoe UI, sans-serif`;
    const lineH = Math.round(font * 1.35);
    const boxH = lines.length * lineH + pad * 2;
    // semi-transparent bar
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, h - boxH, w, boxH);
    // accent stripe
    ctx.fillStyle = "#f59e0b";
    ctx.fillRect(0, h - boxH, Math.round(w * 0.012), boxH);
    ctx.fillStyle = "#ffffff";
    ctx.textBaseline = "top";
    lines.forEach((ln, i) => {
      ctx.fillText(ln, pad + Math.round(w * 0.02), h - boxH + pad + i * lineH);
    });

    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        setPreview({ blob, url });
      },
      "image/jpeg",
      0.9
    );
  }

  async function confirm() {
    if (!preview) return;
    setBusy(true);
    try {
      const lat = fix?.lat ?? fallbackLatLng?.lat ?? null;
      const lng = fix?.lng ?? fallbackLatLng?.lng ?? null;
      const meta = await uploadPhotoBlob(preview.blob, {
        lat,
        lng,
        accuracy: fix?.accuracy ?? null,
        heading: heading ?? fix?.heading ?? null,
        address,
      });
      onCaptured(meta);
      URL.revokeObjectURL(preview.url);
      onOpenChange(false);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  function retake() {
    if (preview) URL.revokeObjectURL(preview.url);
    setPreview(null);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[100dvh] max-h-[100dvh] w-full max-w-full gap-0 rounded-none border-0 bg-black p-0 text-white sm:rounded-none">
        <DialogHeader className="border-b border-white/10 bg-black/60 px-3 py-2">
          <DialogTitle className="text-base text-white">Geotag photo</DialogTitle>
        </DialogHeader>

        <div className="relative flex-1 overflow-hidden bg-black">
          {!preview ? (
            <video ref={videoRef} className="h-full w-full object-cover" muted playsInline autoPlay />
          ) : (
            <img src={preview.url} className="h-full w-full object-contain" alt="capture" />
          )}

          {/* Live geo readout overlay */}
          {!preview && (
            <div className="pointer-events-none absolute inset-x-0 bottom-24 mx-3 rounded-lg bg-black/55 p-2 text-[11px] leading-tight">
              <div className="flex items-center gap-1 font-semibold">
                <MapPin className="h-3.5 w-3.5 text-amber-400" />
                {fix ? `${fix.lat.toFixed(6)}, ${fix.lng.toFixed(6)} · ±${Math.round(fix.accuracy)} m` : "Acquiring GPS…"}
              </div>
              {heading != null && (
                <div className="mt-0.5 opacity-90">Heading {Math.round(heading)}° {compass(heading)}</div>
              )}
              {address && <div className="mt-0.5 truncate opacity-90">{address}</div>}
              <div className="mt-0.5 opacity-70">{new Date().toLocaleString()}</div>
            </div>
          )}

          {error && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/70 p-6 text-center text-sm">
              {error}
            </div>
          )}

          {/* Bottom controls */}
          <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-6 bg-gradient-to-t from-black/80 to-transparent p-4 pb-6">
            {preview ? (
              <>
                <Button variant="secondary" onClick={retake} disabled={busy} className="h-12 rounded-full px-5">
                  <RotateCcw className="mr-1 h-4 w-4" /> Retake
                </Button>
                <Button onClick={confirm} disabled={busy} className="h-12 rounded-full bg-amber-500 px-5 text-black hover:bg-amber-400">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Check className="mr-1 h-4 w-4" /> Use photo</>}
                </Button>
              </>
            ) : (
              <>
                <button
                  onClick={() => onOpenChange(false)}
                  className="flex h-12 w-12 items-center justify-center rounded-full bg-white/15 backdrop-blur"
                  aria-label="Close"
                >
                  <X className="h-5 w-5" />
                </button>
                <button
                  onClick={snapshot}
                  className="h-16 w-16 rounded-full border-4 border-white bg-white/10 backdrop-blur active:scale-95"
                  aria-label="Capture"
                >
                  <Camera className="mx-auto h-6 w-6" />
                </button>
                <div className="h-12 w-12" />
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function compass(deg: number): string {
  const d = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return d[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
}