import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User } from "@supabase/supabase-js";
import { ensureCustomerProfile } from "@/lib/customerProfile";

/**
 * Customer (renter) auth state. A customer is any authenticated user.
 * Access to rental data is enforced server-side by RLS, which matches the
 * user's verified email against rental_sessions.customer_email.
 */
export function useCustomer() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;
    // The profile is convenience data only.  Authorization continues to rely
    // on Supabase Auth and RLS, so a failed profile write cannot grant access.
    void ensureCustomerProfile(user);
  }, [user]);

  return { user, loading };
}
