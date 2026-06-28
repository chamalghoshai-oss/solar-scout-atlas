import { supabase } from "@/integrations/supabase/client";
import { getDeviceId } from "./device";

export type PhotoMeta = {
  path: string;
  lat?: number | null;
  lng?: number | null;
  ts: string;
  accuracy?: number | null;
  heading?: number | null;
  address?: string | null;
  stamped?: boolean;
};

export async function uploadPhoto(file: File, geotag?: { lat: number; lng: number } | null): Promise<PhotoMeta> {
  const device = getDeviceId();
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  const path = `${device}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage.from("lead-photos").upload(path, file, {
    cacheControl: "3600",
    upsert: false,
    contentType: file.type || "image/jpeg",
  });
  if (error) throw error;
  return { path, lat: geotag?.lat ?? null, lng: geotag?.lng ?? null, ts: new Date().toISOString() };
}

export async function uploadPhotoBlob(
  blob: Blob,
  extra: Partial<PhotoMeta> & { lat?: number | null; lng?: number | null }
): Promise<PhotoMeta> {
  const device = getDeviceId();
  const path = `${device}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  const { error } = await supabase.storage.from("lead-photos").upload(path, blob, {
    cacheControl: "3600",
    upsert: false,
    contentType: "image/jpeg",
  });
  if (error) throw error;
  return {
    path,
    ts: new Date().toISOString(),
    stamped: true,
    lat: extra.lat ?? null,
    lng: extra.lng ?? null,
    accuracy: extra.accuracy ?? null,
    heading: extra.heading ?? null,
    address: extra.address ?? null,
  };
}

export async function getSignedUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from("lead-photos").createSignedUrl(path, 60 * 60);
  if (error || !data) return "";
  return data.signedUrl;
}

export async function getSignedUrls(paths: string[]): Promise<Record<string, string>> {
  if (!paths.length) return {};
  const { data } = await supabase.storage.from("lead-photos").createSignedUrls(paths, 60 * 60);
  const out: Record<string, string> = {};
  data?.forEach((d) => {
    if (d.path && d.signedUrl) out[d.path] = d.signedUrl;
  });
  return out;
}