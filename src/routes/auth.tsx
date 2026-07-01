import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { Button } from "@/components/ui/button";
import { Loader2, Sun } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [{ title: "Sign in — VertX Field" }] }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/" });
    });
  }, [navigate]);

  async function google() {
    setBusy(true);
    try {
      const r = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin });
      if (r.redirected) return; // full-page redirect in progress
      // Popup/web_message flow: verify session before treating as failure.
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        navigate({ to: "/" });
        return;
      }
      if (r.error) throw r.error;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      // Suppress benign "cancelled" when the session actually landed.
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        navigate({ to: "/" });
        return;
      }
      toast.error(msg || "Google sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-5 rounded-2xl border border-border bg-card p-6 shadow">
        <div className="flex flex-col items-center gap-2">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/15 text-primary"><Sun className="h-6 w-6" /></div>
          <h1 className="text-xl font-bold">VertX Field</h1>
          <p className="text-xs text-muted-foreground">Owner and team access</p>
        </div>

        <Button type="button" variant="outline" className="w-full" disabled={busy} onClick={google}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Continue with Google"}
        </Button>
      </div>
    </div>
  );
}