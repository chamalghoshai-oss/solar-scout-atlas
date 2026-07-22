import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { ROLE_LABELS, type AppRole } from "@/lib/auth";
import {
  Loader2, User, Mail, Phone, Shield, Users as UsersIcon,
  ChevronRight, MapPin, Route as RouteIcon, ArrowLeft, Clock, Zap,
} from "lucide-react";

export const Route = createFileRoute("/profile/$userId")({
  head: () => ({ meta: [{ title: "Team member — VertX Field" }] }),
  component: TeamMemberProfile,
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

type LeadRow = {
  id: string;
  name: string | null;
  phone: string | null;
  required_kw: number | null;
  status: string;
  type: string;
  created_at: string;
};

type RunRow = {
  id: string;
  distance_m: number | null;
  started_at: string | null;
  ended_at: string | null;
};

type Sub = ProfileRow & { roles: AppRole[]; leadsCount: number; runsCount: number };

function TeamMemberProfile() {
  const { userId } = Route.useParams();
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [subs, setSubs] = useState<Sub[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    async function load() {
      setLoading(true);
      const [pRes, rRes, lRes, runRes, childrenRes] = await Promise.all([
        supabase.from("profiles").select("id,full_name,email,phone,designation,status,manager_id").eq("id", userId).maybeSingle(),
        supabase.from("user_roles").select("role").eq("user_id", userId),
        supabase.from("leads").select("id,name,phone,required_kw,status,type,created_at").eq("user_id", userId).order("created_at", { ascending: false }),
        supabase.from("runs").select("id,distance_m,started_at,ended_at").eq("user_id", userId).order("started_at", { ascending: false }),
        supabase.from("profiles").select("id,full_name,email,phone,designation,status,manager_id").eq("manager_id", userId),
      ]);
      if (!alive) return;
      setProfile((pRes.data as ProfileRow) ?? null);
      setRoles(((rRes.data ?? []) as { role: AppRole }[]).map((r) => r.role));
      setLeads((lRes.data ?? []) as LeadRow[]);
      setRuns((runRes.data ?? []) as RunRow[]);

      const kids = (childrenRes.data ?? []) as ProfileRow[];
      if (kids.length) {
        const ids = kids.map((k) => k.id);
        const [kRoles, kLeads, kRuns] = await Promise.all([
          supabase.from("user_roles").select("user_id,role").in("user_id", ids),
          supabase.from("leads").select("user_id").in("user_id", ids),
          supabase.from("runs").select("user_id").in("user_id", ids),
        ]);
        if (!alive) return;
        const rolesByUser = new Map<string, AppRole[]>();
        for (const r of (kRoles.data ?? []) as { user_id: string; role: AppRole }[]) {
          const a = rolesByUser.get(r.user_id) ?? []; a.push(r.role); rolesByUser.set(r.user_id, a);
        }
        const leadsByUser = new Map<string, number>();
        for (const r of (kLeads.data ?? []) as { user_id: string }[]) leadsByUser.set(r.user_id, (leadsByUser.get(r.user_id) ?? 0) + 1);
        const runsByUser = new Map<string, number>();
        for (const r of (kRuns.data ?? []) as { user_id: string }[]) runsByUser.set(r.user_id, (runsByUser.get(r.user_id) ?? 0) + 1);
        setSubs(kids.map((k) => ({
          ...k,
          roles: rolesByUser.get(k.id) ?? [],
          leadsCount: leadsByUser.get(k.id) ?? 0,
          runsCount: runsByUser.get(k.id) ?? 0,
        })));
      } else {
        setSubs([]);
      }
      setLoading(false);
    }
    load();
    return () => { alive = false; };
  }, [userId]);

  if (loading) {
    return <AppShell><div className="flex h-40 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div></AppShell>;
  }
  if (!profile) {
    return (
      <AppShell>
        <BackLink />
        <div className="mx-auto max-w-md rounded-xl border border-border bg-card p-5 text-center text-sm text-muted-foreground">
          You don't have access to view this profile.
        </div>
      </AppShell>
    );
  }

  const primaryRole: AppRole = roles.includes("owner") ? "owner" : roles.includes("manager") ? "manager" : "field_staff";
  const totalKm = runs.reduce((a, r) => a + Number(r.distance_m ?? 0), 0) / 1000;

  return (
    <AppShell>
      <BackLink />
      <header className="mb-4 flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/15 text-primary text-lg font-semibold">
          {(profile.full_name ?? profile.email ?? "?").slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0">
          <h1 className="truncate text-xl font-bold">{profile.full_name ?? profile.email}</h1>
          <p className="text-xs text-muted-foreground">{ROLE_LABELS[primaryRole]}{profile.designation ? ` · ${profile.designation}` : ""}</p>
        </div>
      </header>

      <section className="mb-6 space-y-2 rounded-xl border border-border bg-card p-4">
        <Row icon={<Mail className="h-4 w-4" />} label="Email" value={profile.email ?? "—"} />
        <Row icon={<Phone className="h-4 w-4" />} label="Phone" value={profile.phone ?? "—"} />
        <Row icon={<Shield className="h-4 w-4" />} label="Access" value={roles.map((r) => ROLE_LABELS[r]).join(", ") || "—"} />
        <Row icon={<User className="h-4 w-4" />} label="Status" value={profile.status ?? "active"} />
        <div className="mt-2 grid grid-cols-3 gap-2 pt-2">
          <Stat label="Leads" value={leads.length} icon={<MapPin className="h-3.5 w-3.5" />} />
          <Stat label="Runs" value={runs.length} icon={<RouteIcon className="h-3.5 w-3.5" />} />
          <Stat label="Km" value={totalKm.toFixed(1)} icon={<Zap className="h-3.5 w-3.5" />} />
        </div>
      </section>

      <Section title="Leads" icon={<MapPin className="h-4 w-4" />} count={leads.length}>
        {leads.length === 0 ? (
          <Empty text="No leads yet." />
        ) : (
          <ul className="space-y-2">
            {leads.map((l) => (
              <li key={l.id}>
                <Link to="/leads/$id" params={{ id: l.id }} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-3 hover:bg-muted">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{l.name ?? "Unnamed lead"}</p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {l.type}{l.required_kw ? ` · ${l.required_kw} kW` : ""} · {new Date(l.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">{l.status}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Runs" icon={<RouteIcon className="h-4 w-4" />} count={runs.length}>
        {runs.length === 0 ? (
          <Empty text="No runs yet." />
        ) : (
          <ul className="space-y-2">
            {runs.map((r) => {
              const km = (Number(r.distance_m ?? 0) / 1000).toFixed(2);
              const start = r.started_at ? new Date(r.started_at) : null;
              const end = r.ended_at ? new Date(r.ended_at) : null;
              const durMin = start && end ? Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000)) : null;
              return (
                <li key={r.id} className="rounded-xl border border-border bg-card p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold">{km} km</p>
                    <span className="text-[11px] text-muted-foreground">{start ? start.toLocaleString() : "—"}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                    {durMin != null && <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" /> {durMin} min</span>}
                    <span className="inline-flex items-center gap-1"><RouteIcon className="h-3 w-3" /> {end ? "completed" : "in progress"}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      {subs.length > 0 && (
        <Section title="Direct reports" icon={<UsersIcon className="h-4 w-4" />} count={subs.length}>
          <ul className="space-y-2">
            {subs.map((s) => {
              const pr: AppRole = s.roles.includes("owner") ? "owner" : s.roles.includes("manager") ? "manager" : "field_staff";
              return (
                <li key={s.id}>
                  <Link to="/profile/$userId" params={{ userId: s.id }} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-3 hover:bg-muted">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{s.full_name ?? s.email}</p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {s.email} · {s.leadsCount} leads · {s.runsCount} runs
                      </p>
                    </div>
                    <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">{ROLE_LABELS[pr]}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Section>
      )}
    </AppShell>
  );
}

function BackLink() {
  return (
    <Link to="/profile" className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
      <ArrowLeft className="h-3.5 w-3.5" /> Back to profile
    </Link>
  );
}

function Section({ title, icon, count, children }: { title: string; icon: React.ReactNode; count: number; children: React.ReactNode }) {
  return (
    <section className="mb-5">
      <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
        {icon} {title} <span className="text-[11px] font-normal">({count})</span>
      </h2>
      {children}
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">{text}</p>;
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
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