import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, UserPlus, ShieldCheck, X } from "lucide-react";

type AdminUser = {
  id: string;
  email: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  email_confirmed_at: string | null;
  display_name: string | null;
  phone: string | null;
  roles: string[];
};

const ASSIGNABLE = [
  "super_admin", "operations_admin", "finance_admin", "support_agent",
  "maintenance_technician", "partner_owner", "partner_staff", "customer",
] as const;

export default function AdminUsers() {
  const { isSuperAdmin: canWrite } = useAuth();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.functions.invoke("admin-users", { body: { action: "list" } });
    if (error || !data?.ok) {
      toast.error(data?.error ?? error?.message ?? "Erreur de chargement");
    } else {
      setUsers(data.users as AdminUser[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const mutate = async (action: string, body: Record<string, unknown>, key: string) => {
    setBusy(key);
    const { data, error } = await supabase.functions.invoke("admin-users", { body: { action, ...body } });
    setBusy(null);
    if (error || !data?.ok) {
      const code = data?.error ?? error?.message;
      toast.error(code === "LAST_ADMIN_PROTECTED" ? "Impossible de retirer le dernier administrateur." : (code ?? "Erreur"));
      return;
    }
    toast.success("Mis à jour");
    await load();
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold">Utilisateurs & rôles</h1>
          <p className="text-sm text-muted-foreground">Gérez les accès au back-office.</p>
        </div>
      </header>

      {canWrite && (
        <div className="glass rounded-2xl p-4">
          <p className="mb-3 flex items-center gap-2 text-sm font-semibold"><UserPlus className="h-4 w-4" /> Inviter un utilisateur</p>
          <div className="flex flex-wrap gap-2">
            <Input
              type="email" placeholder="email@exemple.ch" value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)} className="max-w-xs"
            />
            <Button
              disabled={busy === "invite" || !inviteEmail}
              onClick={async () => { await mutate("invite", { email: inviteEmail }, "invite"); setInviteEmail(""); }}
            >
              {busy === "invite" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Envoyer l'invitation"}
            </Button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="grid place-items-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
      ) : (
        <div className="space-y-3">
          {users.map((u) => (
            <div key={u.id} className="glass rounded-2xl p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{u.display_name || u.email || u.id}</p>
                  <p className="truncate text-sm text-muted-foreground">{u.email}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {u.email_confirmed_at ? "Email confirmé" : "Email non confirmé"}
                    {u.last_sign_in_at ? ` · Dernière connexion ${new Date(u.last_sign_in_at).toLocaleDateString()}` : " · Jamais connecté"}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {u.roles.length === 0 && <span className="text-xs text-muted-foreground">Aucun rôle</span>}
                  {u.roles.map((r) => (
                    <Badge key={r} variant="secondary" className="gap-1">
                      <ShieldCheck className="h-3 w-3" />{r}
                      {canWrite && (
                        <button
                          onClick={() => mutate("remove_role", { userId: u.id, role: r }, `${u.id}:${r}:rm`)}
                          className="ml-0.5 rounded-full hover:text-destructive" aria-label={`Retirer ${r}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </Badge>
                  ))}
                </div>
              </div>

              {canWrite && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {ASSIGNABLE.filter((r) => !u.roles.includes(r)).map((r) => (
                    <Button
                      key={r} size="sm" variant="outline" className="h-7 text-xs"
                      disabled={busy === `${u.id}:${r}:add`}
                      onClick={() => mutate("set_role", { userId: u.id, role: r }, `${u.id}:${r}:add`)}
                    >
                      + {r}
                    </Button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
