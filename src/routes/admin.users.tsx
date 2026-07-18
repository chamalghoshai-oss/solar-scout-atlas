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
import { Loader2, MailPlus, Shield, Trash2, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { createAccessUser, DEFAULT_ACCESS_PASSWORD, resetAccessPassword } from "@/lib/users.functions";
import { useServerFn } from "@tanstack/react-start";

export const Route = createFileRoute("/admin/users")({
  head: () => ({ meta: [{ title: "Owner Access — VertX Field" }] }),
  component: AdminUsers,
});

type Profile = { id: string; full_name: string | null; email: string | null };
type Row = Profile & { roles: AppRole[] };
type AccessRow = { id: string; email: string; label: string | null; role: AppRole; track_phone: boolean };

function AdminUsers() {
  const auth = useAuth();
  const navigate = useNavigate();
  const createAccess = useServerFn(createAccessUser);
  const resetPassword = useServerFn(resetAccessPassword);
  const [rows, setRows] = useState<Row[]>([]);
  const [accessRows, setAccessRows] = useState<AccessRow[]>([]);
  const [newEmail, setNewEmail] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [newRole, setNewRole] = useState<AppRole>("field_staff");
  const canManage = auth.isOwner || auth.isManager;
  const roleOptions: AppRole[] = auth.isOwner ? ["owner", "manager", "field_staff"] : ["field_staff"];
  const [newTrackPhone, setNewTrackPhone] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!auth.loading && !canManage) navigate({ to: "/" });
  }, [auth.loading, canManage, navigate]);

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
    if (canManage) load();
  }, [canManage]);

  async function addAccess(e: React.FormEvent) {
    e.preventDefault();
    const cleanEmail = newEmail.trim().toLowerCase();
    setSaving(true);
    try {
      await createAccess({ data: { email: cleanEmail, label: newLabel.trim() || null, role: newRole, trackPhone: newTrackPhone } });
      toast.success(`Access saved · default password: ${DEFAULT_ACCESS_PASSWORD}`);
      setNewEmail("");
      setNewLabel("");
      setNewRole("field_staff");
      setNewTrackPhone(true);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save access");
    } finally {
      setSaving(false);
    }
  }

  async function handleResetPassword(email: string) {
    try {
      await resetPassword({ data: { email } });
      toast.success(`Password reset to ${DEFAULT_ACCESS_PASSWORD}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to reset password");
    }
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

  if (auth.loading || !canManage) {
    return <AppShell><div className="flex h-40 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div></AppShell>;
  }

  return (
    <AppShell>
      <header className="mb-4 flex items-center gap-2">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/15 text-primary"><Shield className="h-5 w-5" /></div>
        <div>
          <h1 className="text-xl font-bold">{auth.isOwner ? "Owner access" : "Team access"}</h1>
          <p className="text-xs text-muted-foreground">
            {auth.isOwner
              ? "Add owners, managers, or field staff and control phone tracking."
              : "Add and manage your field staff."}
          </p>
        </div>
      </header>

      <form onSubmit={addAccess} className="mb-4 space-y-3 rounded-xl border border-border bg-card p-3">
        <div>
          <Label>Email address</Label>
          <Input type="email" inputMode="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="name@example.com" required />
          <p className="mt-1 text-[11px] text-muted-foreground">Default password will be set to <span className="font-mono font-semibold">{DEFAULT_ACCESS_PASSWORD}</span></p>
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
                {roleOptions.includes("owner") && <SelectItem value="owner">Owner</SelectItem>}
                {roleOptions.includes("manager") && <SelectItem value="manager">Manager</SelectItem>}
                {roleOptions.includes("field_staff") && <SelectItem value="field_staff">Field Staff</SelectItem>}
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
            const isOwner = u.role === "owner";
            // Managers can only touch field_staff rows.
            const canEditRow = auth.isOwner || (auth.isManager && u.role === "field_staff");
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
                  <Select
                    value={u.role}
                    onValueChange={(v) => updateAccess(u.id, { role: v as AppRole })}
                    disabled={!canEditRow || u.email === auth.email?.toLowerCase() || !auth.isOwner}
                  >
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {auth.isOwner && <SelectItem value="owner">Owner</SelectItem>}
                      {auth.isOwner && <SelectItem value="manager">Manager</SelectItem>}
                      <SelectItem value="field_staff">Field Staff</SelectItem>
                    </SelectContent>
                  </Select>
                  <div className="flex h-8 items-center gap-2 rounded-md border border-border px-2">
                    <span className="text-[11px] text-muted-foreground">Track</span>
                    <Switch checked={u.track_phone} onCheckedChange={(v) => updateAccess(u.id, { track_phone: v })} disabled={!canEditRow} />
                  </div>
                  <Button type="button" size="icon" variant="outline" className="h-8 w-8" onClick={() => removeAccess(u)} disabled={!canEditRow || u.email === auth.email?.toLowerCase()} aria-label="Remove access">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <div className="mt-2 flex justify-end">
                  <Button type="button" size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => handleResetPassword(u.email)} disabled={!canEditRow}>
                    <KeyRound className="mr-1 h-3 w-3" /> Reset to default password
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