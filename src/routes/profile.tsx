import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, ROLE_LABELS, type AppRole } from "@/lib/auth";
import { Loader2, User, Mail, Phone, Shield, Users as UsersIcon } from "lucide-react";

export const Route = createFileRoute("/profile")({
  head: () => ({ meta: [{ title: "Profile — VertX Field" }] }),
  component: ProfilePage,
});

type ProfileRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  designation: string | null;
  status: string | null;
  manager_id: string | null;
};

function ProfilePage() {
  const auth = useAuth();
  const [me, setMe] = useState<ProfileRow | null>(null);
  const [team, setTeam] = useState<Array<ProfileRow & { roles: AppRole[] }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    async function load() {
      if (!auth.userId) { setLoading(false); return; }
      const [meRes, profRes, rolesRes] = await Promise.all([
        supabase.from("profiles").select("id,full_name,email,phone,designation,status,manager_id").eq("id", auth.userId).maybeSingle(),
        supabase.from("profiles").select("id,full_name,email,phone,designation,status,manager_id").order("created_at", { ascending: true }),
        supabase.from("user_roles").select("user_id,role"),
      ]);
      if (!alive) return;
      setMe((meRes.data as ProfileRow) ?? null);
      const rolesByUser = new Map<string, AppRole[]>();
      for (const r of (rolesRes.data ?? []) as { user_id: string; role: AppRole }[]) {
        const arr = rolesByUser.get(r.user_id) ?? [];
        arr.push(r.role);
        rolesByUser.set(r.user_id, arr);
      }
      const rows = ((profRes.data ?? []) as ProfileRow[])
        .filter((p) => p.id !== auth.userId)
        .map((p) => ({ ...p, roles: rolesByUser.get(p.id) ?? [] }));
      setTeam(rows);
      setLoading(false);
    }
    load();
    return () => { alive = false; };
  }, [auth.userId]);

  if (auth.loading) {
    return <AppShell><div className="flex h-40 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div></AppShell>;
  }

  if (!auth.userId) {
    return (
      <AppShell>
        <div className="mx-auto max-w-md space-y-3 rounded-xl border border-border bg-card p-5 text-center">
          <User className="mx-auto h-8 w-8 text-muted-foreground" />
          <h1 className="text-lg font-semibold">Not signed in</h1>
          <p className="text-sm text-muted-foreground">Sign in with your Gmail to view your profile.</p>
          <Link to="/auth" className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Sign in</Link>
        </div>
      </AppShell>
    );
  }

  const primaryRole: AppRole = auth.roles[0] ?? "field_staff";
  const canSeeTeam = auth.isOwner || auth.isManager;

  return (
    <AppShell>
      <header className="mb-4 flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/15 text-primary text-lg font-semibold">
          {(me?.full_name ?? auth.email ?? "?").slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0">
          <h1 className="truncate text-xl font-bold">{me?.full_name ?? auth.fullName ?? "Profile"}</h1>
          <p className="text-xs text-muted-foreground">{ROLE_LABELS[primaryRole]}{me?.designation ? ` · ${me.designation}` : ""}</p>
        </div>
      </header>

      <section className="mb-6 space-y-2 rounded-xl border border-border bg-card p-4">
        <Row icon={<Mail className="h-4 w-4" />} label="Email" value={me?.email ?? auth.email} />
        <Row icon={<Phone className="h-4 w-4" />} label="Phone" value={me?.phone ?? "—"} />
        <Row icon={<Shield className="h-4 w-4" />} label="Access" value={auth.roles.map((r) => ROLE_LABELS[r]).join(", ") || "—"} />
        <Row icon={<User className="h-4 w-4" />} label="Status" value={me?.status ?? "active"} />
      </section>

      {canSeeTeam && (
        <section>
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
            <UsersIcon className="h-4 w-4" /> Team
          </h2>
          {loading ? (
            <div className="flex h-24 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
          ) : team.length === 0 ? (
            <p className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">No teammates visible yet.</p>
          ) : (
            <ul className="space-y-2">
              {team.map((p) => (
                <li key={p.id} className="rounded-xl border border-border bg-card p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{p.full_name ?? p.email}</p>
                      <p className="truncate text-[11px] text-muted-foreground">{p.email}{p.designation ? ` · ${p.designation}` : ""}</p>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {(p.roles.length ? p.roles : ["field_staff" as AppRole]).map((r) => (
                        <span key={r} className="rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
                          {ROLE_LABELS[r]}
                        </span>
                      ))}
                    </div>
                  </div>
                  {(p.phone || p.status) && (
                    <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                      {p.phone && <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" /> {p.phone}</span>}
                      {p.status && <span className="inline-flex items-center gap-1"><Shield className="h-3 w-3" /> {p.status}</span>}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </AppShell>
  );
}

function Row({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="inline-flex items-center gap-2 text-muted-foreground">{icon}{label}</span>
      <span className="truncate text-right font-medium text-foreground">{value}</span>
    </div>
  );
}