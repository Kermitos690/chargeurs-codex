import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown, ArrowUp, BarChart3, Clock3, Image as ImageIcon, Loader2, Megaphone,
  MonitorPlay, Pause, Play, Plus, RefreshCw, Save, Trash2, Upload, Video,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

type CampaignStatus = "draft" | "scheduled" | "active" | "paused" | "archived";
type DisplayMode = "split" | "screensaver";

type Campaign = {
  id: string;
  name: string;
  status: CampaignStatus;
  display_modes: DisplayMode[];
  all_stations: boolean;
  starts_at: string | null;
  ends_at: string | null;
  idle_after_seconds: number;
  split_ratio: number | string;
  qr_url: string | null;
  priority: number;
  created_at: string;
  updated_at: string;
};

type Asset = {
  id: string;
  title: string;
  storage_path: string;
  media_type: "image" | "video";
  mime_type: string;
  file_size_bytes: number | null;
  width: number | null;
  height: number | null;
  duration_seconds: number | string | null;
  active: boolean;
  created_at: string;
};

type CampaignItem = {
  id: string;
  campaign_id: string;
  asset_id: string;
  sort_order: number;
  image_duration_seconds: number | null;
  enabled: boolean;
};

type CampaignTarget = { campaign_id: string; station_id: string };
type Station = { station_id: string; name: string; location_name: string | null; status: string | null; online: boolean | null };
type Impression = { campaign_id: string; asset_id: string; station_id: string; display_mode: DisplayMode; started_at: string; duration_ms: number | null; completed: boolean };

type AdsAdminResponse = {
  ok?: boolean;
  error?: string;
  campaigns?: Campaign[];
  assets?: Asset[];
  items?: CampaignItem[];
  targets?: CampaignTarget[];
  stations?: Station[];
  impressions?: Impression[];
  campaign?: Campaign;
  asset?: Asset;
  bucket?: string;
  path?: string;
  token?: string;
};

type EditState = {
  name: string;
  status: CampaignStatus;
  displayModes: DisplayMode[];
  allStations: boolean;
  startsAt: string;
  endsAt: string;
  idleAfterSeconds: number;
  splitPercent: number;
  qrUrl: string;
  priority: number;
  stationIds: string[];
  playlist: Array<{ assetId: string; imageDurationSeconds: number; enabled: boolean }>;
};

type MediaMeta = { width?: number; height?: number; durationSeconds?: number };

const WRITE_ROLES = new Set(["super_admin", "admin", "operations_admin", "advertising_manager"]);
const ACCEPTED = "image/jpeg,image/png,image/webp,video/mp4,video/webm";

function toLocalInput(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function toIso(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function validHttpsUrl(value: string): boolean {
  if (!value.trim()) return true;
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === "https:" && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

function bytesLabel(value: number | null): string {
  if (!value) return "—";
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} Mo`;
  return `${Math.round(value / 1024)} Ko`;
}

function dimensionsLabel(asset: Asset): string {
  return asset.width && asset.height ? `${asset.width}×${asset.height}` : "dimensions inconnues";
}

function statusLabel(status: CampaignStatus) {
  return ({ draft: "Brouillon", scheduled: "Planifiée", active: "Active", paused: "En pause", archived: "Archivée" } as const)[status];
}

function createEdit(campaign: Campaign, items: CampaignItem[], targets: CampaignTarget[]): EditState {
  return {
    name: campaign.name,
    status: campaign.status,
    displayModes: campaign.display_modes?.length ? campaign.display_modes : ["split", "screensaver"],
    allStations: campaign.all_stations,
    startsAt: toLocalInput(campaign.starts_at),
    endsAt: toLocalInput(campaign.ends_at),
    idleAfterSeconds: campaign.idle_after_seconds ?? 45,
    splitPercent: Math.max(32, Math.round(Number(campaign.split_ratio ?? .35) * 100)),
    qrUrl: campaign.qr_url ?? "",
    priority: campaign.priority ?? 100,
    stationIds: targets.filter((target) => target.campaign_id === campaign.id).map((target) => target.station_id),
    playlist: items.filter((item) => item.campaign_id === campaign.id).sort((a, b) => a.sort_order - b.sort_order).map((item) => ({
      assetId: item.asset_id,
      imageDurationSeconds: item.image_duration_seconds ?? 8,
      enabled: item.enabled,
    })),
  };
}

function probeMedia(file: File): Promise<MediaMeta> {
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    if (file.type.startsWith("image/")) {
      const image = new Image();
      image.onload = () => { URL.revokeObjectURL(objectUrl); resolve({ width: image.naturalWidth, height: image.naturalHeight }); };
      image.onerror = () => { URL.revokeObjectURL(objectUrl); resolve({}); };
      image.src = objectUrl;
      return;
    }
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      const duration = Number.isFinite(video.duration) ? video.duration : undefined;
      URL.revokeObjectURL(objectUrl);
      resolve({ width: video.videoWidth || undefined, height: video.videoHeight || undefined, durationSeconds: duration });
    };
    video.onerror = () => { URL.revokeObjectURL(objectUrl); resolve({}); };
    video.src = objectUrl;
  });
}

export default function AdminAdvertising() {
  const { roles } = useAuth();
  const canWrite = roles.some((role) => WRITE_ROLES.has(role));
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [items, setItems] = useState<CampaignItem[]>([]);
  const [targets, setTargets] = useState<CampaignTarget[]>([]);
  const [stations, setStations] = useState<Station[]>([]);
  const [impressions, setImpressions] = useState<Impression[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [newCampaignName, setNewCampaignName] = useState("");
  const [assetToAdd, setAssetToAdd] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const invoke = useCallback(async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke<AdsAdminResponse>("ads-admin", { body });
    if (error || !data?.ok) throw new Error(data?.error ?? error?.message ?? "ADS_ADMIN_FAILED");
    return data;
  }, []);

  const load = useCallback(async (keepSelection = true) => {
    setLoading(true);
    try {
      const data = await invoke({ action: "list" });
      const nextCampaigns = data.campaigns ?? [];
      setCampaigns(nextCampaigns);
      setAssets(data.assets ?? []);
      setItems(data.items ?? []);
      setTargets(data.targets ?? []);
      setStations(data.stations ?? []);
      setImpressions(data.impressions ?? []);
      setSelectedId((current) => keepSelection && current && nextCampaigns.some((campaign) => campaign.id === current)
        ? current
        : nextCampaigns[0]?.id ?? null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Impossible de charger Chargeurs Ads.");
    } finally {
      setLoading(false);
    }
  }, [invoke]);

  useEffect(() => { void load(false); }, [load]);

  const selected = campaigns.find((campaign) => campaign.id === selectedId) ?? null;
  useEffect(() => {
    if (!selected) { setEdit(null); return; }
    setEdit(createEdit(selected, items, targets));
  }, [items, selected, targets]);

  const stats = useMemo(() => {
    const totalMs = impressions.reduce((sum, row) => sum + Number(row.duration_ms ?? 0), 0);
    const screensaver = impressions.filter((row) => row.display_mode === "screensaver").length;
    const uniqueStations = new Set(impressions.map((row) => row.station_id)).size;
    return { impressions: impressions.length, totalHours: totalMs / 3_600_000, screensaver, uniqueStations };
  }, [impressions]);

  const createCampaign = async () => {
    const name = newCampaignName.trim();
    if (!name || !canWrite) return;
    setSaving(true);
    try {
      const data = await invoke({ action: "create_campaign", name, displayModes: ["split", "screensaver"], allStations: true });
      setNewCampaignName("");
      await load(false);
      if (data.campaign?.id) setSelectedId(data.campaign.id);
      toast.success("Campagne créée.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Création impossible.");
    } finally {
      setSaving(false);
    }
  };

  const saveCampaign = async () => {
    if (!selected || !edit || !canWrite) return;
    if (!edit.name.trim()) { toast.error("Le nom de campagne est obligatoire."); return; }
    if (!edit.displayModes.length) { toast.error("Choisissez au moins un mode d’affichage."); return; }
    if (!validHttpsUrl(edit.qrUrl)) { toast.error("Le lien QR doit être une adresse HTTPS valide."); return; }
    const startsAt = toIso(edit.startsAt);
    const endsAt = toIso(edit.endsAt);
    if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) { toast.error("La date de fin doit être après le début."); return; }
    setSaving(true);
    try {
      await invoke({
        action: "update_campaign", campaignId: selected.id, name: edit.name.trim(), status: edit.status,
        displayModes: edit.displayModes, allStations: edit.allStations, startsAt, endsAt,
        idleAfterSeconds: edit.idleAfterSeconds, splitRatio: edit.splitPercent / 100,
        qrUrl: edit.qrUrl.trim() || null, priority: edit.priority,
      });
      await invoke({
        action: "set_campaign_items", campaignId: selected.id,
        items: edit.playlist.map((row) => ({ assetId: row.assetId, imageDurationSeconds: row.imageDurationSeconds, enabled: row.enabled })),
      });
      await invoke({
        action: "set_campaign_stations", campaignId: selected.id,
        allStations: edit.allStations, stationIds: edit.allStations ? [] : edit.stationIds,
      });
      await load(true);
      toast.success("Campagne publiée dans la configuration des bornes.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Enregistrement impossible.");
    } finally {
      setSaving(false);
    }
  };

  const quickStatus = async (status: CampaignStatus) => {
    if (!selected || !canWrite) return;
    setSaving(true);
    try {
      await invoke({ action: "update_campaign", campaignId: selected.id, status });
      await load(true);
      toast.success(status === "active" ? "Campagne activée." : "Campagne mise en pause.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Mise à jour impossible.");
    } finally {
      setSaving(false);
    }
  };

  const uploadFile = async (file: File | null) => {
    if (!file || !canWrite) return;
    if (!ACCEPTED.split(",").includes(file.type)) { toast.error("Format non supporté. Utilisez JPG, PNG, WebP, MP4 ou WebM."); return; }
    if (file.size > 100 * 1024 * 1024) { toast.error("Le média dépasse 100 Mo."); return; }
    setUploading(true);
    try {
      const metaPromise = probeMedia(file);
      const prepared = await invoke({ action: "prepare_upload", filename: file.name, mimeType: file.type, size: file.size });
      if (!prepared.bucket || !prepared.path || !prepared.token) throw new Error("UPLOAD_PREPARATION_FAILED");
      const { error: uploadError } = await supabase.storage.from(prepared.bucket).uploadToSignedUrl(prepared.path, prepared.token, file, {
        contentType: file.type,
        cacheControl: "31536000",
      });
      if (uploadError) throw uploadError;
      const meta = await metaPromise;
      await invoke({
        action: "register_asset", path: prepared.path, title: file.name.replace(/\.[^.]+$/, ""), mimeType: file.type, size: file.size,
        width: meta.width, height: meta.height, durationSeconds: meta.durationSeconds,
      });
      await load(true);
      toast.success("Média ajouté. Le rendu borne adaptera automatiquement son cadrage à l’accueil.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload impossible.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const deleteAsset = async (assetId: string) => {
    if (!canWrite) return;
    try {
      await invoke({ action: "delete_asset", assetId });
      await load(true);
      toast.success("Média supprimé.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Suppression impossible.";
      toast.error(message === "ASSET_IN_USE" ? "Ce média est utilisé dans une campagne." : message);
    }
  };

  const movePlaylist = (index: number, delta: number) => {
    if (!edit) return;
    const nextIndex = index + delta;
    if (nextIndex < 0 || nextIndex >= edit.playlist.length) return;
    const playlist = [...edit.playlist];
    [playlist[index], playlist[nextIndex]] = [playlist[nextIndex], playlist[index]];
    setEdit({ ...edit, playlist });
  };

  const addAsset = () => {
    if (!edit || !assetToAdd || edit.playlist.some((row) => row.assetId === assetToAdd)) return;
    setEdit({ ...edit, playlist: [...edit.playlist, { assetId: assetToAdd, imageDurationSeconds: 8, enabled: true }] });
    setAssetToAdd("");
  };

  const availableAssets = assets.filter((asset) => !edit?.playlist.some((row) => row.assetId === asset.id));

  return (
    <div className="animate-fade-in space-y-6 pb-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2 text-sm font-bold uppercase tracking-[.16em] text-primary"><Megaphone className="h-4 w-4" /> Chargeurs Ads</div>
          <h1 className="font-display text-3xl font-bold">Publicités sur les bornes</h1>
          <p className="mt-2 max-w-3xl text-muted-foreground">Photos et vidéos en défilement, accueil intégré et écran de veille plein écran. Le parcours de location reste toujours prioritaire.</p>
        </div>
        <Button variant="ghost" className="gap-2" onClick={() => void load(true)} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Actualiser
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Stat icon={BarChart3} label="Impressions · 30 j" value={String(stats.impressions)} />
        <Stat icon={Clock3} label="Temps affiché · 30 j" value={`${stats.totalHours.toFixed(1)} h`} />
        <Stat icon={MonitorPlay} label="Bornes touchées" value={String(stats.uniqueStations)} />
        <Stat icon={Play} label="Plein écran" value={String(stats.screensaver)} />
      </div>

      {!canWrite && <div className="rounded-2xl border border-warning/30 bg-warning/10 p-4 text-sm text-warning">Mode lecture seule : votre rôle permet de consulter les campagnes mais pas de les modifier.</div>}

      <div className="grid gap-6 xl:grid-cols-[22rem_minmax(0,1fr)]">
        <aside className="space-y-4">
          <section className="glass liquid-border rounded-2xl p-4">
            <h2 className="font-display text-lg font-bold">Campagnes</h2>
            <div className="mt-3 flex gap-2">
              <input value={newCampaignName} onChange={(event) => setNewCampaignName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void createCampaign(); }} disabled={!canWrite || saving} placeholder="Nouvelle campagne" className="min-w-0 flex-1 rounded-xl border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:border-primary" />
              <Button size="icon" onClick={() => void createCampaign()} disabled={!canWrite || saving || !newCampaignName.trim()} aria-label="Créer"><Plus className="h-4 w-4" /></Button>
            </div>
            <div className="mt-4 space-y-2">
              {campaigns.map((campaign) => (
                <button key={campaign.id} type="button" onClick={() => setSelectedId(campaign.id)} className={`w-full rounded-xl border p-3 text-left transition ${selectedId === campaign.id ? "border-primary/60 bg-primary/10" : "border-border/70 bg-muted/20 hover:bg-muted/40"}`}>
                  <div className="flex items-start justify-between gap-2"><strong className="line-clamp-2 text-sm">{campaign.name}</strong><Status status={campaign.status} /></div>
                  <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
                    {campaign.display_modes.includes("split") && <span className="rounded-full bg-muted px-2 py-1">Accueil</span>}
                    {campaign.display_modes.includes("screensaver") && <span className="rounded-full bg-muted px-2 py-1">Veille</span>}
                    {campaign.qr_url && <span className="rounded-full bg-muted px-2 py-1">QR</span>}
                    <span className="rounded-full bg-muted px-2 py-1">{campaign.all_stations ? "Toutes bornes" : "Ciblée"}</span>
                  </div>
                </button>
              ))}
              {!loading && campaigns.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">Aucune campagne.</p>}
            </div>
          </section>
        </aside>

        <main className="min-w-0 space-y-6">
          {selected && edit ? (
            <>
              <section className="glass liquid-border rounded-2xl p-5 sm:p-6">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div><h2 className="font-display text-2xl font-bold">Configuration</h2><p className="mt-1 text-sm text-muted-foreground">Décidez où, quand et sous quelle forme cette campagne apparaît.</p></div>
                  <div className="flex gap-2">
                    {selected.status === "active" ? <Button variant="outline" className="gap-2" disabled={!canWrite || saving} onClick={() => void quickStatus("paused")}><Pause className="h-4 w-4" /> Pause</Button> : <Button variant="outline" className="gap-2" disabled={!canWrite || saving || edit.playlist.length === 0} onClick={() => void quickStatus("active")}><Play className="h-4 w-4" /> Activer</Button>}
                    <Button className="gap-2" disabled={!canWrite || saving} onClick={() => void saveCampaign()}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Enregistrer</Button>
                  </div>
                </div>

                <div className="mt-6 grid gap-5 lg:grid-cols-2">
                  <Field label="Nom de la campagne"><input value={edit.name} disabled={!canWrite} onChange={(event) => setEdit({ ...edit, name: event.target.value })} className="ad-input" /></Field>
                  <Field label="État"><select value={edit.status} disabled={!canWrite} onChange={(event) => setEdit({ ...edit, status: event.target.value as CampaignStatus })} className="ad-input"><option value="draft">Brouillon</option><option value="scheduled">Planifiée</option><option value="active">Active</option><option value="paused">En pause</option><option value="archived">Archivée</option></select></Field>
                  <Field label="Début (facultatif)"><input type="datetime-local" value={edit.startsAt} disabled={!canWrite} onChange={(event) => setEdit({ ...edit, startsAt: event.target.value })} className="ad-input" /></Field>
                  <Field label="Fin (facultatif)"><input type="datetime-local" value={edit.endsAt} disabled={!canWrite} onChange={(event) => setEdit({ ...edit, endsAt: event.target.value })} className="ad-input" /></Field>
                  <div className="lg:col-span-2"><Field label="Lien du QR publicitaire (facultatif)"><input type="url" inputMode="url" value={edit.qrUrl} disabled={!canWrite} onChange={(event) => setEdit({ ...edit, qrUrl: event.target.value })} placeholder="https://partenaire.ch/offre" className="ad-input" /></Field><p className="mt-2 text-xs text-muted-foreground">Le QR apparaît automatiquement sur l’accueil et en plein écran pour cette campagne. HTTPS uniquement.</p></div>
                </div>

                <div className="mt-6 grid gap-4 md:grid-cols-2">
                  <ToggleCard title="Accueil intégré" body="La publicité devient le rail droit de l’accueil au lieu d’une fenêtre posée dessus." active={edit.displayModes.includes("split")} disabled={!canWrite} onChange={(active) => setEdit({ ...edit, displayModes: active ? [...edit.displayModes.filter((mode) => mode !== "split"), "split"] : edit.displayModes.filter((mode) => mode !== "split") })} icon={MonitorPlay} />
                  <ToggleCard title="Écran de veille" body="Après inactivité, la publicité passe en plein écran jusqu’au prochain toucher." active={edit.displayModes.includes("screensaver")} disabled={!canWrite} onChange={(active) => setEdit({ ...edit, displayModes: active ? [...edit.displayModes.filter((mode) => mode !== "screensaver"), "screensaver"] : edit.displayModes.filter((mode) => mode !== "screensaver") })} icon={Clock3} />
                </div>

                <div className="mt-5 grid gap-5 md:grid-cols-3">
                  <Field label={`Veille après ${edit.idleAfterSeconds} s`}><input type="range" min="10" max="180" step="5" value={edit.idleAfterSeconds} disabled={!canWrite} onChange={(event) => setEdit({ ...edit, idleAfterSeconds: Number(event.target.value) })} className="w-full" /></Field>
                  <Field label={`Largeur publicité ${edit.splitPercent}%`}><input type="range" min="32" max="46" step="1" value={edit.splitPercent} disabled={!canWrite} onChange={(event) => setEdit({ ...edit, splitPercent: Number(event.target.value) })} className="w-full" /></Field>
                  <Field label="Priorité"><input type="number" min="0" max="10000" value={edit.priority} disabled={!canWrite} onChange={(event) => setEdit({ ...edit, priority: Number(event.target.value) })} className="ad-input" /></Field>
                </div>
              </section>

              <section className="glass liquid-border rounded-2xl p-5 sm:p-6">
                <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-display text-xl font-bold">Playlist</h2><p className="mt-1 text-sm text-muted-foreground">L’ordre ci-dessous est exactement l’ordre de diffusion. Les visuels paysage sont adaptés automatiquement au rail d’accueil.</p></div><span className="rounded-full bg-muted px-3 py-1 text-xs font-bold">{edit.playlist.length} média{edit.playlist.length > 1 ? "s" : ""}</span></div>
                <div className="mt-4 space-y-2">
                  {edit.playlist.map((row, index) => {
                    const asset = assets.find((candidate) => candidate.id === row.assetId);
                    if (!asset) return null;
                    return (
                      <div key={row.assetId} className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-background/35 p-3">
                        <Preview asset={asset} compact />
                        <div className="min-w-0 flex-1"><div className="truncate font-semibold">{asset.title}</div><div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground"><span>{asset.media_type === "video" ? "Vidéo" : "Image"}</span><span>{dimensionsLabel(asset)}</span><span>#{index + 1}</span></div></div>
                        {asset.media_type === "image" && <label className="flex items-center gap-2 text-xs text-muted-foreground">Durée <input type="number" min="2" max="300" value={row.imageDurationSeconds} disabled={!canWrite} onChange={(event) => { const playlist = [...edit.playlist]; playlist[index] = { ...row, imageDurationSeconds: Number(event.target.value) }; setEdit({ ...edit, playlist }); }} className="w-16 rounded-lg border border-border bg-background px-2 py-1.5 text-foreground" /> s</label>}
                        <div className="flex gap-1"><Button size="icon" variant="ghost" disabled={!canWrite || index === 0} onClick={() => movePlaylist(index, -1)}><ArrowUp className="h-4 w-4" /></Button><Button size="icon" variant="ghost" disabled={!canWrite || index === edit.playlist.length - 1} onClick={() => movePlaylist(index, 1)}><ArrowDown className="h-4 w-4" /></Button><Button size="icon" variant="ghost" disabled={!canWrite} onClick={() => setEdit({ ...edit, playlist: edit.playlist.filter((_, itemIndex) => itemIndex !== index) })}><Trash2 className="h-4 w-4" /></Button></div>
                      </div>
                    );
                  })}
                  {edit.playlist.length === 0 && <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">Ajoutez une photo ou une vidéo depuis la bibliothèque ci-dessous.</div>}
                </div>
                <div className="mt-4 flex flex-wrap gap-2"><select value={assetToAdd} disabled={!canWrite || availableAssets.length === 0} onChange={(event) => setAssetToAdd(event.target.value)} className="ad-input min-w-[16rem] flex-1"><option value="">Choisir un média…</option>{availableAssets.map((asset) => <option key={asset.id} value={asset.id}>{asset.title} · {asset.media_type === "video" ? "vidéo" : "image"}</option>)}</select><Button variant="outline" className="gap-2" disabled={!canWrite || !assetToAdd} onClick={addAsset}><Plus className="h-4 w-4" /> Ajouter à la playlist</Button></div>
              </section>

              <section className="glass liquid-border rounded-2xl p-5 sm:p-6">
                <h2 className="font-display text-xl font-bold">Bornes ciblées</h2>
                <label className="mt-4 flex cursor-pointer items-center gap-3 rounded-xl border border-border bg-background/35 p-4"><input type="checkbox" checked={edit.allStations} disabled={!canWrite} onChange={(event) => setEdit({ ...edit, allStations: event.target.checked })} className="h-5 w-5" /><div><strong>Toutes les bornes</strong><p className="text-sm text-muted-foreground">La campagne suit automatiquement l’extension du réseau.</p></div></label>
                {!edit.allStations && <div className="mt-3 grid gap-2 md:grid-cols-2">{stations.map((station) => { const checked = edit.stationIds.includes(station.station_id); return <label key={station.station_id} className="flex cursor-pointer items-center gap-3 rounded-xl border border-border p-3"><input type="checkbox" checked={checked} disabled={!canWrite} onChange={(event) => setEdit({ ...edit, stationIds: event.target.checked ? [...edit.stationIds, station.station_id] : edit.stationIds.filter((id) => id !== station.station_id) })} className="h-4 w-4" /><span className="min-w-0 flex-1"><strong className="block truncate text-sm">{station.name}</strong><small className="text-muted-foreground">{station.station_id}{station.location_name ? ` · ${station.location_name}` : ""}</small></span><span className={`h-2.5 w-2.5 rounded-full ${station.online ? "bg-success" : "bg-muted-foreground"}`} /></label>; })}</div>}
              </section>
            </>
          ) : <div className="glass rounded-2xl p-10 text-center text-muted-foreground">Créez ou sélectionnez une campagne.</div>}
        </main>
      </div>

      <section className="glass liquid-border rounded-2xl p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="font-display text-xl font-bold">Médiathèque</h2><p className="mt-1 text-sm text-muted-foreground">JPG, PNG, WebP, MP4 ou WebM · 100 Mo maximum. Les images paysage sont automatiquement adaptées au format du rail sur la borne.</p></div><div><input ref={fileInputRef} type="file" accept={ACCEPTED} className="hidden" onChange={(event) => void uploadFile(event.target.files?.[0] ?? null)} /><Button className="gap-2" disabled={!canWrite || uploading} onClick={() => fileInputRef.current?.click()}>{uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Ajouter photo / vidéo</Button></div></div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {assets.map((asset) => <div key={asset.id} className="overflow-hidden rounded-2xl border border-border bg-background/35"><Preview asset={asset} /><div className="p-3"><div className="truncate font-semibold">{asset.title}</div><div className="mt-1 flex items-center justify-between gap-2 text-xs text-muted-foreground"><span>{asset.media_type === "video" ? "Vidéo" : "Image"} · {dimensionsLabel(asset)} · {bytesLabel(asset.file_size_bytes)}</span><Button size="icon" variant="ghost" disabled={!canWrite} onClick={() => void deleteAsset(asset.id)} aria-label="Supprimer"><Trash2 className="h-4 w-4" /></Button></div></div></div>)}
          {!loading && assets.length === 0 && <button type="button" onClick={() => canWrite && fileInputRef.current?.click()} className="grid min-h-56 place-items-center rounded-2xl border border-dashed border-border text-muted-foreground"><span className="flex flex-col items-center gap-2"><Upload className="h-7 w-7" /><b>Ajouter le premier média</b></span></button>}
        </div>
      </section>
    </div>
  );
}

function Stat({ icon: Icon, label, value }: { icon: typeof Megaphone; label: string; value: string }) {
  return <div className="glass rounded-2xl p-4"><div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground"><Icon className="h-4 w-4 text-primary" />{label}</div><div className="mt-2 font-display text-2xl font-bold">{value}</div></div>;
}

function Status({ status }: { status: CampaignStatus }) {
  const cls = status === "active" ? "bg-success/15 text-success" : status === "paused" ? "bg-warning/15 text-warning" : "bg-muted text-muted-foreground";
  return <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-wide ${cls}`}>{statusLabel(status)}</span>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-2 block text-xs font-bold uppercase tracking-wider text-muted-foreground">{label}</span>{children}</label>;
}

function ToggleCard({ title, body, active, disabled, onChange, icon: Icon }: { title: string; body: string; active: boolean; disabled: boolean; onChange: (active: boolean) => void; icon: typeof MonitorPlay }) {
  return <button type="button" disabled={disabled} onClick={() => onChange(!active)} className={`flex min-h-32 w-full items-start gap-4 rounded-2xl border p-4 text-left transition ${active ? "border-primary/55 bg-primary/10" : "border-border bg-background/30"} disabled:cursor-not-allowed disabled:opacity-70`}><span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}><Icon className="h-5 w-5" /></span><span><strong className="block text-base">{title}</strong><small className="mt-1 block text-sm leading-relaxed text-muted-foreground">{body}</small></span><span className={`ml-auto mt-1 h-5 w-9 shrink-0 rounded-full p-0.5 transition ${active ? "bg-primary" : "bg-muted"}`}><span className={`block h-4 w-4 rounded-full bg-white transition-transform ${active ? "translate-x-4" : ""}`} /></span></button>;
}

function Preview({ asset, compact = false }: { asset: Asset; compact?: boolean }) {
  const url = supabase.storage.from("advertising-media").getPublicUrl(asset.storage_path).data.publicUrl;
  if (compact) return <div className="relative h-12 w-16 shrink-0 overflow-hidden rounded-lg bg-muted">{asset.media_type === "image" ? <img src={url} alt="" className="h-full w-full object-cover" /> : <div className="grid h-full w-full place-items-center"><Video className="h-5 w-5 text-primary" /></div>}</div>;
  return <div className="relative aspect-video bg-muted">{asset.media_type === "image" ? <img src={url} alt={asset.title} className="h-full w-full object-cover" loading="lazy" /> : <video src={url} muted playsInline preload="metadata" className="h-full w-full object-cover" />}{asset.media_type === "video" ? <span className="absolute left-2 top-2 grid h-8 w-8 place-items-center rounded-full bg-black/65 text-white"><Video className="h-4 w-4" /></span> : <span className="absolute left-2 top-2 grid h-8 w-8 place-items-center rounded-full bg-black/65 text-white"><ImageIcon className="h-4 w-4" /></span>}</div>;
}
