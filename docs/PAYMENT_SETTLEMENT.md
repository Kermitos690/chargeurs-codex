# Chargeurs.ch — règlement final des locations

## Statut

Cette documentation décrit le moteur de règlement porté depuis la PR #4 vers la branche `integration/settlement-main`.

- Le moteur et les migrations sont développés dans le dépôt.
- Les tests purs de planification sont automatisés.
- La CI doit valider le frontend, les fonctions Deno et les garde-fous PostgreSQL.
- Les migrations ne doivent pas être considérées appliquées sur Supabase tant qu'un déploiement staging distinct n'est pas prouvé.
- Les flux Stripe doivent rester en mode test jusqu'à validation complète sur un compte et un webhook réels de test.
- Le Rental Orchestrator doit rester l'autorité unique des transitions critiques.

## Règles métier

- caution initiale : 30 CHF, issue du champ `deposit_cents` du profil tarifaire ;
- tarif public cible : 1,50 CHF par heure, par incréments de 30 minutes ;
- plafond journalier : 18 CHF ;
- non-retour : montant final de 99 CHF ;
- supplément maximal connu après la caution : 69 CHF ;
- le montant final est recalculé par `compute_pricing` au retour ou lors de la déclaration de non-retour.

Aucun montant reçu du navigateur, du kiosk ou des métadonnées Stripe n'est une source de vérité.

## Deux stratégies Stripe

### Carte, Apple Pay et Google Pay éligibles

Les paiements `card` utilisent `capture_method=manual` lorsque Stripe et le moyen de paiement le permettent :

1. Stripe autorise la caution ;
2. la batterie est éjectée uniquement après confirmation serveur de l'autorisation ;
3. au retour, `settle-rental-payment` capture seulement le montant final ;
4. le solde non utilisé n'est jamais capturé ;
5. si le montant final dépasse la caution, le moteur tente un paiement complémentaire hors session.

### TWINT et méthodes à capture automatique

TWINT ne prend pas en charge la capture manuelle :

1. la caution est encaissée ;
2. la batterie est éjectée uniquement après confirmation serveur du paiement ;
3. au retour, la différence entre la caution et le montant final est remboursée ;
4. si le montant final dépasse la caution, le moteur tente un paiement complémentaire hors session.

## Composants

| Composant | Fonction |
|---|---|
| `_shared/settlement.ts` | Planification pure : capture, annulation, remboursement, supplément |
| `_shared/settlementRuntime.ts` | Exécution Stripe, calcul final, incidents et écritures métier |
| `settle-rental-payment` | Endpoint interne protégé par le rôle serveur |
| `claim_rental_settlement` | Verrou PostgreSQL atomique avec récupération après expiration |
| `claim_stripe_webhook_event` | Inbox Stripe idempotente, concurrente et reprenable |
| `chargenow-rent-callback` | Déclenche le règlement après un retour physique fiable |
| Rental Orchestrator | Valide et persiste les transitions métier canoniques |

## États financiers

- `pending` : Checkout pas encore confirmé ;
- `authorized` : caution carte autorisée, non capturée ;
- `prepaid` : caution encaissée par une méthode automatique ;
- `settling` : traitement détenu par un worker ;
- `settled` : prix final enregistré et opérations financières terminées ;
- `supplemental_required` : complément non encaissé automatiquement ;
- `failed` : incident technique, retry ou réconciliation nécessaire ;
- `manual_review` : incohérence de montant, devise ou snapshot.

Ces états financiers ne doivent pas devenir une deuxième machine à états métier. Ils décrivent le sous-processus financier, tandis que le Rental Orchestrator reste l'autorité du cycle de location.

## Idempotence et reprise

- un événement Stripe traité est ignoré lors d'un rejeu ;
- un événement Stripe échoué renvoie HTTP 500 et peut être repris ;
- un événement en cours ne peut pas être traité simultanément par deux workers ;
- une location ne peut avoir qu'un règlement actif ;
- les appels Stripe utilisent des clés d'idempotence liées à la location et au montant ;
- un verrou de règlement abandonné peut être repris après dix minutes ;
- un incident est ouvert lorsque le complément exige une action du client ou de l'équipe ;
- les transitions critiques sont appliquées avec une clé d'idempotence via le Rental Orchestrator.

## Frontière de sécurité

- `PUBLIC_APP_URL` doit être configuré explicitement dans l'environnement de règlement ;
- un `origin` libre fourni par le navigateur ne doit pas devenir l'autorité des redirections Stripe ;
- les erreurs publiques renvoient des codes stables et ne contiennent pas d'exception brute ;
- l'endpoint de règlement est réservé au rôle serveur ;
- les webhooks vérifient leur signature avant tout effet ;
- les callbacks ChargeNow sont enregistrés idempotemment avant traitement ;
- aucune éjection n'est déclenchée par un simple retour navigateur.

## Validation staging obligatoire

Avant fusion vers un environnement réellement connecté :

1. identifier un projet Supabase staging distinct ;
2. lancer le gate en dry-run ;
3. appliquer les migrations sur staging seulement après revue ;
4. vérifier les nouvelles colonnes et fonctions avec le rôle `service_role` ;
5. confirmer qu'`anon` et `authenticated` ne peuvent exécuter les fonctions de claim ;
6. créer un Checkout carte de test et vérifier `requires_capture` ;
7. simuler un retour et contrôler une capture partielle ;
8. créer un Checkout TWINT de test et contrôler un remboursement partiel ;
9. rejouer le même webhook après succès ;
10. provoquer un échec de handler puis vérifier le retry ;
11. provoquer deux règlements concurrents ;
12. tester un non-retour à 99 CHF avec succès et échec du complément ;
13. contrôler les incidents, audits et montants nets ;
14. vérifier qu'aucune batterie n'est éjectée sur un simple redirect navigateur ;
15. vérifier que les états locaux, Stripe et ChargeNow se réconcilient avec le Rental Orchestrator.

## Limites restantes

- La durée d'une autorisation carte dépend de Stripe, du réseau et de l'éligibilité ; le retour `request_extended_authorization` reste conditionnel.
- Un paiement complémentaire hors session peut exiger une nouvelle authentification. Dans ce cas, la location passe en `supplemental_required`.
- La clôture financière ne remplace pas la réconciliation ChargeNow de l'ordre matériel.
- La validation matérielle sur DTA21269 reste obligatoire avant toute bêta réelle.
