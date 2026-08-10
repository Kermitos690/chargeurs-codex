# DTA21269 — rapport de snapshot

## Référentiel local observé le 9 août 2026

Les slots enregistrés dans la base staging sont :

| Slot | Batterie enregistrée |
|---:|---|
| 1 | `FECA02C714` |
| 2 | `F0F0004944` |
| 3 | `F0F00045BC` |
| 4 | `F0F000503E` |

Ces identités servent uniquement à la validation pilote ; elles ne sont jamais codées dans l’interface client.

## État de preuve

Ce document ne prétend pas connaître les valeurs C4/C7/C8 en temps réel. Elles doivent être lues via `cabinet-slot-diagnostics` par un administrateur connecté. L’écran client ne montrera un pourcentage que si le champ source est explicitement documenté et corroboré.

## Sortie physique

Une session ancienne liée au slot 1 a reçu une réponse fournisseur sans identifiant de batterie (`BATTERY_ID_MISSING`). Cette ambiguïté impose de conserver un permis unique, limité à une session, une borne et un slot, avant un nouveau test d’éjection. Aucun mécanisme de relance automatique n’est autorisé.
