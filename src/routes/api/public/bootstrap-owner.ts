import { createFileRoute } from "@tanstack/react-router";

const OWNER_EMAIL = "chamalghosh.ai@gmail.com";
const OWNER_PASSWORD = "123456";

export const Route = createFileRoute("/api/public/bootstrap-owner")({
  server: {
    handlers: {
      GET: async () => runBootstrap(),
      POST: async () => runBootstrap(),
    },
  },
});

async function runBootstrap() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  // Ensure authorized_emails row exists as owner with tracking on.
  await supabaseAdmin
    .from("authorized_emails")
    .upsert(
      { email: OWNER_EMAIL, role: "owner", track_phone: true, label: "Owner" },
      { onConflict: "email" },
    );

  // Find or create the auth user.
  const { data: list, error: lErr } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (lErr) return Response.json({ ok: false, error: lErr.message }, { status: 500 });
  const existing = list.users.find((u) => u.email?.toLowerCase() === OWNER_EMAIL);

  if (!existing) {
    const { error: cErr } = await supabaseAdmin.auth.admin.createUser({
      email: OWNER_EMAIL,
      password: OWNER_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: "Chamal Ghosh" },
    });
    if (cErr) return Response.json({ ok: false, error: cErr.message }, { status: 500 });
    return Response.json({ ok: true, created: true, email: OWNER_EMAIL, password: OWNER_PASSWORD });
  }

  const { error: uErr } = await supabaseAdmin.auth.admin.updateUserById(existing.id, {
    password: OWNER_PASSWORD,
    email_confirm: true,
  });
  if (uErr) return Response.json({ ok: false, error: uErr.message }, { status: 500 });
  return Response.json({ ok: true, reset: true, email: OWNER_EMAIL, password: OWNER_PASSWORD });
}