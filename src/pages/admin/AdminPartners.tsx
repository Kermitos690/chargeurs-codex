import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import { DataTable } from "@/components/admin/DataTable";
import { toast } from "@/hooks/use-toast";
import { Loader2, RefreshCw, Plus, Pencil } from "lucide-react";

type Partner = {
  id: string;
  legal_name: string;
  trade_name: string | null;
  partner_type: string;
  city: string | null;
  country: string | null;
  vat_number: string | null;
  email: string | null;
  phone: string | null;
  manager_name: string | null;
  commission_rate: number;
  billing_method: string | null;
  status: string;
  notes: string | null;
  start_date: string | null;
  end_date: string | null;
};

const EMPTY: Partial<Partner> = {
  legal_name: "", trade_name: "", partner_type: "company", country: "CH",
  commission_rate: 0, billing_method: "transfer", status: "active",
};

const STATUS_TONE: Record<string, string> = {
  active: "bg-success/15 text-success",
  suspended: "bg-destructive/15 text-destructive",
  archived: "bg-muted text-muted-foreground",
};

export default function AdminPartners() {
  const { canWrite } = useAuth();
  const [rows, setRows] = useState<Partner[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Partial<Partner> | null>(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("partners").select("*").order("created_at", { ascending: false });
    if (error) toast({ title: "Erreur de chargement", description: error.message, variant: "destructive" });
    setRows((data as Partner[]) ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => rows.filter((p) => {
    const q = search.trim().toLowerCase();
    const matchQ = !q || [p.legal_name, p.trade_name, p.city, p.email, p.vat_number]
      .some((v) => (v ?? "").toLowerCase().includes(q));
    const matchS = statusFilter === "all" || p.status === statusFilter;
    return matchQ && matchS;
  }), [rows, search, statusFilter]);

  const openCreate = () => { setEditing({ ...EMPTY }); setOpen(true); };
  const openEdit = (p: Partner) => { setEditing({ ...p }); setOpen(true); };

  const save = async () => {
    if (!editing?.legal_name?.trim()) {
      toast({ title: "Raison sociale requise", variant: "destructive" }); return;
    }
    setSaving(true);
    const payload = {
      legal_name: editing.legal_name.trim(),
      trade_name: editing.trade_name || null,
      partner_type: editing.partner_type || "company",
      address: (editing as Partner).city ? (editing as any).address ?? null : (editing as any).address ?? null,
      city: editing.city || null,
      country: editing.country || null,
      vat_number: editing.vat_number || null,
      email: editing.email || null,
      phone: editing.phone || null,
      manager_name: editing.manager_name || null,
      commission_rate: Number(editing.commission_rate ?? 0),
      billing_method: editing.billing_method || null,
      status: editing.status || "active",
      notes: editing.notes || null,
      start_date: editing.start_date || null,
      end_date: editing.end_date || null,
    };
    const res = editing.id
      ? await supabase.from("partners").update(payload).eq("id", editing.id)
      : await supabase.from("partners").insert(payload);
    setSaving(false);
    if (res.error) {
      toast({ title: "Échec de l'enregistrement", description: res.error.message, variant: "destructive" });
      return;
    }
    toast({ title: editing.id ? "Partenaire mis à jour" : "Partenaire créé" });
    setOpen(false); setEditing(null); load();
  };

  const setStatus = async (p: Partner, status: string) => {
    const { error } = await supabase.from("partners").update({ status }).eq("id", p.id);
    if (error) { toast({ title: "Échec", description: error.message, variant: "destructive" }); return; }
    toast({ title: `Partenaire ${status === "active" ? "activé" : status === "suspended" ? "suspendu" : "archivé"}` });
    load();
  };

  const columns = ["Partenaire", "Type", "Ville", "TVA", "Commission", "Statut", "Actions"];
  const tableRows = filtered.map((p) => [
    <div key="n"><div className="font-semibold">{p.legal_name}</div>{p.trade_name && <div className="text-xs text-muted-foreground">{p.trade_name}</div>}</div>,
    p.partner_type,
    p.city ?? "—",
    p.vat_number ?? "—",
    `${p.commission_rate}%`,
    <span key="s" className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_TONE[p.status] ?? "bg-muted"}`}>{p.status}</span>,
    canWrite ? (
      <div key="a" className="flex flex-wrap gap-1">
        <Button size="sm" variant="ghost" className="h-7 gap-1 px-2" onClick={() => openEdit(p)}><Pencil className="h-3.5 w-3.5" />Éditer</Button>
        {p.status !== "active" && <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setStatus(p, "active")}>Activer</Button>}
        {p.status !== "suspended" && <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setStatus(p, "suspended")}>Suspendre</Button>}
        {p.status !== "archived" && <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setStatus(p, "archived")}>Archiver</Button>}
      </div>
    ) : <span key="a" className="text-xs text-muted-foreground">Lecture seule</span>,
  ]);

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-bold">Partenaires</h1>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={load} className="gap-2">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}Actualiser
          </Button>
          {canWrite && (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button className="gap-2" onClick={openCreate}><Plus className="h-4 w-4" />Nouveau partenaire</Button>
              </DialogTrigger>
              <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
                <DialogHeader><DialogTitle>{editing?.id ? "Modifier le partenaire" : "Nouveau partenaire"}</DialogTitle></DialogHeader>
                {editing && (
                  <div className="grid gap-3">
                    <Field label="Raison sociale *"><Input value={editing.legal_name ?? ""} onChange={(e) => setEditing({ ...editing, legal_name: e.target.value })} /></Field>
                    <Field label="Nom commercial"><Input value={editing.trade_name ?? ""} onChange={(e) => setEditing({ ...editing, trade_name: e.target.value })} /></Field>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Type">
                        <Select value={editing.partner_type ?? "company"} onValueChange={(v) => setEditing({ ...editing, partner_type: v })}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="company">Société</SelectItem>
                            <SelectItem value="franchise">Franchise</SelectItem>
                            <SelectItem value="independent">Indépendant</SelectItem>
                            <SelectItem value="public">Public</SelectItem>
                          </SelectContent>
                        </Select>
                      </Field>
                      <Field label="Statut">
                        <Select value={editing.status ?? "active"} onValueChange={(v) => setEditing({ ...editing, status: v })}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="active">Actif</SelectItem>
                            <SelectItem value="suspended">Suspendu</SelectItem>
                            <SelectItem value="archived">Archivé</SelectItem>
                          </SelectContent>
                        </Select>
                      </Field>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Ville"><Input value={editing.city ?? ""} onChange={(e) => setEditing({ ...editing, city: e.target.value })} /></Field>
                      <Field label="Pays"><Input value={editing.country ?? ""} onChange={(e) => setEditing({ ...editing, country: e.target.value })} /></Field>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="N° TVA"><Input value={editing.vat_number ?? ""} onChange={(e) => setEditing({ ...editing, vat_number: e.target.value })} /></Field>
                      <Field label="Commission (%)"><Input type="number" min={0} max={100} value={editing.commission_rate ?? 0} onChange={(e) => setEditing({ ...editing, commission_rate: Number(e.target.value) })} /></Field>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Email"><Input type="email" value={editing.email ?? ""} onChange={(e) => setEditing({ ...editing, email: e.target.value })} /></Field>
                      <Field label="Téléphone"><Input value={editing.phone ?? ""} onChange={(e) => setEditing({ ...editing, phone: e.target.value })} /></Field>
                    </div>
                    <Field label="Responsable"><Input value={editing.manager_name ?? ""} onChange={(e) => setEditing({ ...editing, manager_name: e.target.value })} /></Field>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Date de début"><Input type="date" value={editing.start_date ?? ""} onChange={(e) => setEditing({ ...editing, start_date: e.target.value })} /></Field>
                      <Field label="Date de fin"><Input type="date" value={editing.end_date ?? ""} onChange={(e) => setEditing({ ...editing, end_date: e.target.value })} /></Field>
                    </div>
                    <Field label="Notes internes"><Textarea value={editing.notes ?? ""} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} /></Field>
                  </div>
                )}
                <DialogFooter>
                  <Button variant="ghost" onClick={() => setOpen(false)}>Annuler</Button>
                  <Button onClick={save} disabled={saving} className="gap-2">{saving && <Loader2 className="h-4 w-4 animate-spin" />}Enregistrer</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input placeholder="Rechercher (nom, ville, TVA, email)…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous les statuts</SelectItem>
            <SelectItem value="active">Actif</SelectItem>
            <SelectItem value="suspended">Suspendu</SelectItem>
            <SelectItem value="archived">Archivé</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">{filtered.length} partenaire(s)</span>
      </div>

      {loading
        ? <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        : <DataTable columns={columns} rows={tableRows} empty="Aucun partenaire. Créez le premier pour rattacher établissements et bornes." />}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
