import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, type AppRole } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Loader2, MailPlus, Shield, Trash2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/users")({
  head: () => ({ meta: [{ title: "Users — VertX Field" }] }),
  component: AdminUsers,
});

type Profile = { id: string; full_name: string | null; email: string | null };
type Row = Profile & { roles: AppRole[] };
type AccessRow = { id: string; email: string; label: string | null; role: AppRole; track_phone: boolean };

function AdminUsers() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState<Row[]>([]);
  const [accessRows, setAccessRows] = useState<AccessRow[]>([]);
  const [newEmail, setNewEmail] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [newRole, setNewRole] = useState<AppRole>("surveyor");
  const [newTrackPhone, setNewTrackPhone] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!auth.loading && !auth.isAdmin) navigate({ to: "/" });
  }, [auth, navigate]);

  async function load() {
    setLoading(true);
    const [p, r, a] = await Promise.all([
      supabase.from("profiles").select("id,full_name,email").order("created_at", { ascending: true }),
      supabase.from("user_roles").select("user_id,role"),
      supabase.from("authorized_emails").select("id,email,label,role,track_phone").order("created_at", { ascending: true }),
    ]);
    const rolesByUser = new Map<string, AppRole[]>();
    for (const row of (r.data ?? []) as { user_id: string; role: AppRole }[]) {
      const arr = rolesByUser.get(row.user_id) ?? [];
      arr.push(row.role);
      rolesByUser.set(row.user_id, arr);
    }
    setRows(((p.data ?? []) as Profile[]).map((u) => ({ ...u, roles: rolesByUser.get(u.id) ?? [] })));
    setAccessRows((a.data as AccessRow[]) ?? []);
    setLoading(false);
  }
  useEffect(() => {
    if (auth.isAdmin) load();
  }, [auth.isAdmin]);

  async function addAccess(e: React.FormEvent) {
    e.preventDefault();
    const cleanEmail = newEmail.trim().toLowerCase();
    if (!cleanEmail.endsWith("@gmail.com")) {
      toast.error("Only Gmail addresses can be added.");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("authorized_emails").upsert({
      email: cleanEmail,
      label: newLabel.trim() || null,
      role: newRole,
      track_phone: newTrackPhone,
      created_by: auth.userId,
    }, { onConflict: "email" });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Access saved");
    setNewEmail("");
    setNewLabel("");
    setNewRole("surveyor");
    setNewTrackPhone(true);
    load();
  }

  async function updateAccess(id: string, patch: Partial<Pick<AccessRow, "role" | "track_phone" | "label">>) {
    const { error } = await supabase.from("authorized_emails").update(patch).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Access updated");
    load();
  }

  async function removeAccess(row: AccessRow) {
    if (row.email === auth.email?.toLowerCase()) {
      toast.error("You cannot remove your own owner access.");
      return;
    }
    const { error } = await supabase.from("authorized_emails").delete().eq("id", row.id);
    if (error) return toast.error(error.message);
    toast.success("Access removed");
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
          <h1 className="text-xl font-bold">Owner access</h1>
          <p className="text-xs text-muted-foreground">Add Gmail access and phone tracking permission</p>
        </div>
      </header>

      <form onSubmit={addAccess} className="mb-4 space-y-3 rounded-xl border border-border bg-card p-3">
        <div>
          <Label>Gmail address</Label>
          <Input type="email" inputMode="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="name@gmail.com" required />
        </div>
        <div>
          <Label>Name</Label>
          <Input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="Optional" maxLength={80} />
        </div>
        <div className="grid grid-cols-[1fr_auto] items-end gap-3">
          <div>
            <Label>Access level</Label>
            <Select value={newRole} onValueChange={(v) => setNewRole(v as AppRole)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">Owner</SelectItem>
                <SelectItem value="surveyor">Team</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex h-9 items-center gap-2 rounded-md border border-border px-3">
            <Label className="text-xs">Track phone</Label>
            <Switch checked={newTrackPhone} onCheckedChange={setNewTrackPhone} />
          </div>
        </div>
        <Button className="w-full" disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <><MailPlus className="mr-2 h-4 w-4" /> Save access</>}
        </Button>
      </form>

      {loading ? (
        <div className="flex h-40 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
      ) : accessRows.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">No emails added yet.</p>
      ) : (
        <ul className="space-y-2">
          {accessRows.map((u) => {
            const signedInUser = rows.find((row) => row.email?.toLowerCase() === u.email.toLowerCase());
            const isOwner = u.role === "admin";
            return (
              <li key={u.id} className="rounded-xl border border-border bg-card p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{u.label || signedInUser?.full_name || u.email}</p>
                    <p className="truncate text-[11px] text-muted-foreground">{u.email}{signedInUser ? " · signed in" : ""}</p>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <span className={isOwner ? "rounded-full border border-primary/40 px-2 py-0.5 text-[10px] font-semibold uppercase text-primary" : "rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground"}>{isOwner ? "Owner" : "Team"}</span>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-[1fr_auto_auto] items-center gap-2">
                  <Select value={u.role} onValueChange={(v) => updateAccess(u.id, { role: v as AppRole })} disabled={u.email === auth.email?.toLowerCase()}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin">Owner</SelectItem>
                      <SelectItem value="surveyor">Team</SelectItem>
                    </SelectContent>
                  </Select>
                  <div className="flex h-8 items-center gap-2 rounded-md border border-border px-2">
                    <span className="text-[11px] text-muted-foreground">Track</span>
                    <Switch checked={u.track_phone} onCheckedChange={(v) => updateAccess(u.id, { track_phone: v })} />
                  </div>
                  <Button type="button" size="icon" variant="outline" className="h-8 w-8" onClick={() => removeAccess(u)} disabled={u.email === auth.email?.toLowerCase()} aria-label="Remove access">
                    <Trash2 className="h-3.5 w-3.5" />
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