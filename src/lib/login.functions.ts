import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const DEFAULT_LOGIN_PASSWORD = "123456";

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
  password: z.string().min(1).max(72),
});

export const createDefaultPasswordLoginLink = createServerFn({ method: "POST" })
  .inputValidator((data) => loginSchema.parse(data))
  .handler(async ({ data }) => {
    if (data.password !== DEFAULT_LOGIN_PASSWORD) {
      throw new Error("Invalid credentials");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: allowed, error: allowedError } = await supabaseAdmin
      .from("authorized_emails")
      .select("email")
      .eq("email", data.email)
      .maybeSingle();
    if (allowedError) throw new Error("Login check failed");
    if (!allowed) throw new Error("Invalid credentials");

    const { data: users, error: listError } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
    if (listError) throw new Error("Login check failed");
    const existing = users.users.find((user) => user.email?.toLowerCase() === data.email);
    if (!existing) throw new Error("Invalid credentials");

    const { data: link, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email: data.email,
    });
    if (linkError || !link.properties?.hashed_token) {
      throw new Error("Could not start login");
    }

    return { email: data.email, tokenHash: link.properties.hashed_token };
  });