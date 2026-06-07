
# Moteur tarifaire complet — Chargeurs.ch

## Audit de l'existant (matrice)

| Élément | État réel | Action |
|---|---|---|
| `price_profiles` (id, name, amount, currency, period_label, is_default, active, shop_id, chargenow_price_id) | Existant mais **incomplet** (pas de règles de facturation, pas de version/validité/priorité, montant en `numeric` pas en centimes) | Compléter |
| `price_profiles.amount` DEFAULT `2.00` | **Contradictoire** (fallback caché) | Supprimer le DEFAULT |
| `stations.price_per_period` = `2.00` (3 stations) | **Contradictoire / ancien champ tarifaire** servant de fallback dans `create-rental-session` | Déprécier (ne plus l'utiliser comme fallback) |
| Table d'affectation tarif↔station/borne/boutique | **Inexistante** | Construire (`price_assignments`) |
| Fonction SQL de résolution/priorité | **Inexistante** (logique éparpillée dans l'edge function) | Construire (`resolve_price_profile`) |
| Fonction SQL de calcul | **Inexistante** | Construire (`compute_pricing`) |
| Snapshot tarifaire sur `rental_sessions` | **Inexistant** | Ajouter colonnes |
| `create-rental-session` / `create-stripe-checkout` | Existants, fallback `2.0` déjà retiré, mais ne passent pas par le moteur central ni le snapshot/metadata complet | Connecter |
| `/admin/pricing` (`AdminPricing.tsx`) | Existant mais **partiel** (CRUD basique, amount par défaut "2.00" codé dans le form, pas d'affectations, pas de simulateur) | Reconstruire |
| `/admin/pricing/:id` | **Inexistant** | Construire |
| RLS `price_profiles` : `Public read prices` (anon+auth, `true`) | **Contradictoire** (le kiosk/anon lit TOUS les profils) | Restreindre |
| Rôles `super_admin/operator/viewer/kiosk_device/customer` | Enum étendu mais **non utilisés** dans les RLS | Connecter |
| `audit_logs` (actor, action, target, data) | Existant, **inutilisé** pour la tarification | Connecter |
| Montants codés en dur restants | `price_profiles.amount` DEFAULT 2.00, `stations.price_per_period` 2.00, form `AdminPricing` "2.00" | Tous supprimés |

## 1. Migration BDD

**Étendre `price_profiles`** (tout en centimes entiers, `*_cents`) :
- Identification : `description`, `valid_from`, `valid_to`, `priority int`, `version int default 1`, `updated_by uuid`
- Facturation : `initial_fee_cents`, `included_minutes`, `period_minutes`, `price_per_period_cents`, `grace_minutes`, `daily_cap_cents`, `total_cap_cents`, `max_amount_cents`, `deposit_cents`, `late_fee_cents`, `unreturned_fee_cents`, `unreturned_after_minutes`, `min_amount_cents`, `rounding text` (`none|up_5|up_10`), `tax_percent numeric`
- Migrer `amount`→`price_per_period_cents` (0.50→50), supprimer DEFAULT 2.00 sur `amount`
- `price_profile_versions` (table immuable d'historique : snapshot jsonb à chaque update via trigger)

**Nouvelle table `price_assignments`** : `scope` (`device|station|shop`), `scope_ref text`, `price_profile_id`, `active`, unicité (scope, scope_ref) actif. + GRANT + RLS admin-only.

**`rental_sessions`** : ajouter `pricing_snapshot jsonb`, `price_profile_version int`, `pricing_snapshot_hash text`, `kiosk_device_id text`.

**Fonctions SQL autoritaires (SECURITY DEFINER, search_path public)** :
- `resolve_price_profile(p_device, p_station, p_shop)` → applique la priorité borne→station→boutique→défaut global, ignore inactifs/expirés, retourne le profil ou NULL.
- `compute_pricing(p_device, p_station, p_shop, p_start, p_end, p_rental_state, p_return_state, p_currency)` → retourne un `jsonb` snapshot complet (profil, version, source, durée facturée, périodes, montant initial, montant durée, frais, plafonds appliqués, montant final cents, devise, détail, computed_at). Lève `PRICING_NOT_CONFIGURED` si aucun profil.
- `effective_price(p_station, p_device)` (SECURITY DEFINER) → expose au kiosk **uniquement** le tarif effectif de SA borne (nom, montant, devise, période), jamais la liste.

## 2. RLS & rôles
- `price_profiles` : supprimer `Public read prices`. Lecture admin/super_admin/operator/viewer ; écriture admin/super_admin. Le kiosk/anon n'y accède plus directement.
- `price_assignments` / `price_profile_versions` : admin/super_admin uniquement.
- Kiosk lit le tarif via RPC `effective_price` (SECURITY DEFINER, paramétré par sa station) — pas d'accès table.
- Helper `has_any_role(uuid, app_role[])` pour factoriser.

## 3. Edge Functions
- `create-rental-session` : appeler `compute_pricing` (jamais `station.price_per_period`), stocker `pricing_snapshot`, `pricing_snapshot_hash` (sha-256), `price_profile_id/version`, `amount_expected` = montant snapshot, `kiosk_device_id`. Refus `PRICING_NOT_CONFIGURED` / borne inactive.
- `create-stripe-checkout` : montant = `amount_expected` du snapshot serveur uniquement ; refuser si snapshot/hash invalide, devise incohérente, montant ≤ 0, profil expiré. Metadata Stripe : `rental_session_id, station_id, kiosk_device_id, shop_id, price_profile_id, price_profile_version, pricing_snapshot_hash`.
- `stripe-webhook` : vérifier que le montant payé == `amount_expected` avant d'autoriser l'éjection (déjà idempotent). Log incident si écart.
- Insert `audit_logs` à chaque opération tarifaire (création/maj/activation/défaut/affectation/calcul kiosk/création paiement/erreur), avec corrélation `rental_session_id`. Jamais de secret/token.
- Nouvelle fn `pricing-admin` : CRUD profils + affectations + simulation, garde `has_role(admin|super_admin)` (operator = simulation seule), écrit les audit logs côté serveur (pas de service_role exposé au frontend).

## 4. Frontend
- **`/admin/pricing`** : tableau (nom, statut, devise, prix période, plafond, #stations/#boutiques/#bornes affectées, défaut, validité, dernière modif, actions) + recherche/filtre/tri/pagination/duplication/toggle/suppr (si aucune dépendance)/confirmations. Form complet (validation zod, montants ≥ 0, période > 0, devise) + simulateur live (appelle `compute_pricing` via `pricing-admin`).
- **`/admin/pricing/:id`** (nouvelle route) : infos, règles, affectations (ajout/retrait borne/station/boutique), historique versions, simulations, locations récentes du tarif, incidents, journal des modifs, boutons test-kiosk/duplication/toggle.
- **Kiosk** : récupère le tarif via RPC `effective_price(station, device)` au lieu de lister `price_profiles` ; affiche le prix effectif ; envoie uniquement `stationId` (+ token borne) — jamais le montant.

## 5. Données de test
- Mettre `price_per_period_cents` du profil Standard (0.50 CHF → 50) ; conservé comme **donnée configurable** active par défaut, jamais comme fallback code.
- Ne pas inventer de boutiques/bornes prod.

## 6. Tests (`vitest` + tests SQL via read_query)
- Unitaires `compute_pricing` : <1 période, 1 période, n périodes, grâce, plafond jour, plafond total, retard, batterie non rendue, changement de jour, profil expiré, profil inactif, aucun profil (409), arrondi, centimes.
- Priorité : borne>station>boutique>global>409.
- RLS positifs/négatifs par rôle (super_admin/operator/viewer/customer/kiosk_device/anon).
- E2E kiosk : ouverture → résolution → affichage → session → checkout Stripe → vérif montant Stripe == snapshot == affiché → (webhook/éjection classés **NON TESTÉ** sans paiement réel).

## Détails techniques
- Calculs en **centimes entiers**, arrondi explicite par profil.
- Snapshot = source de vérité immuable par location ; modifier un profil n'altère pas les locations passées (historisé via `price_profile_versions` + snapshot figé).
- Hash snapshot (sha-256 du jsonb canonique) propagé dans Stripe metadata pour traçabilité.

## Livrable final
Rapport avec : fichiers modifiés, migrations, tables/fonctions, routes, edge functions, matrice rôles, tests exécutés + résultats exacts, exemple de calcul, preuve montant Stripe == snapshot, preuve d'absence de fallback codé en dur, et liste honnête des points **NON TESTÉS** (webhook/éjection réels nécessitant un paiement).
