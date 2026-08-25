import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { CheckCircle2, Crown, Loader2, ShieldCheck, TriangleAlert } from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";
import { LiquidBackground } from "@/components/LiquidBackground";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useCustomer } from "@/hooks/useCustomer";

type ClaimState = "idle" | "claiming" | "success" | "membership" | "expired" | "error";
type MemberSummary = {
  planCode?: string;
  planName?: string;
  currency?: string;
  hourlyCents?: number | null;
  dailyCapCents?: number | null;
  includedMinutes?: number | null;
  renewalCreditCents?: number | null;
  rentalCreditCents?: number | null;
  rentalCreditCurrency?: string | null;
  rentalCreditExpiresAt?: string | null;
  renewsAt?: string | null;
};

function money(cents: number | null | undefined, currency = "CHF") {
  return cents == null ? "—" : new Intl.NumberFormat("fr-CH", { style: "currency", currency }).format(Number(cents) / 100);
}

export default function AccountConnect() {
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const { user, loading } = useCustomer();
  const [state, setState] = useState<ClaimState>("idle");
  const [stationId, setStationId] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [member, setMember] = useState<MemberSummary | null>(null);

  const currentPath = useMemo(() => `/compte/connect/${encodeURIComponent(token)}`, [token]);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      navigate(`/compte/login?next=${encodeURIComponent(currentPath)}`, { replace: true });
      return;
    }
    if (!token || state !== "idle") return;

    let cancelled = false;
    setState("claiming");
    void supabase.functions.invoke("customer-pairing-claim", { body: { token } })
      .then(({ data, error }) => {
        if (cancelled) return;
        const code = String(data?.error ?? error?.message ?? "");
        if (error || !data?.ok) {
          if (code.includes("MEMBERSHIP_REQUIRED")) setState("membership");
          else if (code.includes("EXPIRED")) setState("expired");
          else setState("error");
          setErrorCode(code || "PAIRING_CLAIM_FAILED");
          return;
        }
        setStationId(String(data.stationId ?? ""));
        setMember((data.member ?? null) as MemberSummary | null);
        setState("success");
      });

    return () => { cancelled = true; };
  }, [currentPath, loading, navigate, state, token, user]);

  return (
    <div className="relative grid min-h-screen place-items-center px-5 py-8 text-center">
      <LiquidBackground />
      <section className="glass-strong liquid-border w-full max-w-lg rounded-[2rem] p-7 sm:p-10">
        <div className="mb-7 flex justify-center"><BrandLogo /></div>

        {(loading || state === "idle" || state === "claiming") && (
          <>
            <div className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-success/10">
              <Loader2 className="h-10 w-10 animate-spin text-success" />
            </div>
            <h1 className="mt-6 font-display text-3xl font-extrabold">Connexion à la borne…</h1>
            <p className="mt-3 text-muted-foreground">Votre identité et votre adhésion Client Chargeurs sont vérifiées côté serveur avant d’activer le tarif membre.</p>
          </>
        )}

        {state === "success" && (
          <>
            <div className="mx-auto grid h-24 w-24 place-items-center rounded-full bg-success/15 shadow-glow-success">
              <CheckCircle2 className="h-12 w-12 text-success" />
            </div>
            <p className="mt-5 inline-flex items-center gap-2 rounded-full border border-success/25 bg-success/10 px-4 py-2 text-sm font-bold text-success">
              <ShieldCheck className="h-4 w-4" />Adhésion vérifiée
            </p>
            <h1 className="mt-5 font-display text-3xl font-extrabold">Borne connectée</h1>
            <p className="mt-3 text-muted-foreground">
              {stationId ? `La borne ${stationId} reconnaît maintenant votre adhésion.` : "La borne reconnaît maintenant votre adhésion."}
            </p>
            <div className="mt-6 rounded-2xl border border-success/20 bg-success/10 p-5">
              <p className="text-sm text-muted-foreground">{member?.planName ?? "Client Chargeurs"}</p>
              <p className="mt-1 font-display text-4xl font-extrabold text-success">{money(member?.hourlyCents, member?.currency)} / h</p>
              {member?.dailyCapCents != null && <p className="mt-2 text-sm text-muted-foreground">Plafond journalier {money(member.dailyCapCents, member.currency)}</p>}
              {Number(member?.includedMinutes ?? 0) > 0 && <p className="mt-1 text-sm text-muted-foreground">{member?.includedMinutes} min incluses dans votre plan</p>}
              <div className="mt-4 border-t border-success/20 pt-4">
                <p className="text-sm text-muted-foreground">Crédit location disponible</p>
                <p className="mt-1 font-display text-2xl font-extrabold text-success">{money(member?.rentalCreditCents, member?.rentalCreditCurrency ?? member?.currency)}</p>
                <p className="mt-1 text-xs text-muted-foreground">Il sera déduit du prix final de la location. La garantie éventuelle reste séparée.</p>
              </div>
            </div>
            <p className="mt-5 text-sm text-muted-foreground">Vous pouvez reprendre sur l’écran de la borne.</p>
            <Button onClick={() => navigate("/compte", { replace: true })} className="mt-6 w-full rounded-full bg-gradient-success py-6 text-lg font-bold text-success-foreground">
              Retour à mon compte
            </Button>
          </>
        )}

        {state === "membership" && (
          <>
            <div className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-violet-500/15">
              <Crown className="h-10 w-10 text-violet-300" />
            </div>
            <h1 className="mt-6 font-display text-2xl font-extrabold">Adhésion Client Chargeurs requise</h1>
            <p className="mt-3 text-muted-foreground">Votre compte est bien connecté, mais aucun abonnement membre actif n’a été trouvé. Le tarif membre n’a donc pas été activé sur la borne.</p>
            <Button onClick={() => navigate("/compte/pass", { replace: true })} className="mt-6 w-full rounded-full bg-violet-500 py-6 text-lg font-bold text-white hover:bg-violet-400">
              Voir Chargeurs+ Pass
            </Button>
            <Button onClick={() => navigate("/compte", { replace: true })} variant="ghost" className="mt-2 w-full rounded-full py-5">
              Retour à mon compte
            </Button>
          </>
        )}

        {(state === "expired" || state === "error") && (
          <>
            <div className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-warning/15">
              <TriangleAlert className="h-10 w-10 text-warning" />
            </div>
            <h1 className="mt-6 font-display text-2xl font-extrabold">
              {state === "expired" ? "Ce QR a expiré" : "Connexion impossible"}
            </h1>
            <p className="mt-3 text-muted-foreground">
              {state === "expired"
                ? "Demandez simplement un nouveau QR sur la borne. Aucun paiement n’a été déclenché."
                : "La borne n’a pas été reliée à votre compte. Réessayez avec un nouveau QR."}
            </p>
            {errorCode && <p className="mt-3 font-mono text-xs text-muted-foreground/70">{errorCode}</p>}
            <Button onClick={() => navigate("/compte", { replace: true })} variant="outline" className="mt-6 w-full rounded-full py-6">
              Retour à mon compte
            </Button>
          </>
        )}
      </section>
    </div>
  );
}
