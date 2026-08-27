import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User } from "@supabase/supabase-js";
import {
  canManageFinance as canManageFinanceFn,
  canView,
  canWrite as canWriteFn,
  isSuperAdmin as isSuperFn,
} from "@/lib/roles";

const AUTH_REQUEST_TIMEOUT_MS = 10_000;
const ROLE_RETRY_DELAY_MS = 750;

type RoleRow = { role: string };

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function withTimeout<T>(promise: PromiseLike<T>, ms = AUTH_REQUEST_TIMEOUT_MS): Promise<T> {
  let timer: number | undefined;
  try {
    return await Promise.race([
      Promise.resolve(promise),
      new Promise<T>((_, reject) => {
        timer = window.setTimeout(() => reject(new Error("AUTH_REQUEST_TIMEOUT")), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) window.clearTimeout(timer);
  }
}

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      const nextUser = session?.user ?? null;
      setAuthError(null);
      setUser(nextUser);
      if (!nextUser) {
        setRoles([]);
        setIsAdmin(false);
        setLoading(false);
      }
    });

    void (async () => {
      try {
        const { data, error } = await withTimeout(supabase.auth.getUser());
        if (!mounted) return;
        if (error || !data.user) {
          setUser(null);
          setRoles([]);
          setIsAdmin(false);
          setLoading(false);
          return;
        }
        setUser(data.user);
      } catch {
        if (!mounted) return;
        setUser(null);
        setRoles([]);
        setIsAdmin(false);
        setLoading(false);
      }
    })();

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!user) return;

    let cancelled = false;
    setLoading(true);
    setAuthError(null);

    void (async () => {
      let lastError: unknown = null;
      try {
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            const { data, error } = await withTimeout(
              supabase.from("user_roles").select("role").eq("user_id", user.id),
            );
            if (error) throw error;
            if (cancelled) return;

            const nextRoles = ((data ?? []) as RoleRow[]).map((row) => row.role);
            setRoles(nextRoles);
            setIsAdmin(canView(nextRoles));
            setAuthError(null);
            return;
          } catch (error) {
            lastError = error;
            if (attempt === 0) await delay(ROLE_RETRY_DELAY_MS);
          }
        }

        if (cancelled) return;
        console.error("Admin role lookup failed", lastError);
        setRoles([]);
        setIsAdmin(null);
        setAuthError("Impossible de vérifier vos droits administrateur pour le moment.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user]);

  const canWrite = canWriteFn(roles);
  const canManageFinance = canManageFinanceFn(roles);
  const isSuperAdmin = isSuperFn(roles);

  return { user, roles, isAdmin, canWrite, canManageFinance, isSuperAdmin, loading, authError };
}
