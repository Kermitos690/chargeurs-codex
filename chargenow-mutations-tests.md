# Tests de contrat des mutations ChargeNow — Rapport

> Objectif : prouver que chaque mutation est **correctement construite, sécurisée,
> journalisée et récupérable**, sans exécuter aveuglément d'opération destructive
> en production.

## Catégories de preuve

| Verdict | Signification |
|---|---|
| `mock_verified` | Contrat prouvé par test automatisé (fetch stubbé). **Pas** une preuve matérielle. |
| `live_verified` | Appel réel non destructif effectué avec succès, requête/réponse enregistrées. |
| `physical_test_required` | Le code est prêt mais l'effet réel doit être validé sur matériel. |
| `blocked_by_safety` | Mutation destructive : verrou maintenu, exécution réelle interdite sans protocole. |

## Niveaux de test

- **Niveau A — contrat (sans matériel)** : `supabase/functions/tests/chargenow_mutations_contract.test.ts`.
  Vérifie, par mutation : méthode HTTP, chemin, payload (query/body), header `Authorization: Basic`,
  mapping succès `{code:0}`, mapping erreur métier `{code:n}`, codes HTTP 400/401/403/404/409/429/500,
  corps malformé (non-JSON) et échec réseau. ✅ 30 tests verts.
- **Niveau B — live non destructif** : action `run_safe_live_mutations` de l'edge function
  `chargenow-admin` (seul **O3** y est éligible — lecture idempotente d'un trade). Enregistre la
  requête/réponse réelles **expurgées** dans `public.test_runs` avec corrélation et durée. Aucun
  paiement déclenché.
- **Niveau C — préparation physique** : protocole manuel ci-dessous + action `dryRun` de
  `chargenow-admin` qui prouve que l'appel *serait* construit sans le déclencher.

## Garde-fous de sécurité (inchangés, renforcés)

- Secrets ChargeNow **uniquement** côté backend (env), jamais dans le frontend.
- Opérations destructives (`C1`, `C2`, `C3`, `S5`, `P4`, `E1`) :
  - `DANGEROUS` dans `chargenow-admin` → exigent `maintenanceMode:true`,
  - `dryRun` par défaut tant que `confirm:true` n'est pas envoyé,
  - cabinet explicitement sélectionné,
  - journalisées dans `api_logs`, `maintenance_actions` et `test_runs`.
- Toutes les écritures `test_runs` passent par une **expurgation** (mots-clés password/secret/token…).

## Verdict par mutation

| Code | Nom | Niv. A | Niv. B | Verdict courant | Test physique requis |
|---|---|---|---|---|---|
| O2 | Create Rent Order | ✅ mock_verified | dans flux de location réel | `mock_verified` | Oui (dans 1ère location) |
| O3 | Query Rent Order Status | ✅ mock_verified | ✅ éligible live (idempotent) | `mock_verified` → `live_verified` | Non |
| O4 | Mark Order Completed | ✅ mock_verified | dans flux de location réel | `mock_verified` | Oui (clôture réelle) |
| S3 | Create New Shop | ✅ mock_verified | possible (shop jetable) | `mock_verified` | Recommandé |
| S4 | Update Shop | ✅ mock_verified | possible (shop jetable) | `mock_verified` | Recommandé |
| S5 | Delete Shop | ✅ mock_verified | **bloqué** | `blocked_by_safety` | Oui (shop jetable) |
| P3 | Create/Update Price Strategy | ✅ mock_verified | possible (stratégie test) | `mock_verified` | Recommandé |
| P4 | Delete Price Strategy | ✅ mock_verified | **bloqué** | `blocked_by_safety` | Oui (stratégie jetable) |
| P5 | Bind Price Strategy | ✅ mock_verified | possible (réversible P6) | `mock_verified` | Recommandé |
| P6 | Unbind Price Strategy | ✅ mock_verified | possible (réversible P5) | `mock_verified` | Recommandé |
| C1 | Device Operation | ✅ mock_verified | **bloqué** | `blocked_by_safety` | **Oui (effet physique)** |
| C2 | Eject By Repair | ✅ mock_verified | **bloqué** | `blocked_by_safety` | **Oui (éjecte batterie)** |
| C3 | Eject By Rent | ✅ mock_verified | **bloqué** | `blocked_by_safety` | **Oui (éjecte batterie)** |
| E1 | Cabinet Event Push Config | ✅ mock_verified | **bloqué** | `blocked_by_safety` | Oui (effet global push) |

## Critères de sortie — état

- [x] Toutes les mutations ont ≥ 1 test de contrat automatisé.
- [x] Mutation non destructive testable en live identifiée (O3) + harnais `run_safe_live_mutations`.
- [x] Mutations destructives verrouillées + protocole manuel complet (ci-dessous).
- [x] Aucun test simulé présenté comme preuve matérielle (verdicts séparés).
- [x] Résultats intégrés à la matrice `/admin/api-coverage` (`proof_state`, `has_test`, `test_ref`).
- [x] Suivi visible dans `/admin/test-monitor` (endpoint, niveau, verdict, date, cabinet, env,
      corrélation, requête/réponse expurgées, durée, test physique requis).

---

## Protocole Niveau C — tests physiques (DTA21269 uniquement)

> Tant que **DTA21269** n'est pas validée, limiter tout test physique à cette borne.
> Toujours : 1) `dryRun` d'abord, 2) double confirmation admin, 3) procédure de retour à l'état initial.

### Pré-requis communs
1. Mode maintenance activé pour DTA21269.
2. État AVANT capturé : `O1` (cabinet/query), `C7` (batteries), `C8` (slots).
3. Corrélation notée (retournée par `chargenow-admin`).

### C2 — Eject By Repair (éjecte une batterie)
- Dry-run : `{ code:"C2", params:{ cabinetid:"DTA21269", slotNum:<slot plein> }, maintenanceMode:true }` → vérifier `wouldCall:true`.
- Exécution : ajouter `confirm:true`. Effet **physique** : la batterie du slot sort.
- Retour à l'état initial : réinsérer manuellement la batterie ; vérifier `C8` (slot de nouveau occupé).

### C3 — Eject By Rent (lié à une commande)
- Nécessite un `rentOrderId` réel. Préférer le valider via le **scénario de 1ère location complète** ci-dessous.

### C1 — Device Operation (`pop`, `lock`, `restart`…)
- Tester d'abord `operationType:"heartbeat"` (non destructif) pour valider le canal.
- Puis `pop`/`unlock` en mode maintenance + confirm, avec réinsertion manuelle ensuite.

### S5 / P4 / E1 (destructif data/config)
- S5/P4 : créer d'abord une ressource **jetable** (S3 / P3), puis la supprimer. Jamais sur données de prod.
- E1 : capturer la config courante via `E2`, modifier, puis **restaurer** la config d'origine via E1.

---

## Scénario du PREMIER test physique complet — DTA21269

> But : prouver une location réelle de bout en bout (paiement réel → éjection physique → retour physique),
> seul moyen d'élever la borne au statut « prête pour production ».

1. **Préparation**
   - Borne DTA21269 en ligne (`O1` ok), au moins 1 batterie chargée (`C7`), slots connus (`C8`).
   - Stripe en mode réel (montant minimal selon profil tarifaire). Aucun secret côté frontend.
   - Ouvrir `/admin/test-monitor` pour suivre la session en direct.
2. **Démarrage location** sur la tablette `/kiosk/DTA21269` : sélection slot, calcul du tarif
   (`compute_pricing`), création de session (`create-rental-session`).
3. **Paiement réel** via Stripe Checkout. ⚠️ L'éjection ne se déclenche **que** sur webhook
   `payment_intent.succeeded` (`stripe-webhook` → `eject-after-payment`), jamais sur `success_url`.
4. **Éjection physique** : `eject-after-payment` appelle `C3` (ejectByRent) avec le `rentOrderId`.
   - Vérifier : batterie sort réellement, `rental_events` = `ejected`, `test_runs`/`api_logs` enregistrés,
     idempotence (un seul ejection même si le webhook est rejoué).
5. **Retour physique** : réinsérer la batterie dans DTA21269.
   - Vérifier réception de l'événement (`cabinet-event-push` / callback), passage en `returned`,
     calcul final (`O3`/`O5`), clôture (`O4` / `close-rental-order`).
6. **Documentation** : exporter le rapport JSON/texte depuis `/admin/test-monitor`, archiver la
   corrélation, le PaymentIntent, le trade ChargeNow et les timestamps.

### Procédure de retour à l'état initial
- Si échec après paiement : remboursement Stripe (`refunds`) + réinsertion batterie + clôture forcée.
- Désactiver le mode maintenance.

## Verdict global de l'incrément

**FONCTIONNEL MAIS PARTIELLEMENT TESTÉ** — contrats prouvés (mock), live non destructif outillé,
destructif verrouillé avec protocole. **Aucune** preuve matérielle tant que le scénario DTA21269
ci-dessus n'est pas exécuté et documenté.
