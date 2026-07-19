import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User } from "@supabase/supabase-js";
import {
  canManageFinance as canManageFinanceFn,
  canView,
  canWrite as canWriteFn,
  isSuperAdmin as isSuperFn,
} from "@/lib/roles";


export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
      if (!session?.user) { setIsAdmin(false); setRoles([]); setLoading(false); }
    });
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
      if (!data.session?.user) setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    supabase.from("user_roles").select("role").eq("user_id", user.id).then(({ data }) => {
      const r = (data ?? []).map((x: { role: string }) => x.role);
      setRoles(r);
      // Admin = anyone with a back-office role that can VIEW the admin UI.
      setIsAdmin(canView(r));
      setLoading(false);
    });
    // Ensure a profile row exists for this user (RLS: users upsert own profile).
    supabase.from("profiles").upsert(
      { id: user.id, email: user.email ?? null },
      { onConflict: "id", ignoreDuplicates: false },
    ).then(() => {});
  }, [user]);

  // Write access is restricted to roles the backend `requireAdmin` accepts.
  const canWrite = canWriteFn(roles);
  const canManageFinance = canManageFinanceFn(roles);
  const isSuperAdmin = isSuperFn(roles);

  return { user, roles, isAdmin, canWrite, canManageFinance, isSuperAdmin, loading };
}
