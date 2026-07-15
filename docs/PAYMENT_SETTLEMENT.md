# Chargeurs.ch — règlement final des locations

## Statut

Cette documentation décrit le code de la branche `feat/settlement-engine`.

- Le moteur et les migrations sont développés dans le dépôt.
- Les tests purs de planification sont automatisés.
- La CI doit valider le frontend et les fonctions Deno.
- Les migrations ne doivent pas être considérées appliquées sur Supabase tant qu'un déploiement staging n'est pas prouvé.
- Les flux Stripe doivent rester en mode test jusqu'à validation complète sur un compte et un webhook réels de test.

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

Les paiements `card` utilisent `capture_method=manual` :

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

## États financiers

- `pending` : Checkout pas encore confirmé ;
- `authorized` : caution carte autorisée, non capturée ;
- `prepaid` : caution encaissée par une méthode automatique ;
- `settling` : traitement détenu par un worker ;
- `settled` : prix final enregistré et opérations financières terminées ;
- `supplemental_required` : complément non encaissé automatiquement ;
- `failed` : incident technique, retry ou réconciliation nécessaire ;
- `manual_review` : incohérence de montant, devise ou snapshot.

## Idempotence et reprise

- un événement Stripe traité est ignoré lors d'un rejeu ;
- un événement Stripe échoué renvoie HTTP 500 et peut être repris ;
- un événement en cours ne peut pas être traité simultanément par deux workers ;
- une location ne peut avoir qu'un règlement actif ;
- les appels Stripe utilisent des clés d'idempotence liées à la location et au montant ;
- un verrou de règlement abandonné peut être repris après dix minutes ;
- un incident est ouvert lorsque le complément exige une action du client ou de l'équipe.

## Validation staging obligatoire

Avant fusion vers un environnement réellement connecté :

1. appliquer les migrations sur un Supabase staging ;
2. vérifier les nouvelles colonnes et fonctions avec le rôle `service_role` ;
3. confirmer qu'`anon` et `authenticated` ne peuvent exécuter les fonctions de claim ;
4. créer un Checkout carte de test et vérifier `requires_capture` ;
5. simuler un retour et contrôler une capture partielle ;
6. créer un Checkout TWINT de test et contrôler un remboursement partiel ;
7. rejouer le même webhook après succès ;
8. provoquer un échec de handler puis vérifier le retry ;
9. provoquer deux règlements concurrents ;
10. tester un non-retour à 99 CHF avec succès et échec du complément ;
11. contrôler les incidents, audits et montants nets ;
12. vérifier qu'aucune batterie n'est éjectée sur un simple redirect navigateur.

## Limites restantes

- La durée d'une autorisation carte dépend de Stripe, du réseau et de l'éligibilité ; le retour `request_extended_authorization` reste conditionnel.
- Un paiement complémentaire hors session peut exiger une nouvelle authentification. Dans ce cas, la location passe en `supplemental_required`.
- La clôture financière ne remplace pas la réconciliation ChargeNow de l'ordre matériel.
- Le Rental Orchestrator transactionnel doit encore devenir la source d'état principale à la place des anciens champs `rental_sessions.state`.
