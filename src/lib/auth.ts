import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type AppRole = "owner" | "manager" | "field_staff";

export const ROLE_LABELS: Record<AppRole, string> = {
  owner: "Owner",
  manager: "Manager",
  field_staff: "Field Staff",
};

export async function getUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user?.id ?? null;
}

export async function fetchMyRoles(): Promise<AppRole[]> {
  const uid = await getUserId();
  if (!uid) return [];
  const { data } = await supabase.from("user_roles").select("role").eq("user_id", uid);
  return (data ?? []).map((r) => r.role as AppRole);
}

export type AuthState = {
  loading: boolean;
  userId: string | null;
  email: string | null;
  fullName: string | null;
  roles: AppRole[];
  isOwner: boolean;
  isManager: boolean;
  /** Legacy alias — true when the user is an owner. */
  isAdmin: boolean;
  canTrackPhone: boolean;
};

export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>({
    loading: true,
    userId: null,
    email: null,
    fullName: null,
    roles: [],
    isOwner: false,
    isManager: false,
    isAdmin: false,
    canTrackPhone: false,
  });

  useEffect(() => {
    let active = true;
    async function hydrate(uid: string | null, email: string | null) {
      if (!uid) {
        if (active) setState({ loading: false, userId: null, email: null, fullName: null, roles: [], isOwner: false, isManager: false, isAdmin: false, canTrackPhone: false });
        return;
      }
      const [rolesRes, profRes, accessRes] = await Promise.all([
        supabase.from("user_roles").select("role").eq("user_id", uid),
        supabase.from("profiles").select("full_name").eq("id", uid).maybeSingle(),
        email ? supabase.from("authorized_emails").select("track_phone").eq("email", email.toLowerCase()).maybeSingle() : Promise.resolve({ data: null }),
      ]);
      if (!active) return;
      const roles = (rolesRes.data ?? []).map((r) => r.role as AppRole);
      const isOwner = roles.includes("owner");
      setState({
        loading: false,
        userId: uid,
        email,
        fullName: (profRes.data?.full_name as string | undefined) ?? null,
        roles,
        isOwner,
        isManager: roles.includes("manager"),
        isAdmin: isOwner,
        canTrackPhone: accessRes.data?.track_phone ?? isOwner,
      });
    }
    supabase.auth.getSession().then(({ data }) => {
      hydrate(data.session?.user?.id ?? null, data.session?.user?.email ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      hydrate(session?.user?.id ?? null, session?.user?.email ?? null);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return state;
}