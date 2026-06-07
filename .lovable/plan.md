… (voir ci-dessous)

# Audit & plan full-stack — Chargeurs.ch

## A. Inventaire réel constaté (preuves)

### Frontend (routes dans `src/App.tsx`)
- Public/partagé : `/` (Index), `/kiosk/:stationId`, `/kiosk/station/:stationId`, `/pay/:id(+/success|/cancel)`.
- Admin (sous `/admin`, via `AdminLayout`) : index, `stations`, `stations/:id`, `payments`, `rentals`, `orders`, `pricing`, `shops`, `rental-flow-health`, `events`, `settings`, `maintenance`, `api-health`, `api-coverage`, `login`.
- **Manquant** : tout le site public marketing (`/how-it-works`, `/pricing`, `/stations`, `/partners`, `/faq`, `/contact`, `/legal`, `/privacy`, `/terms`, `/support`), **toute l'app client** (`/app/*` : login, register, dashboard, wallet, rentals, profile, invoices, notifications, payment-methods), et des pages admin (`customers`, `wallets`, `refunds`, `advertising`, `system-health`, `logs`, `users`, `roles`, `integrations`, détails `shops/:id`, `pricing/:id`, `orders/:id`).

### Backend
- Edge functions présentes : `create-rental-session`, `create-stripe-checkout`, `stripe-webhook`, `eject-after-payment`, `close-rental-order`, `chargenow-admin`, `chargenow-rent-callback`, `cabinet-event-push`, `sync-cabinet-status`, `rental-admin-action`, `admin-maintenance-action`, `claim-admin`. Client ChargeNow unique : `_shared/chargenow.ts` (réutilisé — OK).
- Tables (14) : `api_coverage, api_logs, apifox_orders, batteries, cabinet_events, kiosk_settings, maintenance_actions, payments, price_profiles, rental_sessions, slots, stations, user_roles, webhook_events`.
- **Manquant vs cible** : `profiles, kiosk_devices, shops, pricing_strategies/shop_pricing_bindings (n'existe que price_profiles), rental_events, stripe_events (≈webhook_events), chargenow_callbacks, refunds, wallets, wallet_ledger, wallet_topups, notifications, invoices, audit_logs, system_incidents`.

### Constats critiques
- **Tarif 2 CHF codé en dur** : fallback `?? 2.0` dans `create-rental-session/index.ts:50` et `create-stripe-checkout/index.ts:53` (+ `station.price_per_period`). La source normale est `public.price_profiles` (résolu serveur), mais le fallback `2.0` doit disparaître. Aujourd'hui le prix vient de la ligne `price_profiles.is_default=true` (actuellement 0.50 CHF).
- **Rôles insuffisants** : enum `app_role = ('admin','staff','user')`. Cible demandée : `anonymous, customer, kiosk_device, viewer, operator, admin, super_admin`. Pas de rôle borne ni de `kiosk_devices`/token par borne (le kiosk lit la station en anon).
- **Pas de wallet** (ledger immuable) ni d'app client → fonctionnalités « portefeuille/factures/locations client » = **Manquantes**.
- Realtime OK sur `rental_sessions` ; flux paiement→webhook→éjection→slot en place et testé jusqu'au QR live.

## B. Réalité du périmètre

La demande couvre 4 applications complètes + ledger financier + ~25 pages admin + audit contractuel des 35 endpoints avec preuves live. C'est un programme de plusieurs itérations, pas un seul tour. Je ne marquerai rien « terminé » sans preuve. Le plan ci-dessous est ordonné par priorité de valeur et de risque ; j'exécute le maximum techniquement faisable, et je livre un rapport avec statuts stricts (Implémenté+testé / mock / Stripe-only / non-LIVE / partiel / bloqué config / cassé / manquant).

## C. Plan d'exécution (workstreams)

### WS1 — Fondations données & rôles (priorité 1)
- Migration : enum `app_role` étendu (`customer, kiosk_device, viewer, operator, super_admin` ajoutés) + helper `has_role` inchangé.
- Tables nouvelles avec GRANT+RLS+triggers `updated_at` : `profiles`, `kiosk_devices` (token hashé par borne, scope station), `shops`, `rental_events`, `chargenow_callbacks`, `refunds`, `audit_logs`, `system_incidents`.
- Wallet : `wallets`, `wallet_ledger` (immuable : pas d'UPDATE/DELETE via RLS, idempotency_key unique, types crédit/débit/hold/release/refund/adjust), `wallet_topups`, vue `wallet_balances`. Triggers anti solde négatif / anti double écriture.
- Lier `stations.shop_id` et `price_profiles` ↔ `shops` (binding).

### WS2 — Tarification serveur (priorité 1)
- Supprimer les fallbacks `?? 2.0` ; si aucune stratégie active → erreur explicite `PRICING_NOT_CONFIGURED` (pas de prix démo).
- `/admin/pricing` complète : CRUD stratégies, activer/désactiver, préview prix, liaison/déliaison boutique, bornes & locations concernées, blocage suppression si utilisée, dry-run + confirmation + rôle requis.
- Documenter le modèle réellement supporté par ChargeNow (prix fixe/horaire, période gratuite, plafond, caution…), marquer explicitement les champs non supportés.
- **Preuve WS2** : créer un tarif test, l'attribuer à une boutique test, recharger `/kiosk/station/...` et démontrer le nouveau montant sans changement de code (sur boutique test uniquement).

### WS3 — App client `/app/*` (priorité 2)
- Auth (email+mdp + Google), `profiles` auto-créés par trigger, reset password.
- Pages : dashboard, locations (liste/active/détail), wallet (solde via ledger, top-up Stripe, transactions), factures, moyens de paiement, notifications, profil, support.
- RLS stricte : chaque client ne voit que ses données.

### WS4 — Site public marketing (priorité 3)
- Pages statiques : how-it-works, pricing (depuis stratégies publiques), stations (liste/carte), partners, faq, contact (formulaire → table + email), legal/privacy/terms, support. Aucune mention ChargeNow. SEO + sitemap (kiosk exclu, noindex).

### WS5 — Admin complet (priorité 2)
- Compléter : `customers`, `wallets`, `refunds`, `system-health`, `logs`, `users`, `roles`, `integrations`, détails `shops/:id`, `pricing/:id`, `orders/:id`, `advertising`.
- Orders/rentals : chronologie complète (Stripe + ChargeNow), actions protégées (réconcilier, relancer, revue manuelle, rembourser, annuler, clôturer) idempotentes.
- `/admin/shops` CRUD + liaisons. `/admin/system-health` : états Supabase/Stripe/ChargeNow/Realtime, secrets présents (sans valeurs), sessions bloquées, paiements sans éjection, etc.

### WS6 — Sécurité kiosk & durcissement (priorité 1)
- Rôle `kiosk_device` + token par borne ; le kiosk ne lit que sa station. `noindex/nofollow`, exclusion sitemap/nav.
- Audit RLS de toutes les tables (aucune table sensible ouverte à anon ; wallet non modifiable client). Validation entrées (Zod) sur edge functions, vérif montant/devise/metadata côté webhook (déjà partiel), rate limiting basique.

### WS7 — ChargeNow 35 ops & callbacks (priorité 2)
- Réutiliser `_shared/chargenow.ts` + `chargenow-admin`. Dresser la matrice 35 ops (code interne, méthode, endpoint, params, fonction, page/flux consommateur, mock/live, destructif, statut, dernière preuve) dans `/admin/api-coverage`. Signaler chaque op sans interface comme « non connectée ». Ne pas inventer P2/P4/P5/P6 sans relire Apifox.
- Callbacks : idempotence, association location, statuts inconnus, mise à jour Realtime, retour batterie, clôture.

### WS8 — Tests & rapport (continu)
- Build/typecheck/lint, tests routes, tests kiosk e2e (QR live déjà prouvé), Stripe (webhook valide/invalide/dupliqué/montant erroné/expiré/refund), ChargeNow non-destructif live + destructif mock, sécurité (accès anon/inter-client/inter-borne/rôle insuffisant/montant frontend rejeté).
- Rapport final avec statuts stricts + actions manuelles (Stripe : TWINT/Apple/Google Pay, événements webhook ; Supabase : secrets/Realtime/cron ; tablettes : Fully Kiosk Browser/autostart ; ChargeNow : callback URL/stratégies/boutiques) + décision go/no-go.

## D. Détails techniques clés
- `wallet_ledger` : `id, wallet_id, type, amount_cents, currency, balance_after_cents, ref_rental_session_id, ref_stripe_id, idempotency_key UNIQUE, created_at` ; RLS lecture propriétaire, écriture **service_role only** ; révoquer UPDATE/DELETE à tous ; trigger calcul `balance_after`.
- `kiosk_devices` : `station_id, token_hash, active` ; edge function d'auth borne renvoyant un scope station.
- Suppression fallback prix : remplacer `?? 2.0` par échec contrôlé + incident loggé.
- Aucune nouvelle dépendance ChargeNow ; un seul client conservé.

## E. Risques avant production
- Wallet financier : nécessite revue stricte avant LIVE (marqué « non livré » tant que non audité).
- TWINT/Apple/Google Pay : dépendent de l'activation Dashboard Stripe (config externe).
- Tests LIVE ChargeNow destructifs : exécutés en mock uniquement sauf autorisation explicite sur borne test.
