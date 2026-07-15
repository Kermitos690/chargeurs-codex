# Rental Orchestrator — couche transactionnelle

## Objectif

Persister le cycle de location sans autoriser le navigateur, le kiosk ou un webhook à modifier directement un état final.

## Tables

| Table | Fonction |
|---|---|
| `rental_orchestrator_snapshots` | État courant, version et références opérationnelles de la location |
| `rental_orchestrator_events` | Journal immuable des transitions appliquées |
| `rental_orchestrator_external_events` | Inbox idempotente des webhooks Stripe, callbacks ChargeNow et événements kiosk |
| `rental_orchestrator_incidents` | Incohérences et actions opérationnelles à traiter |

## Garantie transactionnelle

La fonction `append_rental_orchestrator_event` verrouille la location, vérifie la clé d'idempotence, compare la version attendue, met à jour le snapshot puis ajoute l'événement dans une seule transaction PostgreSQL.

Codes attendus :

- `RENTAL_NOT_FOUND` : location inexistante ;
- `VERSION_CONFLICT` : un autre traitement a modifié la location ;
- `IDEMPOTENCY_KEY_CONFLICT` : une même clé a été réutilisée pour une autre action.

## Frontière de sécurité

Les quatre tables utilisent RLS et ne sont pas accessibles directement aux rôles `anon` ou `authenticated`. La fonction transactionnelle est réservée au rôle serveur `service_role`.

Les secrets Stripe et ChargeNow restent dans les fonctions serveur. Le frontend transmet seulement une intention ou consulte une vue filtrée prévue ultérieurement.

## Branchement serveur à réaliser

1. Charger le snapshot avec son journal.
2. Construire l'événement métier depuis le webhook ou la commande interne.
3. Appeler `applyRentalEvent` pour valider la transition.
4. Appeler `append_rental_orchestrator_event` avec la version courante et le snapshot résultant.
5. En cas de conflit de version, recharger puis rejouer l'événement.
6. Déclencher les effets externes via une outbox distincte, jamais avant le commit.

## Déploiement

La migration doit être appliquée sur staging avant production. Les tests minimaux doivent couvrir :

- événement identique reçu deux fois ;
- deux événements concurrents sur la même version ;
- collision de clé d'idempotence ;
- rollback complet si l'insertion du journal échoue ;
- impossibilité de lecture et d'écriture depuis un utilisateur authentifié standard.
