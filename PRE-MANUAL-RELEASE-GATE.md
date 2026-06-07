# PRE-MANUAL-RELEASE-GATE.md

Audit full-stack automatisé avant phase manuelle — Chargeurs.ch
Date : 2026-06-07

## Résumé exécutif
Tous les correctifs de sécurité automatisables identifiés ont été appliqués et
vérifiés par des tests automatisés exécutés réellement (SQL contre la base + suite
vitest). Les éléments restants relèvent objectivement du matériel, d'un paiement
réel, d'un callback fournisseur réel, d'une session humaine ou d'une configuration
externe. Aucune fonctionnalité n'est déclarée « fonctionnelle » sans preuve d'exécution.

## Inventaire
- Routes frontend : 8 (`/`, `/kiosk/:stationId`, `/kiosk/station/:stationId`, `/pay/:id`(+success/cancel), `/admin/login`, `/admin/*`).
- Pages admin : 16 sous `/admin`.
- Edge Functions : 14 (`admin-maintenance-action`, `cabinet-event-push`, `chargenow-admin`, `chargenow-rent-callback`, `claim-admin`, `close-rental-order`, `create-rental-session`, `create-stripe-checkout`, `eject-after-payment`, `kiosk-admin`, `pricing-admin`, `rental-admin-action`, `stripe-webhook`, `sync-cabinet-status`).
- Fonctions SQL : 10 (dont `compute_pricing`, `resolve_price_profile`, `effective_price`, `kiosk_quote`, `kiosk_session_status`, `has_role`).
- Tables : 27.
- Migrations : 17 (versionnées, additives, idempotentes).
- Tests automatisés : 14 vitest + 1 suite SQL (pricing + grants) = **toutes vertes**.

## Corrections appliquées (CORRIGÉ ET À RETESTER en conditions réelles si applicable)
1. **`compute_pricing` / `resolve_price_profile` / `effective_price`** : EXECUTE révoqué pour PUBLIC/anon/authenticated. → FONCTIONNEL ET TESTÉ AUTOMATIQUEMENT (`has_function_privilege` = false).
2. **`has_role`** : EXECUTE révoqué pour anon (enumeration), conservé pour authenticated (requis par RLS). → FONCTIONNEL ET TESTÉ AUTOMATIQUEMENT.
3. **`raw_data` ChargeNow** (stations/slots/batteries) : retiré des lectures anonymes via grants par colonnes ; anon ne lit que les colonnes de disponibilité. → FONCTIONNEL ET TESTÉ AUTOMATIQUEMENT.
4. **Grants anon** retirés sur 24 tables métier sensibles (défense en profondeur, RLS déjà bloquante). → FONCTIONNEL ET TESTÉ AUTOMATIQUEMENT.
5. **`src/pages/Kiosk.tsx`** : `select("*")` remplacé par colonnes explicites (compatible avec le verrouillage `raw_data`). → IMPLÉMENTÉ ; build OK.
6. **Logique de rôles & machine à états** extraites en modules purs testés (`src/lib/roles.ts`, `src/lib/rentalState.ts`). → FONCTIONNEL ET TESTÉ AUTOMATIQUEMENT.

## Vulnérabilités
- Trouvées : exposition `raw_data` anon ; enumeration `has_role` anon ; RPC pricing exécutables publiquement ; grants anon larges sur tables sensibles.
- Corrigées : toutes les ci-dessus.
- Restantes : 5 avertissements (warn) « SECURITY DEFINER exécutable » — **intentionnels** : `kiosk_quote`/`kiosk_session_status` (anon, protégés par token/UUID) et `has_role` (authenticated, requis par RLS). 3 notes scanner = recommandations de vérification, déjà correctement restreintes par RLS default-deny. **Aucune vulnérabilité critique ouverte.** Documenté dans @security-memory.

## Tests automatisés
- Réussis : 14 vitest (`roles` 4, `rentalState` 9, exemple 1) + suite SQL (8 groupes d'assertions). 
- Échoués : 0.
- Réservés à la phase manuelle : paiement réel, callback réel, éjection/retour physiques, rotation token sur tablette réelle, moyens de paiement (Apple/Google Pay/TWINT).

## Configurations externes restantes
Voir section dédiée ci-dessous + MANUAL-VALIDATION-PLAN.md. Principales : `CHARGENOW_EVENT_SECRET` (callback fail-closed), domaines Apple/Google Pay, activation TWINT, webhook Stripe live, URL callback ChargeNow.

## Données de test supprimées
Aucune donnée de test n'a été créée par cette mission (tests SQL en lecture seule, tests vitest sur modules purs). Profil tarifaire `Standard` (CHF) est une **configuration réelle**, non une donnée de test.

## Tableau principal
| Domaine | Fonction/route | Auth | Test auto | Résultat | Preuve | Statut | Correction | Reste manuel | Bloquant |
|---|---|---|---|---|---|---|---|---|---|
| Pricing | compute_pricing | service_role | oui (SQL) | PASS | quote=50, ladder monotone | FONCTIONNEL ET TESTÉ AUTO | grants verrouillés | — | non |
| Sécurité | grants anon RPC pricing | n/a | oui | PASS | has_function_privilege=false | FONCTIONNEL ET TESTÉ AUTO | révocations | — | non |
| Sécurité | raw_data anon | anon | oui | PASS | has_column_privilege=false | FONCTIONNEL ET TESTÉ AUTO | grants colonnes | — | non |
| Sécurité | grants anon tables | anon | oui | PASS | suite SQL | FONCTIONNEL ET TESTÉ AUTO | REVOKE | — | non |
| Auth UI | rôles canWrite/canView | client | oui (vitest) | PASS | roles.test.ts | FONCTIONNEL ET TESTÉ AUTO | module pur | sessions réelles (A) | non |
| États | transitions location | n/a | oui (vitest) | PASS | rentalState.test.ts | FONCTIONNEL ET TESTÉ AUTO | module pur | cycle réel (M) | non |
| Callback | cabinet-event-push | secret | partiel | fail-closed 503 vérifié antérieurement | logs | CORRIGÉ ET À RETESTER | fail-closed | callback réel (I/J) | non |
| Stripe | webhook/refund | signé | non | — | — | IMPLÉMENTÉ MAIS NON TESTÉ | — | paiement réel (B/L) | non* |
| ChargeNow | éjection/retour | service_role | non | — | — | RÉSERVÉ PHASE MANUELLE | — | matériel (H/I/J/K) | non* |
| Paiement | Apple/Google/TWINT | externe | non | — | — | BLOQUÉ PAR CONFIG EXTERNE | — | C/D/E | non* |

\* Non bloquant pour le **gate avant phase manuelle** : ce sont précisément les éléments réservés à la phase manuelle.

## Commandes de relance
```
npm run test:all      # vitest + suite SQL
npm run test:unit     # roles + machine à états
npm run test:db       # simulations pricing + grants sécurité (psql)
npm run build         # build production
```

## Preuves principales
- Suite SQL : `ALL DB TESTS PASSED` (exit 0).
- Vitest : `Test Files 3 passed (3) / Tests 14 passed (14)`.
- Linter sécurité : 9 → 8 findings, 0 critique, restants = warns intentionnels documentés.

## Verdict
**GO POUR PHASE MANUELLE**

Justification : build/typecheck OK, aucune vulnérabilité critique ouverte, aucun
endpoint métier sensible publiquement accessible (callbacks fail-closed, grants anon
retirés, RPC pricing verrouillées), RLS en place sur toutes les tables sensibles,
moteur tarifaire cohérent et testé (centimes entiers, snapshot serveur, ladder
monotone), transitions d'état contrôlées et idempotentes, secrets non exposés,
migrations versionnées, tests automatisables verts. Les éléments restants exigent
objectivement matériel / paiement réel / callback fournisseur / session humaine /
configuration externe — couverts par MANUAL-VALIDATION-PLAN.md.
