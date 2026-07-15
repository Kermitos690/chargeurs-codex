# Phase 1 — Platform API core

## Intégré

- branche d’intégration créée depuis `main` ;
- stratégie de consolidation documentée ;
- tables `api_clients`, `api_keys`, `api_rate_limit_windows` et `api_request_logs` ;
- clés stockées uniquement sous forme de hash ;
- scopes exacts et wildcards de namespace ;
- quota atomique par minute ;
- journalisation redacted avec hash IP optionnel ;
- RLS et révocation complète des rôles navigateur ;
- accès réservé au `service_role` ;
- tests Deno du noyau d’authentification ;
- gate CI spécifique à la branche d’intégration.

## Non intégré volontairement

- mutations de location ;
- paiement ;
- éjection ;
- synchronisation matérielle ;
- webhooks partenaires ;
- moteur financier concurrent de la PR #7.

Ces éléments restent exclus tant que le moteur financier canonique de la PR #4 n’a pas été consolidé.
