# Chargeurs.ch — consolidation bêta

## Branche de référence

La branche `integration/chargeurs-beta-platform` part de `main` et devient l’unique branche d’intégration avant la bêta.

Aucune branche historique n’est fusionnée en bloc. Les composants sont repris par domaine, avec contrôle des migrations, états métier et effets externes.

## Sources canoniques

| Domaine | Source retenue | Règle d’intégration |
|---|---|---|
| Base applicative, routage, PWA et garde-fous kiosk | `main` | Toujours conserver les corrections les plus récentes de `main`. |
| Règlement Stripe, TWINT, inbox Stripe et actions admin | PR #4 `feat/settlement-engine` | Source financière canonique. Ne pas importer le moteur financier concurrent de la PR #7. |
| Platform API, clés, scopes, quotas, OpenAPI et webhooks partenaires | PR #7 `feat/chargeurs-platform-api-v1` | Importer les composants API indépendants, puis adapter les mutations au moteur financier de la PR #4. |
| Authentification de synchronisation ChargeNow depuis le kiosk | PR #13 `fix/kiosk-chargenow-health` et `main` | Comparer fichier par fichier et conserver la variante la plus récente et fail-closed. |
| Application Android kiosk | PR #6 `feat/android-kiosk-wrapper` | Reste séparée jusqu’à stabilisation de l’API web et du provisionnement kiosk. |

## Principes impératifs

1. Une seule source de vérité pour le règlement financier.
2. Une seule machine à états de location exposée aux fonctions métier.
3. Aucun montant fourni par le navigateur ne devient autoritaire.
4. Aucun callback public ne déclenche directement un effet financier non idempotent.
5. Aucun retour ambigu n’est attribué automatiquement.
6. Les migrations sont ordonnées, rejouables et testées en dry-run.
7. Les fonctions LIVE restent désactivées tant que staging, Stripe test et matériel ne sont pas validés.

## Phases

### Phase 1 — socle API sans conflit

- clients et clés API hachées ;
- scopes et quotas ;
- journalisation ;
- API de lecture ;
- contrats OpenAPI ;
- tests du socle.

### Phase 2 — moteur financier canonique

- importer le règlement de la PR #4 ;
- conserver capture manuelle carte et stratégie prépaiement/remboursement TWINT ;
- raccorder les mutations de la Platform API à ce moteur ;
- supprimer les doubles tables, doubles statuts et doubles fonctions financières.

### Phase 3 — matériel et retour

- intégrer la synchronisation kiosk liée à une station ;
- corréler retour par `tradeNo` ou batterie ;
- vérifier la clôture ChargeNow ;
- empêcher toute éjection par une route publique.

### Phase 4 — staging

- dry-run des migrations ;
- déploiement des fonctions avec feature flags désactivés ;
- smoke tests non destructifs ;
- Stripe test ;
- une borne, puis trois bornes.

## Conditions de fusion vers `main`

- CI frontend et Deno entièrement verte ;
- aucune migration concurrente ou contradictoire ;
- revue des fonctions Stripe, ChargeNow et callbacks ;
- preuve du dry-run staging ;
- aucun secret dans GitHub ;
- documentation d’exploitation alignée sur le code réellement retenu.
