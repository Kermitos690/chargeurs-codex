import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, CheckCircle2, XCircle, ShieldAlert, Clock, PlayCircle, Download, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

interface Row {
  code: string; module: string; name: string; http_method: string; path: string;
  params: string | null; backend_fn: string | null; ui_page: string | null;
  dangerous: boolean; mock_supported: boolean; mock_test_status: string;
  live_test_status: string; last_error: string | null; proof: Record<string, unknown> | null;
  seq: number;
  category: string | null; business_function: string | null; consumer: string | null;
  internal_route: string | null; integration_state: string | null;
  has_test: boolean; test_ref: string | null; missing_test: string | null;
  risk: string | null; logging: string | null; idempotent: boolean | null;
  retry_policy: string | null; proof_state: string | null;
}

const STATE_LABELS: Record<string, string> = {
  integrated_functional: "Intégrée & fonctionnelle",
  integrated_partial: "Intégrée partiellement",
  backend_no_ui: "Backend sans interface",
  ui_not_connected: "Interface non connectée",
  not_integrated: "Non intégrée",
  unusable: "Inutilisable",
  not_relevant: "Non pertinente",
};

const stateBadge = (s: string | null) => {
  const label = s ? STATE_LABELS[s] ?? s : "—";
  if (s === "integrated_functional") return <Badge className="bg-success/20 text-success">{label}</Badge>;
  if (s === "integrated_partial") return <Badge className="bg-amber-500/20 text-amber-500">{label}</Badge>;
  if (s === "not_integrated") return <Badge className="bg-destructive/20 text-destructive">{label}</Badge>;
  return <Badge variant="secondary">{label}</Badge>;
};

const testBadge = (s: string) => {
  if (s === "pass") return <Badge className="bg-success/20 text-success"><CheckCircle2 className="mr-1 h-3 w-3" />pass</Badge>;
  if (s === "fail") return <Badge className="bg-destructive/20 text-destructive"><XCircle className="mr-1 h-3 w-3" />fail</Badge>;
  if (s === "blocked") return <Badge className="bg-amber-500/20 text-amber-500"><ShieldAlert className="mr-1 h-3 w-3" />protégé</Badge>;
  return <Badge variant="secondary"><Clock className="mr-1 h-3 w-3" />pending</Badge>;
};

const download = (name: string, content: string, type: string) => {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
};

const toCsv = (rows: Row[]) => {
  const cols: (keyof Row)[] = [
    "code", "module", "category", "name", "business_function", "http_method", "path",
    "consumer", "backend_fn", "internal_route", "integration_state", "ui_page",
    "mock_test_status", "live_test_status", "proof_state", "has_test", "test_ref",
    "missing_test", "idempotent", "retry_policy", "logging", "risk", "dangerous", "last_error",
  ];
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
};

export default function AdminApiCoverage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [q, setQ] = useState("");
  const [moduleF, setModuleF] = useState("all");
  const [stateF, setStateF] = useState("all");
  const [consumerF, setConsumerF] = useState("all");

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

  const modules = useMemo(() => [...new Set(rows.map((r) => r.module))], [rows]);
  const states = useMemo(() => [...new Set(rows.map((r) => r.integration_state).filter(Boolean))] as string[], [rows]);
  const consumers = useMemo(() => [...new Set(rows.flatMap((r) => (r.consumer ?? "").split(",").map((c) => c.trim()).filter(Boolean)))], [rows]);

  const filtered = useMemo(() => rows.filter((r) => {
    if (moduleF !== "all" && r.module !== moduleF) return false;
    if (stateF !== "all" && r.integration_state !== stateF) return false;
    if (consumerF !== "all" && !(r.consumer ?? "").includes(consumerF)) return false;
    if (q) {
      const hay = `${r.code} ${r.name} ${r.path} ${r.business_function} ${r.backend_fn} ${r.category}`.toLowerCase();
      if (!hay.includes(q.toLowerCase())) return false;
    }
    return true;
  }), [rows, moduleF, stateF, consumerF, q]);

  const total = rows.length;
  const functional = rows.filter((r) => r.integration_state === "integrated_functional").length;
  const partial = rows.filter((r) => r.integration_state === "integrated_partial").length;
  const provenLive = rows.filter((r) => r.proof_state === "verified_live").length;
  const tested = rows.filter((r) => r.has_test).length;

  const exportJson = () => {
    const report = {
      generated_at: new Date().toISOString(),
      project: "Chargeurs.ch",
      source: "ChargeNow / Bajie Open API (Apifox)",
      summary: { total, functional, partial, proven_live: provenLive, with_automated_test: tested },
      endpoints: filtered,
    };
    download(`chargenow-api-matrix-${Date.now()}.json`, JSON.stringify(report, null, 2), "application/json");
  };
  const exportCsv = () => download(`chargenow-api-matrix-${Date.now()}.csv`, toCsv(filtered), "text/csv");

  const selCls = "rounded-xl border border-border bg-background px-3 py-2 text-sm";

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold">Matrice API ChargeNow — 35 opérations</h1>
          <p className="text-sm text-muted-foreground">Inventaire exhaustif · fonction métier, route interne, état d'intégration, preuves, tests, idempotence & risques</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={exportJson} variant="outline" className="gap-2"><Download className="h-4 w-4" />JSON</Button>
          <Button onClick={exportCsv} variant="outline" className="gap-2"><Download className="h-4 w-4" />CSV</Button>
          <Button onClick={runSafe} disabled={running} className="gap-2 bg-gradient-primary">
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
            Vérifier O1 (lecture autorisée)
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          { l: "Total", v: total },
          { l: "Fonctionnelles", v: functional },
          { l: "Partielles", v: partial },
          { l: "Prouvées live", v: provenLive },
          { l: "Tests auto", v: `${tested}/${total}` },
        ].map((s) => (
          <div key={s.l} className="glass liquid-border rounded-2xl p-4">
            <div className="text-xs text-muted-foreground">{s.l}</div>
            <div className="font-display text-2xl font-bold">{s.v}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher…" className="w-56 pl-9" />
        </div>
        <select className={selCls} value={moduleF} onChange={(e) => setModuleF(e.target.value)}>
          <option value="all">Tous les modules</option>
          {modules.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <select className={selCls} value={stateF} onChange={(e) => setStateF(e.target.value)}>
          <option value="all">Tous les états</option>
          {states.map((s) => <option key={s} value={s}>{STATE_LABELS[s] ?? s}</option>)}
        </select>
        <select className={selCls} value={consumerF} onChange={(e) => setConsumerF(e.target.value)}>
          <option value="all">Toutes les apps</option>
          {consumers.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <span className="text-sm text-muted-foreground">{filtered.length} / {total}</span>
      </div>

      {loading ? (
        <div className="grid place-items-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border">
          <table className="w-full min-w-[1400px] text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="p-3">ID</th><th className="p-3">Module</th><th className="p-3">Catégorie</th>
                <th className="p-3">Opération</th><th className="p-3">Fonction métier</th>
                <th className="p-3">Méth.</th><th className="p-3">Chemin</th><th className="p-3">App</th>
                <th className="p-3">Route interne</th><th className="p-3">État</th>
                <th className="p-3">Mock</th><th className="p-3">Live</th><th className="p-3">Preuve</th>
                <th className="p-3">Test</th><th className="p-3">Idemp.</th><th className="p-3">Retry</th>
                <th className="p-3">Risque</th><th className="p-3">Erreur</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.code} className="border-t border-border/50 align-top">
                  <td className="p-3 font-mono font-semibold">{r.code}{r.dangerous && <ShieldAlert className="ml-1 inline h-3 w-3 text-amber-500" />}</td>
                  <td className="p-3 text-xs">{r.module}</td>
                  <td className="p-3 text-xs">{r.category ?? "—"}</td>
                  <td className="p-3">{r.name}</td>
                  <td className="p-3 max-w-[220px] text-xs text-muted-foreground">{r.business_function ?? "—"}</td>
                  <td className="p-3"><Badge variant="outline">{r.http_method}</Badge></td>
                  <td className="p-3 font-mono text-xs text-muted-foreground">{r.path}</td>
                  <td className="p-3 text-xs">{r.consumer ?? "—"}</td>
                  <td className="p-3 font-mono text-xs text-muted-foreground">{r.internal_route ?? "—"}</td>
                  <td className="p-3">{stateBadge(r.integration_state)}</td>
                  <td className="p-3">{testBadge(r.mock_test_status)}</td>
                  <td className="p-3">{testBadge(r.live_test_status)}</td>
                  <td className="p-3 text-xs">{r.proof_state ?? "—"}</td>
                  <td className="p-3 text-xs">{r.has_test ? <span className="text-success">{r.test_ref}</span> : <span className="text-muted-foreground" title={r.missing_test ?? ""}>manquant</span>}</td>
                  <td className="p-3 text-xs">{r.idempotent === null ? "—" : r.idempotent ? "oui" : "non"}</td>
                  <td className="p-3 text-xs">{r.retry_policy ?? "—"}</td>
                  <td className="p-3 max-w-[180px] text-xs text-muted-foreground">{r.risk ?? "—"}</td>
                  <td className="p-3 max-w-[160px] truncate text-xs text-muted-foreground" title={r.last_error ?? ""}>{r.last_error ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        États de preuve : <strong>verified_live</strong> = appel réel ChargeNow réussi et enregistré · <strong>verified_mock</strong> = couvert par test simulé ·
        <strong> unverified</strong> = code présent mais non prouvé en réel · <strong>blocked_by_safety</strong> = opération destructive, non exécutée volontairement (mode maintenance + confirmation requis).
        Les opérations <ShieldAlert className="inline h-3 w-3 text-amber-500" /> sont destructives et protégées par dry-run.
      </p>
    </div>
  );
}
