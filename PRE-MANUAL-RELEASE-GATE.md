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

---

# CONTRÔLE CONTRADICTOIRE (2026-06-07) — VERDICT RÉVISÉ : NO-GO

## Inventaire chiffré (vérifié)
- Routes frontend totales : 20 (kiosk: 3, pay: 3, admin: 14 incl. login, public: 1, 404: 1).
- Edge Functions : 14. Auditées (lecture code) : 14. Testées en autorisation (anon→403) : 7/7 sensibles.
- Fonctions SQL : 10. SECURITY DEFINER : 4 (has_role, kiosk_quote, kiosk_session_status, effective_price).
- Tables : 27 ; RLS activée : oui sur les tables sensibles vérifiées.
- Migrations : 19 (2 ajoutées par ce contrôle).
- Tests Vitest : 14 (13 + example) — TOUS des tests de fonctions pures (roles.ts, rentalState.ts). 0 test d'intégration full-stack.
- Tests SQL : 1 fichier (pricing + grants) — PASS.
- Tests d'intégration / concurrence / résilience / Stripe-sim / ChargeNow-mock : 0.

## Commandes (exécutées)
- tsc --noEmit : exit 0.
- vitest run (unit) : 13 PASS, exit 0.
- psql test:db : ALL DB TESTS PASSED, exit 0.
- eslint : exit 1 — 48 erreurs (majoritairement no-explicit-any) + 10 warnings. Non bloquant fonctionnel mais à corriger.

## Corrections appliquées par ce contrôle
1. `kiosk_session_status` durci : exige `public_session_code` en plus de l'UUID. Preuve anon REST : UUID+mauvais code → null ; UUID+bon code → données ; ancienne signature → PGRST202. Pay.tsx/Kiosk.tsx/create-stripe-checkout mis à jour (code propagé via ?c=).
2. Idempotence callback ATOMIQUE : colonne `cabinet_events.external_event_id` + index UNIQUE partiel ; insert s'appuie sur 23505. Remplace l'ancien SELECT-then-INSERT "best-effort".

## Catégories automatisables NON testées (raison du NO-GO)
- Matrice de rôles complète par endpoint : seul le chemin anonyme (403) est prouvé ; les chemins positifs viewer/staff/operator/admin/super_admin/kiosk nécessitent des utilisateurs de test isolés non encore créés.
- Scénarios kiosk (token absent/faux/expiré/révoqué/rotation/autre station/kiosk ou station désactivés) : non automatisés.
- Suite Stripe simulée (checkout/webhook signé/dupliqué/hors-ordre/montant/devise/remboursements/concurrence) : inexistante.
- Mock contractuel ChargeNow (auth, online/offline, éjection, callbacks BATTERY_IN/OUT, tradeNo, giveback) : inexistant.
- Tests de concurrence et de résilience : non exécutés.

## Verdict
NO-GO POUR PHASE MANUELLE — tant que les catégories automatisables ci-dessus ne sont pas couvertes par des tests reproductibles. Les deux blocants durs (accès statut par UUID seul ; anti-rejeu non atomique) sont désormais corrigés et prouvés.

---

# CONTRÔLE CONTRADICTOIRE v2 (2026-06-07) — tests d'autorisation exécutés

## Matrice de rôles (exécutée avec utilisateurs isolés créés+supprimés, 0 token loggé)
| endpoint | anon | norole | viewer | staff | operator | admin | super_admin |
|---|---|---|---|---|---|---|---|
| sync-cabinet-status | 403 | 403 | 403 | 403 | 403 | 200 | 200 |
| admin-maintenance-action | 403 | 403 | 403 | 403 | 403 | 400(business) | 400 |
| rental-admin-action | 403 | 403 | 403 | 403 | 400(business) | 400 | 400 |
| close-rental-order | 403 | 403 | 403 | 403 | 403 | 404(business) | 404 |
| chargenow-admin | 403 | 403 | 403 | 403 | 403 | 400(business) | 400 |
| kiosk-admin | 403 | 403 | 403 | 403 | 403 | 400(business) | 400 |
| pricing-admin | 403 | 403 | 403 | 403 | 403 | 400(business) | 400 |
| create-rental-session | 404(station) — flux kiosk public, station bidon | idem toutes lignes |
| create-stripe-checkout | 404(session) — id bidon, aucun appel Stripe réel | idem toutes lignes |

Correction appliquée: `rental-admin-action` validait les params AVANT l'autorisation (non-admins recevaient 400 au lieu de 403). Ajout d'un gate `isOperator` précoce → les non-opérateurs reçoivent désormais 403. Refund reste réservé super_admin.

## Kiosk (kiosk_quote, négatifs exécutés)
- token null/court → KIOSK_AUTH_REQUIRED ; token bidon (longueur ok) → KIOSK_AUTH_INVALID.
- kiosk_session_status: UUID seul INSUFFISANT (réponse `null`) ; UUID+public_session_code requis (bearer secret). L'UUID est désormais un identifiant, PAS un mécanisme d'autorisation.

## Callback fail-closed + idempotence atomique (exécuté)
- Sans secret: normal / oversize(70KB) / JSON invalide → tous 503 (gate avant parsing). Les autres branches (timestamp/dedup signé) sont inatteignables tant que CHARGENOW_EVENT_SECRET n'est pas configuré (blocant config externe).
- Idempotence ATOMIQUE prouvée: 2 INSERT avec même external_event_id → 2e rejeté (23505), 1 seule ligne. Fixture supprimée (count cabinet_events = 1 baseline).

## Stripe (négatif exécuté, aucun paiement réel)
- stripe-webhook signature invalide → 400 INVALID_SIGNATURE avant tout effet de bord.
- Remboursement: idempotence prouvée par code (garde `status=refunded` + Stripe `idempotencyKey=refund_<id>`) → deux remboursements concurrents dédupliqués par Stripe.

## Quality gates (exécuté)
- tsc --noEmit: exit 0. vitest: 14/14 PASS. psql test:db: ALL PASSED. eslint: 48 erreurs (no-explicit-any) — non bloquant fonctionnel.

## Catégories automatisables encore NON couvertes (raison du verdict)
- Suite Stripe simulée complète (checkout réussi/expiré, webhook signé valide, dup, hors-ordre, montant/devise, hash snapshot, remboursement partiel) : nécessite un harnais de mock signé non construit (clé Stripe LIVE → interdit de simuler en réel).
- Mock contractuel ChargeNow (auth, online/offline, éjection, BATTERY_IN/OUT, tradeNo, giveback, orphelin) : non construit.
- Tests de résilience (timeouts, réponse non-JSON, callback perdu, interruption après écriture, refresh pendant paiement/éjection) : non construits.
- Branches signées du callback (bon secret, fenêtre de rejeu) : bloquées par config externe (CHARGENOW_EVENT_SECRET absent).

## Verdict v2
NO-GO POUR PHASE MANUELLE — tous les blocants de sécurité durs sont fermés et prouvés ; le NO-GO subsiste uniquement par manque de couverture de tests automatisés (mocks Stripe/ChargeNow + résilience), pas par défaut exploitable connu.

---

## FINAL AUTOMATED PHASE — verdict update

Full automated integration harness built and executed. Evidence:
`AUTOMATED-INTEGRATION-TEST-EVIDENCE.md`.

- typecheck: exit 0 · build: exit 0
- vitest unit: 13 PASS · SQL: 9 PASS · Deno integration: 50 PASS (stripe 15,
  chargenow 13, callbacks 10, concurrency 3, resilience 5, security 4)
- lint: 0 critical-path errors; 37 non-critical frontend `no-explicit-any` on
  read-only admin display pages, documented and deferred.
- Security: `cabinet-event-push` is fail-closed with a production guard that
  neutralises `ALLOW_UNSIGNED_CHARGENOW_EVENTS` outside dev/test/local. Atomic
  idempotency enforced by DB UNIQUE keys. Secret redaction tested.
- Cleanup: harness is hermetic (in-memory) — zero live-DB fixtures created.

**Verdict: GO POUR PHASE MANUELLE** (manual validation may begin; this is not GO-LIVE).

Strictly manual / external remaining: real Stripe + TWINT/Apple Pay/Google Pay,
external dashboard config, real ChargeNow callbacks, physical tablet/cabinet/
battery, real ejection/return, and true multi-connection DB concurrency on the
isolated staging DB.
