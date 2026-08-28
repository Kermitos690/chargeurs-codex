# Modèle opérationnel

## 1. Dispatch et rédacteurs

L’exécution par défaut est `ONE TASK -> ONE PRIMARY AGENT`. A0 identifie le
propriétaire du domaine, consigne la surface active d’écriture et ne demande un
handoff que si le propriétaire n’a pas l’autorité ou les preuves nécessaires.

Il n’y a qu’un rédacteur à la fois par surface d’implémentation. Le travail en
parallèle n’est autorisé que lorsque les surfaces et critères d’acceptation sont
indépendants. Une investigation en lecture seule ne donne pas la propriété en
écriture.

Si deux rôles revendiquent une capacité, marquer `OWNERSHIP_COLLISION`, arrêter
le nouveau travail sur cette collision et demander à A0 avec A1 de recommander
un seul propriétaire et une règle de handoff.

## 2. Politique de sous-agents

`SUBAGENTS = 0` par défaut. Le registre logique A0–A9 ne crée jamais
automatiquement des agents Codex en cours d’exécution.

Un sous-agent Codex supplémentaire n’est autorisé que si toutes les conditions
suivantes sont vraies :

1. la tâche est bornée et réellement indépendante ;
2. le parallélisme apporte un bénéfice clair par rapport à un seul agent principal ;
3. aucune surface d’écriture ne se chevauche ;
4. il ne duplique pas une investigation terminée ;
5. le dispatch consigne objectif, périmètre lecture/écriture, sortie attendue et risque de coût.

Privilégier les workers étroits et en lecture seule. Ne jamais lancer A0–A9 en
parallèle seulement parce que ces rôles existent. Cette proposition n’introduit
ni fichiers `.codex/agents/*.toml`, ni Skills locaux.

Les candidats éventuels à un workflow futur sont `bug-rca`,
`protected-core-change`, `release-validation`, `physical-validation` et
`agent-handoff`. Un Skill n’est justifié qu’après un usage répété démontrant
qu’un document compact ne suffit pas.

## 3. Modèle de statuts

Utiliser exactement un statut logiciel courant :

`BACKLOG`, `READY`, `IN_PROGRESS`, `BLOCKED`, `NEEDS_EVIDENCE`,
`HANDOFF_REQUIRED`, `READY_FOR_VALIDATION`, `VALIDATION_FAILED`, `VALIDATED`,
`READY_FOR_RELEASE`, `RELEASE_BLOCKED`, `RELEASED`, `ROLLED_BACK` ou
`CANCELLED`.

Consigner séparément la réalité physique :

`SOFTWARE_ONLY`, `DEVICE_INSTALLED`, `PHYSICAL_TEST_REQUIRED` ou
`PHYSICALLY_VALIDATED`.

`PR_OPEN`, `MERGED`, `DEPLOYED`, `APK_BUILT`, `APK_INSTALLED`, `DB_MIGRATED`,
`EDGE_DEPLOYED` et `PHYSICALLY_VALIDATED` sont des faits de preuve, pas des
synonymes.

## 4. Contrat QA

Le modèle recommandé est **Option B : protocole QA indépendant sans nouvel ID
d’agent logique**, A8 possédant les gates d’intégration, de release et de
validation physique.

| Gate | Rédacteur | Preuve exigée | Validateur |
| --- | --- | --- | --- |
| `DOMAIN_TESTED` | propriétaire du domaine | tests ciblés et résultat | propriétaire ; A3 vérifie les correctifs RCA |
| `INTEGRATION_TESTED` | propriétaire participant | résultat d’intégration sur candidat exact | A8 |
| `PHYSICAL_VALIDATED` | A8 avec preuve opérateur/appareil | appareil, station, fenêtre, événement observé et résultat | A8 |
| `READY_FOR_RELEASE` | A8 | identité complète de release et tous gates applicables | A8 ; humain pour risque externe/métier |

Un implémenteur peut rapporter ses tests mais ne peut pas déclarer seul le gate
de release passé. Une QA échouée retourne au propriétaire via un handoff ; elle
ne déclenche pas un redesign opportuniste.

## 5. Vérité physique et release

Le manifeste de release doit lier le candidat au SHA Git, ensemble de PRs,
migrations, versions Edge, déploiement web, version/hash APK, station/appareil,
fenêtre de test et résultats. L’accusé HTTP d’un fournisseur n’est pas une preuve
d’éjection physique.

```text
CODE_EXISTS
-> TEST_PASSED
-> DEPLOYED
-> APK_INSTALLED
-> DEVICE_CONNECTED
-> PROVIDER_ACKNOWLEDGED
-> PHYSICAL_EVENT_OBSERVED
-> PHYSICALLY_VALIDATED
```

Chaque étape exige sa propre preuve. A8 peut poser `RELEASE_BLOCKED` si une étape
requise est absente.

## 6. Registre des sources de vérité

| Information | Source de vérité canonique | Propriétaire | Projections autorisées |
| --- | --- | --- | --- |
| Pricing et devis du segment client | résolution pricing serveur et snapshot immuable | A2 | Kiosk, web, compte, reçus |
| État de paiement | événements Stripe signés et données paiement serveur | A2 | statut Kiosk/compte/admin |
| État de location | cycle serveur canonique / state version | A2 | Kiosk, compte, admin |
| Intention de commande hardware | intention serveur autorisée et persistée | A2 | admin/observabilité |
| Identité/événement batterie physique | preuve corrélée d’événement physique/fournisseur | A2 pour corrélation location ; A7 pour asset | Kiosk/admin/Inventory |
| Asset Inventory et readiness | asset sérialisé, localisation et preuve fournisseur | A7 | admin et propositions de capacité |
| État campagne | runtime campagne/playlist Advertising | A5 | surface idle Kiosk et analytics |
| Identité de release | manifeste de release et artefacts exacts | A8 | opérations et readiness Growth |
| Pipeline commercial | dossiers de partenariat documentés | A9 | planification seulement, jamais vérité opérationnelle |

Deux sources ne peuvent coexister qu’avec une règle de synchronisation explicite.
Une projection ne peut jamais remplacer silencieusement une vérité métier ou
physique canonique.

## 7. Autorité métier et coût

Un humain décide prix, caution, plafonds, pénalités, abonnements, conditions
client, remboursements, engagements commerciaux et modèle économique. Une
information manquante est `BUSINESS_DECISION_REQUIRED`, pas une permission
d’inventer une valeur.

Ce modèle opérationnel ne requiert aucune dépendance payante incrémentale. Toute
proposition en ce sens est `COST_APPROVAL_REQUIRED` et doit indiquer les coûts
ponctuels et récurrents.
