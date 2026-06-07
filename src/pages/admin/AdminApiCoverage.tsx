import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, CheckCircle2, XCircle, ShieldAlert, Clock, PlayCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

interface Row {
  code: string; module: string; name: string; http_method: string; path: string;
  params: string | null; backend_fn: string | null; ui_page: string | null;
  dangerous: boolean; mock_supported: boolean; mock_test_status: string;
  live_test_status: string; last_error: string | null; proof: Record<string, unknown> | null;
  seq: number;
}

const statusBadge = (s: string) => {
  if (s === "pass") return <Badge className="bg-success/20 text-success"><CheckCircle2 className="mr-1 h-3 w-3" />pass</Badge>;
  if (s === "fail") return <Badge className="bg-destructive/20 text-destructive"><XCircle className="mr-1 h-3 w-3" />fail</Badge>;
  if (s === "blocked") return <Badge className="bg-amber-500/20 text-amber-500"><ShieldAlert className="mr-1 h-3 w-3" />protégé</Badge>;
  return <Badge variant="secondary"><Clock className="mr-1 h-3 w-3" />pending</Badge>;
};

export default function AdminApiCoverage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from("api_coverage").select("*").order("seq");
    setRows((data as Row[]) ?? []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const runSafe = async () => {
    setRunning(true);
    const { data, error } = await supabase.functions.invoke("chargenow-admin", { body: { action: "run_safe_live" } });
    if (error || !(data as { ok?: boolean })?.ok) toast.error("Échec des tests live (rôle admin requis ?)");
    else toast.success("Tests live non destructifs exécutés");
    await load();
    setRunning(false);
  };

  const total = rows.length;
  const mockPass = rows.filter((r) => r.mock_test_status === "pass").length;
  const livePass = rows.filter((r) => r.live_test_status === "pass").length;
  const blocked = rows.filter((r) => r.live_test_status === "blocked").length;

  const modules = [...new Set(rows.map((r) => r.module))];

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold">Couverture API — 35 opérations</h1>
          <p className="text-sm text-muted-foreground">ChargeNow / Bajie · routes exactes vérifiées via Apifox</p>
        </div>
        <Button onClick={runSafe} disabled={running} className="gap-2 bg-gradient-primary">
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
          Lancer les tests live (non destructifs)
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { l: "Total", v: total },
          { l: "Mock OK", v: `${mockPass}/${total}` },
          { l: "Live OK", v: `${livePass}/${total}` },
          { l: "Protégés", v: blocked },
        ].map((s) => (
          <div key={s.l} className="glass liquid-border rounded-2xl p-4">
            <div className="text-xs text-muted-foreground">{s.l}</div>
            <div className="font-display text-2xl font-bold">{s.v}</div>
          </div>
        ))}
      </div>

      {loading ? (
        <div className="grid place-items-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
      ) : (
        modules.map((mod) => (
          <div key={mod} className="space-y-2">
            <h2 className="font-display text-lg font-semibold">{mod}</h2>
            <div className="overflow-x-auto rounded-2xl border border-border">
              <table className="w-full min-w-[820px] text-sm">
                <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="p-3">ID</th><th className="p-3">Opération</th>
                    <th className="p-3">Méthode</th><th className="p-3">Chemin exact</th>
                    <th className="p-3">Fonction</th><th className="p-3">Mock</th>
                    <th className="p-3">Live</th><th className="p-3">Erreur</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.filter((r) => r.module === mod).map((r) => (
                    <tr key={r.code} className="border-t border-border/50">
                      <td className="p-3 font-mono font-semibold">{r.code}{r.dangerous && <ShieldAlert className="ml-1 inline h-3 w-3 text-amber-500" />}</td>
                      <td className="p-3">{r.name}</td>
                      <td className="p-3"><Badge variant="outline">{r.http_method}</Badge></td>
                      <td className="p-3 font-mono text-xs text-muted-foreground">{r.path}</td>
                      <td className="p-3 font-mono text-xs">{r.backend_fn}</td>
                      <td className="p-3">{statusBadge(r.mock_test_status)}</td>
                      <td className="p-3">{statusBadge(r.live_test_status)}</td>
                      <td className="p-3 max-w-[200px] truncate text-xs text-muted-foreground" title={r.last_error ?? ""}>{r.last_error ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}
      <p className="text-xs text-muted-foreground">
        Les opérations marquées <ShieldAlert className="inline h-3 w-3 text-amber-500" /> sont destructives : elles exigent le mode maintenance
        explicite et une confirmation, et disposent d'un mode dry-run. Aucune batterie n'est éjectée pour valider un test.
      </p>
    </div>
  );
}
