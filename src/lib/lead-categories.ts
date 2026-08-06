import { supabase } from "@/integrations/supabase/client";

export type LeadCategory = {
  id: string;
  key: string;
  label: string;
  color: string;
};

/** Built-in categories that always exist. */
export const BUILTIN_CATEGORIES: LeadCategory[] = [
  { id: "builtin-lead", key: "lead", label: "Leads", color: "#ea7a1d" },
  { id: "builtin-potential", key: "potential", label: "Potential houses", color: "#3b82f6" },
];

export const BUILTIN_KEYS = BUILTIN_CATEGORIES.map((c) => c.key);

export function slugify(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);
}

export async function fetchCategories(): Promise<LeadCategory[]> {
  const { data } = await supabase
    .from("lead_categories")
    .select("id,key,label,color")
    .order("created_at", { ascending: true });
  return (data as LeadCategory[]) ?? [];
}

export async function createCategory(label: string, color: string): Promise<LeadCategory> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) throw new Error("Please sign in first");
  const key = slugify(label);
  if (!key) throw new Error("Enter a valid name");
  if (BUILTIN_KEYS.includes(key)) throw new Error("That name is already used");
  const { data, error } = await supabase
    .from("lead_categories")
    .insert({ user_id: userId, key, label: label.trim(), color })
    .select("id,key,label,color")
    .single();
  if (error) throw error;
  return data as LeadCategory;
}

export async function deleteCategory(id: string): Promise<void> {
  const { error } = await supabase.from("lead_categories").delete().eq("id", id);
  if (error) throw error;
}

/** Colour for a pin, given its category key and lead status. */
export function colorForType(
  type: string,
  status: string,
  categories: LeadCategory[],
  statusColor: (status: string) => string
): string {
  if (type === "potential") return "#3b82f6";
  if (type !== "lead") {
    const c = categories.find((x) => x.key === type);
    if (c) return c.color;
  }
  return statusColor(status);
}

export const CATEGORY_COLOR_CHOICES = [
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
  "#14b8a6",
  "#22c55e",
  "#eab308",
  "#f97316",
  "#dc2626",
  "#0ea5e9",
  "#6b7280",
];