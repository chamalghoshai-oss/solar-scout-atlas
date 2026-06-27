import { Link, useRouterState } from "@tanstack/react-router";
import { Map, Compass, Users, Settings as SettingsIcon } from "lucide-react";
import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

const tabs = [
  { to: "/", label: "Run", icon: Map },
  { to: "/atlas", label: "Atlas", icon: Compass },
  { to: "/leads", label: "Leads", icon: Users },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
] as const;

export function AppShell({ children, fullBleed = false }: { children: ReactNode; fullBleed?: boolean }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <div className="flex min-h-[100dvh] flex-col bg-background text-foreground">
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