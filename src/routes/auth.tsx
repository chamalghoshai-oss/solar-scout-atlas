import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2, Mail, Sun } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [{ title: "Sign in — VertX Field" }] }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/" });
    });
  }, [navigate]);

  async function emailLink(e: React.FormEvent) {
    e.preventDefault();
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail.endsWith("@gmail.com")) {
      toast.error("Use an allowed Gmail address.");
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: cleanEmail,
        options: { emailRedirectTo: window.location.origin, shouldCreateUser: true },
      });
      if (error) throw error;
      toast.success("Check your email for the access link.");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Could not send access link");
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    setBusy(true);
    try {
      const r = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin });
      if (r.error) throw r.error;
      if (!r.redirected) navigate({ to: "/" });
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Google sign-in failed");
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
          Continue with Google
        </Button>

        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="h-px flex-1 bg-border" /> or send email link <span className="h-px flex-1 bg-border" />
        </div>

        <form onSubmit={emailLink} className="space-y-3">
          <div>
            <Label>Email</Label>
            <Input type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" placeholder="yourname@gmail.com" />
          </div>
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Mail className="mr-2 h-4 w-4" /> Send access link</>}
          </Button>
        </form>
      </div>
    </div>
  );
}