import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { RefreshCw, ChevronDown, ChevronRight } from "lucide-react";

// ---------------------------------------------------------------------------
// ChargeNow MUTATION test monitor.
// Shows, per endpoint: level, last verdict, date, cabinet, environment,
// correlation id, REDACTED request & response, duration, and whether a
// physical test is still required. Read-only — never triggers a call.
// ---------------------------------------------------------------------------

interface TestRun {
  id: string;
  endpoint_code: string;
  endpoint_name: string | null;
  level: string;
  verdict: string;
  environment: string;
  cabinet_id: string | null;
  correlation_id: string | null;
  request_redacted: unknown;
  response_redacted: unknown;
  status_code: number | null;
  duration_ms: number | null;
  physical_test_required: boolean;
  error: string | null;
  created_at: string;
}

const VERDICT_STYLE: Record<string, string> = {
  mock_verified: "bg-sky-500/15 text-sky-400",
  live_verified: "bg-emerald-500/15 text-emerald-400",
  physical_test_required: "bg-amber-500/15 text-amber-400",
  blocked_by_safety: "bg-fuchsia-500/15 text-fuchsia-400",
  failed: "bg-destructive/15 text-destructive",
  pending: "bg-muted text-muted-foreground",
};

const VERDICT_LABEL: Record<string, string> = {
  mock_verified: "Mock vérifié",
  live_verified: "Live vérifié",
  physical_test_required: "Test physique requis",
  blocked_by_safety: "Bloqué (sécurité)",
  failed: "Échec",
  pending: "En attente",
};

const fmt = (d: string | null) => (d ? new Date(d).toLocaleString() : "—");

function VerdictBadge({ v }: { v: string }) {
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${VERDICT_STYLE[v] ?? "bg-muted"}`}>
      {VERDICT_LABEL[v] ?? v}
    </span>
  );
}

export default function MutationTestMonitor() {
  const [runs, setRuns] = useState<TestRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("test_runs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(300);
    setRuns((data ?? []) as unknown as TestRun[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Keep only the most recent run per (endpoint, level).
  const latest = useMemo(() => {
    const seen = new Map<string, TestRun>();
    for (const r of runs) {
      const key = `${r.endpoint_code}:${r.level}`;
      if (!seen.has(key)) seen.set(key, r);
    }
    return Array.from(seen.values()).sort((a, b) =>
      a.endpoint_code === b.endpoint_code
        ? a.level.localeCompare(b.level)
        : a.endpoint_code.localeCompare(b.endpoint_code));
  }, [runs]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of latest) c[r.verdict] = (c[r.verdict] ?? 0) + 1;
    return c;
  }, [latest]);

  return (
    <div className="glass liquid-border rounded-2xl p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-display text-lg font-bold">Tests de mutations ChargeNow</h3>
          <p className="text-xs text-muted-foreground">
            Niveau A = contrat mocké · Niveau B = live non destructif · Niveau C = protocole physique.
            Aucun test simulé n'est présenté comme preuve matérielle.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={load} className="gap-2">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />Rafraîchir
        </Button>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {Object.entries(counts).map(([v, n]) => (
          <span key={v} className="flex items-center gap-1.5 text-xs">
            <VerdictBadge v={v} /> <b>{n}</b>
          </span>
        ))}
      </div>

      {latest.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucun résultat de test enregistré.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-border/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-3">Endpoint</th>
                <th className="py-2 pr-3">Niv.</th>
                <th className="py-2 pr-3">Verdict</th>
                <th className="py-2 pr-3">Env.</th>
                <th className="py-2 pr-3">Cabinet</th>
                <th className="py-2 pr-3">Durée</th>
                <th className="py-2 pr-3">Phys. requis</th>
                <th className="py-2 pr-3">Date</th>
                <th className="py-2 pr-3"></th>
              </tr>
            </thead>
            <tbody>
              {latest.map((r) => {
                const id = `${r.endpoint_code}:${r.level}`;
                const isOpen = open === id;
                return (
                  <>
                    <tr key={id} className="border-b border-border/30 hover:bg-muted/20">
                      <td className="py-2 pr-3 font-mono">
                        <b>{r.endpoint_code}</b>
                        <span className="ml-1 text-muted-foreground">{r.endpoint_name}</span>
                      </td>
                      <td className="py-2 pr-3 font-mono">{r.level}</td>
                      <td className="py-2 pr-3"><VerdictBadge v={r.verdict} /></td>
                      <td className="py-2 pr-3 font-mono text-xs">{r.environment}</td>
                      <td className="py-2 pr-3 font-mono text-xs">{r.cabinet_id ?? "—"}</td>
                      <td className="py-2 pr-3 text-xs">{r.duration_ms != null ? `${r.duration_ms} ms` : "—"}</td>
                      <td className="py-2 pr-3">{r.physical_test_required ? "Oui" : "Non"}</td>
                      <td className="py-2 pr-3 text-xs text-muted-foreground">{fmt(r.created_at)}</td>
                      <td className="py-2 pr-3">
                        <button onClick={() => setOpen(isOpen ? null : id)} className="text-muted-foreground hover:text-foreground">
                          {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </button>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr key={`${id}-d`} className="bg-background/40">
                        <td colSpan={9} className="p-4">
                          <div className="grid gap-3 lg:grid-cols-2">
                            <div>
                              <div className="text-xs uppercase tracking-wide text-muted-foreground">Corrélation</div>
                              <div className="mb-2 break-all font-mono text-xs">{r.correlation_id ?? "—"}</div>
                              <div className="text-xs uppercase tracking-wide text-muted-foreground">Statut HTTP / erreur</div>
                              <div className="mb-2 font-mono text-xs">{r.status_code ?? "—"} {r.error ? `· ${r.error}` : ""}</div>
                            </div>
                            <div>
                              <div className="text-xs uppercase tracking-wide text-muted-foreground">Requête (expurgée)</div>
                              <pre className="mb-2 max-h-40 overflow-auto rounded-lg bg-background/60 p-2 text-xs">
                                {JSON.stringify(r.request_redacted, null, 2)}
                              </pre>
                              <div className="text-xs uppercase tracking-wide text-muted-foreground">Réponse (expurgée)</div>
                              <pre className="max-h-40 overflow-auto rounded-lg bg-background/60 p-2 text-xs">
                                {JSON.stringify(r.response_redacted, null, 2)}
                              </pre>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
