import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { getDeviceId } from "@/lib/device";
import { STATUSES } from "@/components/LeadFormSheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { MapPin, Phone, Zap, ChevronRight, Home, Boxes } from "lucide-react";

export const Route = createFileRoute("/leads")({
  head: () => ({
    meta: [
      { title: "Leads — VertX Field" },
      { name: "description", content: "Browse and filter all captured solar leads and potential houses." },
      { property: "og:title", content: "Leads — VertX Field" },
      { property: "og:description", content: "Browse and filter all captured solar leads and potential houses." },
    ],
  }),
  component: LeadsLayout,
});

function LeadsLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  if (pathname !== "/leads") return <Outlet />;
  return <LeadsList />;
}

type Lead = {
  id: string;
  name: string | null;
  phone: string | null;
  required_kw: number | null;
  notes: string | null;
  lat: number;
  lng: number;
  status: string;
  type: string;
  created_at: string;
};

function LeadsList() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("leads")
        .select("id,name,phone,required_kw,notes,lat,lng,status,type,created_at")
        .order("created_at", { ascending: false });
      setLeads((data as Lead[]) ?? []);
      setLoading(false);
    })();
  }, []);

  const filtered = leads.filter((l) => {
    if (filter === "all") return true;
    if (filter === "potential") return l.type === "potential";
    if (filter === "lead") return l.type !== "potential";
    return l.status === filter;
  });

  return (
    <AppShell>
      <header className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Leads</h1>
          <p className="text-sm text-muted-foreground">{leads.length} captured</p>
        </div>
        <Link
          to="/simulator"
          className="flex items-center gap-1 rounded-md border border-primary/40 bg-primary/10 px-2.5 py-1.5 text-xs font-semibold text-primary hover:bg-primary/15"
        >
          <Boxes className="h-3.5 w-3.5" /> 3D Sim
        </Link>
      </header>

      <Select value={filter} onValueChange={setFilter}>
        <SelectTrigger className="mb-3"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All</SelectItem>
          <SelectItem value="lead">Full leads only</SelectItem>
          <SelectItem value="potential">Potential houses only</SelectItem>
          {STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
        </SelectContent>
      </Select>

      {loading ? (
        <p className="py-12 text-center text-sm text-muted-foreground">Loading…</p>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No leads yet. Tap the map on the Run tab to add one.
        </div>
      ) : (
        <ul className="space-y-2">
          {filtered.map((l) => (
            <li key={l.id}>
              <Link
                to="/leads/$id"
                params={{ id: l.id }}
                className="flex items-center gap-3 rounded-xl border border-border bg-card p-3 active:bg-muted"
              >
                <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${l.type === "potential" ? "bg-muted text-muted-foreground" : "bg-primary/15 text-primary"}`}>
                  {l.type === "potential" ? <Home className="h-5 w-5" /> : <Zap className="h-5 w-5" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="truncate font-semibold">{l.name || (l.type === "potential" ? "Potential house" : "Unnamed lead")}</div>
                    <StatusBadge status={l.status} type={l.type} />
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                    {l.required_kw != null && <span className="flex items-center gap-0.5"><Zap className="h-3 w-3" />{l.required_kw} kW</span>}
                    {l.phone && <span className="flex items-center gap-0.5"><Phone className="h-3 w-3" />{l.phone}</span>}
                    <span className="flex items-center gap-0.5"><MapPin className="h-3 w-3" />{l.lat.toFixed(4)},{l.lng.toFixed(4)}</span>
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </AppShell>
  );
}

export function StatusBadge({ status, type }: { status: string; type: string }) {
  if (type === "potential") return <Badge variant="secondary" className="text-[10px]">Pinned</Badge>;
  const map: Record<string, string> = {
    hot: "bg-red-500/15 text-red-700 dark:text-red-400",
    warm: "bg-orange-500/15 text-orange-700 dark:text-orange-400",
    cold: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400",
    reference: "bg-green-500/15 text-green-700 dark:text-green-400",
    not_interested: "bg-muted text-muted-foreground",
    // legacy fallbacks
    interested: "bg-red-500/15 text-red-700 dark:text-red-400",
    follow_up: "bg-orange-500/15 text-orange-700 dark:text-orange-400",
    converted: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400",
    not_home: "bg-orange-500/15 text-orange-700 dark:text-orange-400",
  };
  const label = STATUSES.find((s) => s.value === status)?.label ?? status;
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${map[status] ?? "bg-muted"}`}>{label}</span>;
}