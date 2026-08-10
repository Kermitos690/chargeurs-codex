import type { User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

type CustomerProfileSeed = {
  id: string;
  email: string | null;
  display_name?: string | null;
  terms_accepted_at?: string | null;
  privacy_acknowledged_at?: string | null;
};

function stringMetadata(user: User, key: string): string | null {
  const value = user.user_metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Creates the profile row after a user has a real session. Consent is copied
 * from signup metadata only on first creation, so saved profile edits are not
 * overwritten by stale browser metadata.
 */
export async function ensureCustomerProfile(user: User) {
  const { data: existing, error: existingError } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();

  if (existingError) return { error: existingError };
  if (existing) return { error: null };

  const payload: CustomerProfileSeed = {
    id: user.id,
    email: user.email ?? null,
    display_name: stringMetadata(user, "display_name"),
    terms_accepted_at: stringMetadata(user, "terms_accepted_at"),
    privacy_acknowledged_at: stringMetadata(user, "privacy_acknowledged_at"),
  };

  return supabase.from("profiles").insert(payload as never);
}
