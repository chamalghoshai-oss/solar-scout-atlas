import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { createDefaultPasswordLoginLink } from "@/lib/login.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, LogIn } from "lucide-react";

const searchSchema = z.object({ redirect: z.string().optional() });

export const Route = createFileRoute("/auth")({
  validateSearch: (s) => searchSchema.parse(s),
  head: () => ({ meta: [{ title: "Sign in — VertX Field" }] }),
  component: AuthPage,
});

const credsSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  password: z.string().min(6, "Password must be at least 6 characters").max(72),
});

function AuthPage() {
  const navigate = useNavigate();
  const { redirect } = useSearch({ from: "/auth" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        navigate({ to: redirect ?? "/", replace: true });
      } else {
        setChecking(false);
      }
    });
  }, [navigate, redirect]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = credsSchema.safeParse({ email, password });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid input");
      return;
    }
    setSubmitting(true);
    let err: { message?: string } | null = null;
    const { error: passwordErr } = await supabase.auth.signInWithPassword({
      email: parsed.data.email,
      password: parsed.data.password,
    });
    err = passwordErr;

    if (passwordErr?.message?.toLowerCase().includes("email logins are disabled")) {
      try {
        const loginLink = await createDefaultPasswordLoginLink({ data: parsed.data });
        const { error: verifyErr } = await supabase.auth.verifyOtp({
          type: "magiclink",
          token_hash: loginLink.tokenHash,
        });
        err = verifyErr;
      } catch {
        err = { message: "Invalid credentials" };
      }
    }
    setSubmitting(false);
    if (err) {
      setError("Incorrect email or password.");
      return;
    }
    navigate({ to: redirect ?? "/", replace: true });
  }

  if (checking) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-background">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-4 rounded-2xl border border-border bg-card p-6 shadow-sm">
        <div className="space-y-1 text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary/15 text-primary">
            <LogIn className="h-5 w-5" />
          </div>
          <h1 className="text-xl font-bold">Sign in</h1>
          <p className="text-xs text-muted-foreground">Use the email and password given by your team.</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@example.com"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Your password"
          />
        </div>
        {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Sign in"}
        </Button>
        <p className="text-center text-[11px] text-muted-foreground">
          Forgot your password? Ask an owner or manager to reset it.
        </p>
      </form>
    </div>
  );
}