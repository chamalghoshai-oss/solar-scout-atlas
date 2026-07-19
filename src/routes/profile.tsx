import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, ROLE_LABELS, type AppRole } from "@/lib/auth";
import { Loader2, User, Mail, Phone, Shield, Users as UsersIcon, ChevronRight, MapPin, Route as RouteIcon } from "lucide-react";

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

type Stats = { leads: number; runs: number };
type Node = ProfileRow & { roles: AppRole[]; stats: Stats; children: Node[] };

function ProfilePage() {
  const auth = useAuth();
  const [me, setMe] = useState<ProfileRow | null>(null);
  const [tree, setTree] = useState<Node[]>([]);
  const [mineStats, setMineStats] = useState<Stats>({ leads: 0, runs: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    async function load() {
      if (!auth.userId) { setLoading(false); return; }
      const [meRes, profRes, rolesRes, leadsRes, runsRes] = await Promise.all([
        supabase.from("profiles").select("id,full_name,email,phone,designation,status,manager_id").eq("id", auth.userId).maybeSingle(),
        supabase.from("profiles").select("id,full_name,email,phone,designation,status,manager_id").order("created_at", { ascending: true }),
        supabase.from("user_roles").select("user_id,role"),
        supabase.from("leads").select("user_id"),
        supabase.from("runs").select("user_id"),
      ]);
      if (!alive) return;
      setMe((meRes.data as ProfileRow) ?? null);

      const rolesByUser = new Map<string, AppRole[]>();
      for (const r of (rolesRes.data ?? []) as { user_id: string; role: AppRole }[]) {
        const arr = rolesByUser.get(r.user_id) ?? [];
        arr.push(r.role);
        rolesByUser.set(r.user_id, arr);
      }

      const leadsByUser = new Map<string, number>();
      for (const r of (leadsRes.data ?? []) as { user_id: string | null }[]) {
        if (!r.user_id) continue;
        leadsByUser.set(r.user_id, (leadsByUser.get(r.user_id) ?? 0) + 1);
      }
      const runsByUser = new Map<string, number>();
      for (const r of (runsRes.data ?? []) as { user_id: string | null }[]) {
        if (!r.user_id) continue;
        runsByUser.set(r.user_id, (runsByUser.get(r.user_id) ?? 0) + 1);
      }

      const allRows = (profRes.data ?? []) as ProfileRow[];
      const byId = new Map<string, Node>();
      for (const p of allRows) {
        byId.set(p.id, {
          ...p,
          roles: rolesByUser.get(p.id) ?? [],
          stats: { leads: leadsByUser.get(p.id) ?? 0, runs: runsByUser.get(p.id) ?? 0 },
          children: [],
        });
      }

      // Build hierarchy: explicit manager_id links, plus role-based fallback
      // (owner → managers with no manager_id → field staff with no manager_id).
      const owners: Node[] = [];
      const managers: Node[] = [];
      const staffOrphans: Node[] = [];
      for (const n of byId.values()) {
        if (n.manager_id && byId.has(n.manager_id)) {
          byId.get(n.manager_id)!.children.push(n);
          continue;
        }
        if (n.roles.includes("owner")) owners.push(n);
        else if (n.roles.includes("manager")) managers.push(n);
        else staffOrphans.push(n);
      }
      // Under each owner, attach managers without explicit manager_id.
      for (const o of owners) {
        for (const m of managers) if (!o.children.includes(m)) o.children.push(m);
        // Orphan staff visible to owner
        for (const s of staffOrphans) if (!o.children.includes(s)) o.children.push(s);
      }

      // Roots to render below current user: their own downward subtree.
      const meNode = byId.get(auth.userId);
      const rootChildren = meNode ? meNode.children : [];
      setTree(rootChildren);
      setMineStats(meNode?.stats ?? { leads: 0, runs: 0 });
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
        <div className="mt-2 grid grid-cols-2 gap-2 pt-2">
          <StatChip icon={<MapPin className="h-3.5 w-3.5" />} label="Leads" value={mineStats.leads} />
          <StatChip icon={<RouteIcon className="h-3.5 w-3.5" />} label="Runs" value={mineStats.runs} />
        </div>
      </section>

      {canSeeTeam && (
        <section>
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
            <UsersIcon className="h-4 w-4" /> Hierarchy · view only
          </h2>
          {loading ? (
            <div className="flex h-24 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
          ) : tree.length === 0 ? (
            <p className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">No teammates visible yet.</p>
          ) : (
            <ul className="space-y-2">
              {tree.map((n) => <TreeNode key={n.id} node={n} depth={0} />)}
            </ul>
          )}
        </section>
      )}
    </AppShell>
  );
}

function TreeNode({ node, depth }: { node: Node; depth: number }) {
  const [open, setOpen] = useState(true);
  const hasKids = node.children.length > 0;
  const primary: AppRole = node.roles[0] ?? "field_staff";
  return (
    <li>
      <div
        className="rounded-xl border border-border bg-card p-3"
        style={{ marginLeft: depth * 12 }}
      >
        <div className="flex items-center gap-2">
          {hasKids ? (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="flex h-6 w-6 flex-none items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
              aria-label={open ? "Collapse" : "Expand"}
            >
              <ChevronRight className={`h-4 w-4 transition-transform ${open ? "rotate-90" : ""}`} />
            </button>
          ) : (
            <span className="h-6 w-6 flex-none" />
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{node.full_name ?? node.email}</p>
            <p className="truncate text-[11px] text-muted-foreground">
              {node.email}
              {node.designation ? ` · ${node.designation}` : ""}
            </p>
          </div>
          <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
            {ROLE_LABELS[primary]}
          </span>
        </div>
        <div className="mt-2 flex flex-wrap gap-3 pl-8 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" /> {node.stats.leads} leads</span>
          <span className="inline-flex items-center gap-1"><RouteIcon className="h-3 w-3" /> {node.stats.runs} runs</span>
          {node.phone && <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" /> {node.phone}</span>}
          {node.status && <span className="inline-flex items-center gap-1"><Shield className="h-3 w-3" /> {node.status}</span>}
        </div>
      </div>
      {hasKids && open && (
        <ul className="mt-2 space-y-2">
          {node.children.map((c) => <TreeNode key={c.id} node={c} depth={depth + 1} />)}
        </ul>
      )}
    </li>
  );
}

function StatChip({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2 text-xs">
      <span className="inline-flex items-center gap-1.5 text-muted-foreground">{icon}{label}</span>
      <span className="font-semibold text-foreground">{value}</span>
    </div>
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