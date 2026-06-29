import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { Map, Compass, Users, Settings as SettingsIcon, LogOut, Shield } from "lucide-react";
import { type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";

const tabs = [
  { to: "/", label: "Run", icon: Map },
  { to: "/atlas", label: "Atlas", icon: Compass },
  { to: "/leads", label: "Leads", icon: Users },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
] as const;

export function AppShell({ children, fullBleed = false }: { children: ReactNode; fullBleed?: boolean }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const auth = useAuth();
  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }
  return (
    <div className="flex min-h-[100dvh] flex-col bg-background text-foreground">
      {auth.userId && (
        <div className="flex items-center justify-between border-b border-border bg-card/60 px-3 py-1.5 text-[11px]">
          <div className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
            <Shield className={cn("h-3.5 w-3.5", auth.isAdmin ? "text-primary" : "")} />
            <span className="truncate">{auth.fullName || auth.email}</span>
            <span className={cn("rounded-full border px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide", auth.isAdmin ? "border-primary/40 text-primary" : "border-border text-muted-foreground")}>
              {auth.isAdmin ? "admin" : "surveyor"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {auth.isAdmin && (
              <Link to="/admin/users" className="rounded px-1.5 py-0.5 text-muted-foreground hover:text-foreground">Users</Link>
            )}
            <button onClick={signOut} className="flex items-center gap-1 text-muted-foreground hover:text-foreground">
              <LogOut className="h-3.5 w-3.5" /> Sign out
            </button>
          </div>
        </div>
      )}
      <main className={cn("flex-1", fullBleed ? "relative" : "px-4 pt-4 pb-24")}>{children}</main>
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <ul className="mx-auto grid max-w-md grid-cols-4">
          {tabs.map((t) => {
            const active = t.to === "/" ? pathname === "/" : pathname.startsWith(t.to);
            const Icon = t.icon;
            return (
              <li key={t.to}>
                <Link
                  to={t.to}
                  className={cn(
                    "flex flex-col items-center justify-center gap-1 py-2.5 text-[11px] font-medium transition-colors",
                    active ? "text-primary" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Icon className={cn("h-5 w-5", active && "fill-primary/10")} />
                  {t.label}
                </Link>
              </li>
            );
          })}
        </ul>
        <div style={{ height: "env(safe-area-inset-bottom)" }} />
      </nav>
    </div>
  );
}