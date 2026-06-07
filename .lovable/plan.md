# Plan — Corrections audit full-stack (admin + Edge Functions)

Reprise de l'audit global après les correctifs de sécurité. Le moteur tarifaire et le parcours kiosk/paiement sont déjà audités et hors périmètre. Aucun mock détecté — toutes les pages lisent de vraies données. Ci-dessous les 10 anomalies à corriger, par priorité.

## Critique

### 1. `sync-cabinet-status` — endpoint d'écriture sans aucune authentification
`supabase/functions/sync-cabinet-status/index.ts` n'appelle ni `requireAdmin` ni vérif JWT. N'importe qui peut écraser `stations`, `slots`, `batteries` et déclencher des appels ChargeNow.
- Ajouter `requireAdmin(req)` en tête (comme `admin-maintenance-action`).
- Le front (`AdminStations`, `AdminApiHealth`) appelle déjà la fonction avec la session admin → vérifier que le token est bien transmis via `supabase.functions.invoke`.

## Élevé

### 2. Désaccord de rôle `staff` (front voit tout, back refuse tout)
`useAuth.ts:26` accorde l'accès admin à `staff`, mais `_shared/db.ts:60` (`requireAdmin`) n'accepte que `admin`. Résultat : un `staff` voit l'UI mais toutes les écritures échouent silencieusement.
- Décision à trancher (voir Questions) : soit retirer `staff` du front, soit l'ajouter au back en lecture seule.
- Aligner les deux côtés de façon cohérente.

### 3. `rental-admin-action` → `reconcile` est un demi-stub
`rental-admin-action/index.ts:57-68` interroge ChargeNow mais ne met jamais à jour `rental_sessions.state`.
- Mapper le statut ChargeNow renvoyé vers l'état local (ex. batterie rendue → `closed`/`returned`) et écrire `state` en plus de `chargenow_status`.
- Journaliser le résultat de réconciliation.

## Moyen

### 4. `AdminApiHealth` — indicateurs Stripe & webhook codés en dur à `false`
`AdminApiHealth.tsx:20-21` affichent toujours ✗.
- Créer un vrai contrôle : étendre une Edge Function (ou `admin-maintenance-action`) avec une action `health_check` qui vérifie la présence de `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` (backend-only) et l'existence d'événements `webhook_events` récents, puis renvoie des booléens réels.

### 5. `AdminSettings` — écritures directes DB qui contournent l'audit
`AdminSettings.tsx:22,51` écrivent `price_profiles`/`kiosk_settings` directement depuis le navigateur.
- Router ces écritures via `pricing-admin`/`admin-maintenance-action` pour journalisation + `requireAdmin`, ou vérifier/renforcer les RLS de ces tables.

### 6. `close-rental-order` — no-op silencieux si `apifox_trade_no` est nul
`close-rental-order/index.ts:28-38` passe la session à `closed` sans appeler ChargeNow ni avertir.
- Renvoyer un flag `chargenow_skipped: true` + warning loggué quand `apifox_trade_no` manque.

### 7. `chargenow-admin` A1 (oauth2Login) accessible à tout admin
`chargenow-admin/index.ts:22` relaie des identifiants ChargeNow.
- Restreindre `A1` à `super_admin` (ou le retirer du dispatcher).

### 8. `cabinet-event-push` — endpoint public sans vérification de signature
`cabinet-event-push/index.ts` accepte n'importe quel événement (risque de faux `BATTERY_IN`).
- Ajouter un secret partagé / HMAC (`CHARGENOW_EVENT_SECRET`) validé à l'entrée. Nécessite confirmation de ce que ChargeNow envoie réellement (voir Questions).

### 9. `AdminShops` — opérations S3–S5/C9/C11 promises mais absentes
`AdminShops.tsx:38` ne propose que la lecture (S1).
- Ajouter l'UI de création/édition/liaison boutique branchée sur `chargenow-admin`, OU retirer la mention trompeuse si hors scope.

## Faible

### 10. `AdminOrders` — bouton « Rembourser (super_admin) » visible pour tous
`AdminOrders.tsx:94`.
- Masquer/désactiver selon le rôle réel (exposer `role` via `useAuth`).

## Détails techniques
- `useAuth` doit exposer le(s) rôle(s) précis (pas seulement `isAdmin`) pour le gating UI (#2, #10).
- Toutes les nouvelles Edge Functions/actions doivent appeler `requireAdmin`/`requireSuperAdmin` et `logApi`.
- Aucune fabrication de données : si Stripe/ChargeNow non configuré, renvoyer un état explicite « non configuré ».
- Statuts à reporter en fin de tour : FONCTIONNEL ET TESTÉ / IMPLÉMENTÉ NON TESTÉ / BLOQUÉ PAR MATÉRIEL / BLOQUÉ PAR CONFIG EXTERNE.

## Questions à trancher avant implémentation
1. Rôle `staff` : lecture seule au back, ou retiré totalement du périmètre admin ?
2. `cabinet-event-push` : ChargeNow envoie-t-il une signature/secret ? Sinon, on protège via secret partagé en query/header.
3. `AdminShops` : implémenter réellement les opérations d'écriture boutique ce tour, ou seulement retirer la mention ?
