import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type AppRoleInput = "owner" | "manager" | "field_staff";

export const DEFAULT_ACCESS_PASSWORD = "123456";

export const createAccessUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { email: string; label?: string | null; role: AppRoleInput; trackPhone: boolean }) => {
    const email = data.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Invalid email");
    if (!["owner", "manager", "field_staff"].includes(data.role)) throw new Error("Invalid role");
    return { email, label: data.label?.trim() || null, role: data.role, trackPhone: !!data.trackPhone };
  })
  .handler(async ({ data, context }) => {
    const [{ data: isOwner }, { data: isManager }] = await Promise.all([
      context.supabase.rpc("is_owner", { _user_id: context.userId }),
      context.supabase.rpc("is_manager", { _user_id: context.userId }),
    ]);
    if (!isOwner && !isManager) throw new Error("Forbidden");
    // Managers can only create field_staff.
    if (!isOwner && data.role !== "field_staff") throw new Error("Managers can only create field staff");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Upsert authorized_emails row
    const { error: aeErr } = await context.supabase
      .from("authorized_emails")
      .upsert(
        { email: data.email, label: data.label, role: data.role, track_phone: data.trackPhone, created_by: context.userId },
        { onConflict: "email" },
      );
    if (aeErr) throw new Error(aeErr.message);

    // Create auth user with default password (idempotent: ignore "already registered")
    const { data: created, error: cErr } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: DEFAULT_ACCESS_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: data.label ?? data.email },
    });
    if (cErr && !/already/i.test(cErr.message)) throw new Error(cErr.message);

    return { ok: true, userId: created?.user?.id ?? null, defaultPassword: DEFAULT_ACCESS_PASSWORD };
  });

export const resetAccessPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { email: string }) => {
    const email = data.email.trim().toLowerCase();
    if (!email) throw new Error("Invalid email");
    return { email };
  })
  .handler(async ({ data, context }) => {
    const [{ data: isOwner }, { data: isManager }] = await Promise.all([
      context.supabase.rpc("is_owner", { _user_id: context.userId }),
      context.supabase.rpc("is_manager", { _user_id: context.userId }),
    ]);
    if (!isOwner && !isManager) throw new Error("Forbidden");
    // Managers can only reset field_staff passwords.
    if (!isOwner) {
      const { data: ae } = await context.supabase
        .from("authorized_emails")
        .select("role")
        .eq("email", data.email)
        .maybeSingle();
      if (!ae || ae.role !== "field_staff") throw new Error("Managers can only reset field staff");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: list, error: lErr } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
    if (lErr) throw new Error(lErr.message);
    const target = list.users.find((u) => u.email?.toLowerCase() === data.email);
    if (!target) throw new Error("User not found");
    const { error: uErr } = await supabaseAdmin.auth.admin.updateUserById(target.id, { password: DEFAULT_ACCESS_PASSWORD });
    if (uErr) throw new Error(uErr.message);
    return { ok: true, defaultPassword: DEFAULT_ACCESS_PASSWORD };
  });