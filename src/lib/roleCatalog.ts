export type PlatformRole =
  | "super_admin" | "admin" | "platform_admin" | "operations_admin" | "finance_admin"
  | "support_manager" | "support_agent" | "maintenance_manager" | "maintenance_technician"
  | "powerbank_manager" | "mifi_manager" | "advertising_manager" | "reports_analyst"
  | "franchise_owner" | "franchise_admin" | "franchise_staff"
  | "agency_owner" | "agency_admin" | "agency_staff"
  | "partner_owner" | "partner_staff" | "venue_manager" | "venue_staff"
  | "vip_customer" | "customer" | "viewer" | "operator" | "staff" | "user" | "kiosk_device" | "api_client";

export type RoleDefinition = {
  id: PlatformRole;
  label: string;
  scope: "platform" | "organization" | "customer" | "system";
  backOffice: boolean;
  description: string;
};

// This catalogue only controls presentation. RLS and Edge Functions remain
// authoritative and intentionally fail closed for any role not whitelisted.
export const ROLE_CATALOG: readonly RoleDefinition[] = [
  { id: "super_admin", label: "Super administrateur", scope: "platform", backOffice: true, description: "Gouvernance complète de la plateforme." },
  { id: "admin", label: "Administrateur historique", scope: "platform", backOffice: true, description: "Compatibilité avec les accès existants." },
  { id: "platform_admin", label: "Administrateur plateforme", scope: "platform", backOffice: true, description: "Administration transversale sans délégation implicite." },
  { id: "operations_admin", label: "Administrateur opérations", scope: "platform", backOffice: true, description: "Pilotage opérationnel des bornes et locations." },
  { id: "finance_admin", label: "Administrateur finance", scope: "platform", backOffice: true, description: "Paiements, remboursements et rapprochements." },
  { id: "support_manager", label: "Responsable support", scope: "platform", backOffice: true, description: "Gestion et escalade du support." },
  { id: "support_agent", label: "Agent support", scope: "platform", backOffice: true, description: "Traitement des demandes clients." },
  { id: "maintenance_manager", label: "Responsable maintenance", scope: "platform", backOffice: true, description: "Supervision de la maintenance." },
  { id: "maintenance_technician", label: "Technicien maintenance", scope: "platform", backOffice: true, description: "Interventions autorisées et diagnostics." },
  { id: "powerbank_manager", label: "Responsable Power Bank", scope: "platform", backOffice: true, description: "Exploitation Power Bank." },
  { id: "mifi_manager", label: "Responsable MIFI", scope: "platform", backOffice: true, description: "Exploitation MIFI." },
  { id: "advertising_manager", label: "Responsable publicité", scope: "platform", backOffice: true, description: "Campagnes et contenus publicitaires." },
  { id: "reports_analyst", label: "Analyste rapports", scope: "platform", backOffice: true, description: "Rapports et indicateurs en lecture." },
  { id: "franchise_owner", label: "Propriétaire franchise", scope: "organization", backOffice: true, description: "Vue de sa franchise uniquement." },
  { id: "franchise_admin", label: "Administrateur franchise", scope: "organization", backOffice: true, description: "Administration de sa franchise uniquement." },
  { id: "franchise_staff", label: "Équipe franchise", scope: "organization", backOffice: true, description: "Opérations limitées à sa franchise." },
  { id: "agency_owner", label: "Propriétaire agence", scope: "organization", backOffice: true, description: "Vue de son agence uniquement." },
  { id: "agency_admin", label: "Administrateur agence", scope: "organization", backOffice: true, description: "Administration de son agence uniquement." },
  { id: "agency_staff", label: "Équipe agence", scope: "organization", backOffice: true, description: "Opérations limitées à son agence." },
  { id: "partner_owner", label: "Propriétaire partenaire", scope: "organization", backOffice: true, description: "Vue de son organisation partenaire." },
  { id: "partner_staff", label: "Équipe partenaire", scope: "organization", backOffice: true, description: "Accès délégué du partenaire." },
  { id: "venue_manager", label: "Responsable établissement", scope: "organization", backOffice: true, description: "Vue de son établissement." },
  { id: "venue_staff", label: "Équipe établissement", scope: "organization", backOffice: true, description: "Consultation d’établissement." },
  { id: "vip_customer", label: "Client VIP", scope: "customer", backOffice: false, description: "Avantages client sans droits administratifs." },
  { id: "customer", label: "Client", scope: "customer", backOffice: false, description: "Espace client." },
  { id: "viewer", label: "Lecteur historique", scope: "platform", backOffice: true, description: "Lecture seule héritée." },
  { id: "operator", label: "Opérateur historique", scope: "platform", backOffice: true, description: "Opérations héritées." },
  { id: "staff", label: "Équipe historique", scope: "platform", backOffice: true, description: "Accès hérité limité." },
  { id: "user", label: "Utilisateur historique", scope: "customer", backOffice: false, description: "Compatibilité client." },
  { id: "kiosk_device", label: "Appareil kiosk", scope: "system", backOffice: false, description: "Identité système non attribuable dans l’UI." },
  { id: "api_client", label: "Client API", scope: "system", backOffice: false, description: "Identité système non attribuable dans l’UI." },
] as const;

export const ASSIGNABLE_ROLE_IDS = ROLE_CATALOG
  .filter((role) => role.scope !== "system")
  .map((role) => role.id) as readonly PlatformRole[];

// The remote staging enum has not yet received the additive role migration.
// Keep the administration screen truthful: roles outside this list are shown
// as planned, never submitted to an endpoint that cannot persist them.
export const STAGING_ASSIGNABLE_ROLE_IDS = [
  "super_admin", "admin", "operations_admin", "finance_admin",
  "support_agent", "maintenance_technician", "partner_owner",
  "partner_staff", "customer", "viewer", "operator", "staff",
] as const satisfies readonly PlatformRole[];

export const PENDING_STAGING_ROLE_IDS = ASSIGNABLE_ROLE_IDS
  .filter((role) => !STAGING_ASSIGNABLE_ROLE_IDS.includes(role as typeof STAGING_ASSIGNABLE_ROLE_IDS[number]));

export function roleLabel(role: string): string {
  return ROLE_CATALOG.find((definition) => definition.id === role)?.label ?? role;
}
