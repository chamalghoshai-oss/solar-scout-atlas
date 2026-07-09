import { supabase } from "@/integrations/supabase/client";

/**
 * Uploads a single file to the `sim-uploads` bucket under the current user's
 * folder. RLS enforces that the first path segment matches the user's id.
 */
export async function uploadSimFile(userId: string, file: File): Promise<string> {
  const ext = (file.name.split(".").pop() || "bin").toLowerCase();
  const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage.from("sim-uploads").upload(path, file, {
    cacheControl: "3600",
    upsert: false,
    contentType: file.type || "application/octet-stream",
  });
  if (error) throw error;
  return path;
}

export async function signSimUrls(paths: string[]): Promise<Record<string, string>> {
  if (!paths.length) return {};
  const { data } = await supabase.storage.from("sim-uploads").createSignedUrls(paths, 60 * 60);
  const out: Record<string, string> = {};
  data?.forEach((d) => {
    if (d.path && d.signedUrl) out[d.path] = d.signedUrl;
  });
  return out;
}

export function isVideo(path: string): boolean {
  return /\.(mp4|mov|webm|m4v|avi)$/i.test(path);
}