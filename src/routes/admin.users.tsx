import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, type AppRole } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Loader2, Shield, ShieldCheck, ShieldOff } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/users")({
  head: () => ({ meta: [{ title: "Users — VertX Field" }] }),
  component: AdminUsers,
});

type Profile = { id: string; full_name: string | null; email: string | null };
type Row = Profile & { roles: AppRole[] };

function AdminUsers() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!auth.loading && !auth.isAdmin) navigate({ to: "/" });
  }, [auth, navigate]);

  async function load() {
    setLoading(true);
    const [p, r] = await Promise.all([
      supabase.from("profiles").select("id,full_name,email").order("created_at", { ascending: true }),
      supabase.from("user_roles").select("user_id,role"),
    ]);
    const rolesByUser = new Map<string, AppRole[]>();
    for (const row of (r.data ?? []) as { user_id: string; role: AppRole }[]) {
      const arr = rolesByUser.get(row.user_id) ?? [];
      arr.push(row.role);
      rolesByUser.set(row.user_id, arr);
    }
    setRows(((p.data ?? []) as Profile[]).map((u) => ({ ...u, roles: rolesByUser.get(u.id) ?? [] })));
    setLoading(false);
  }
  useEffect(() => {
    if (auth.isAdmin) load();
  }, [auth.isAdmin]);

  async function setRole(uid: string, role: AppRole, on: boolean) {
    if (on) {
      const { error } = await supabase.from("user_roles").insert({ user_id: uid, role });
      if (error) return toast.error(error.message);
    } else {
      const { error } = await supabase.from("user_roles").delete().eq("user_id", uid).eq("role", role);
      if (error) return toast.error(error.message);
    }
    toast.success("Role updated");
    load();
  }

  if (auth.loading || !auth.isAdmin) {
    return <AppShell><div className="flex h-40 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div></AppShell>;
  }

  return (
    <AppShell>
      <header className="mb-4 flex items-center gap-2">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/15 text-primary"><Shield className="h-5 w-5" /></div>
        <div>
          <h1 className="text-xl font-bold">Users & roles</h1>
          <p className="text-xs text-muted-foreground">Manage admin and surveyor access</p>
        </div>
      </header>

      {loading ? (
        <div className="flex h-40 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
      ) : rows.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">No users yet.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((u) => {
            const isAdmin = u.roles.includes("admin");
            const isSurveyor = u.roles.includes("surveyor");
            return (
              <li key={u.id} className="rounded-xl border border-border bg-card p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{u.full_name || u.email || u.id}</p>
                    <p className="truncate text-[11px] text-muted-foreground">{u.email}</p>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <span className={isAdmin ? "rounded-full border border-primary/40 px-2 py-0.5 text-[10px] font-semibold uppercase text-primary" : "hidden"}>Admin</span>
                    <span className={isSurveyor ? "rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground" : "hidden"}>Surveyor</span>
                  </div>
                </div>
                <div className="mt-3 flex gap-2">
                  <Button size="sm" variant={isAdmin ? "outline" : "default"} className="h-8 flex-1 text-xs"
                    disabled={u.id === auth.userId && isAdmin}
                    onClick={() => setRole(u.id, "admin", !isAdmin)}>
                    {isAdmin ? <><ShieldOff className="mr-1 h-3.5 w-3.5" /> Revoke admin</> : <><ShieldCheck className="mr-1 h-3.5 w-3.5" /> Make admin</>}
                  </Button>
                  <Button size="sm" variant={isSurveyor ? "outline" : "default"} className="h-8 flex-1 text-xs"
                    onClick={() => setRole(u.id, "surveyor", !isSurveyor)}>
                    {isSurveyor ? "Revoke surveyor" : "Make surveyor"}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </AppShell>
  );
}