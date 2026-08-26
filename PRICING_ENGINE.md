# Moteur tarifaire

## Règles canoniques

Le profil actif affecté à une station et le `pricing_snapshot` immuable de chaque
location restent les seules sources de vérité exécutables. Les règles commerciales
ci-dessous sont la politique **approuvée pour le pilote v3** et doivent être
représentées dans le snapshot avant activation en staging/production.

### Express / guest

- jusqu'à 30 min : **1,90 CHF** ;
- jusqu'à 2 h : **3,90 CHF** ;
- jusqu'à 6 h : **5,90 CHF** ;
- jusqu'à 24 h : **7,90 CHF** ;
- continuation après 24 h : période de 24 h à **7,90 CHF** ;
- garantie de référence : **30 CHF**.

### Client avec solde prépayé

- les 30 premières minutes coûtent **1,00 CHF** ;
- chaque tranche supplémentaire de 30 minutes commencée ajoute **0,40 CHF** ;
- plafond : **5,90 CHF par période de 24 h** ;
- le profil technique encode cette formule avec `initial_fee_cents=60`,
  `period_minutes=30`, `price_per_period_cents=40` et `min_amount_cents=100` ;
  les 60 centimes ne constituent pas un frais distinct à afficher au client.

Le rail de paiement par solde prépayé doit réserver **30 CHF** dans le ledger
Chargeurs.ch lorsqu'au moins 30 CHF sont disponibles. Cette réservation interne
est la cible approuvée ; elle ne doit pas être présentée comme active tant que le
rail prépayé complet (réservation, état financier, éjection et règlement) n'est
pas déployé et validé de bout en bout.

### Non-retour

Pour une nouvelle location v3, une batterie non retournée à **72 heures** entraîne
un **montant contractuel total de 30 CHF**. Ce montant n'est pas une pénalité de
30 CHF ajoutée au prix de location. Les plafonds ordinaires de durée ne doivent
pas réduire cette valeur, et `max_amount_cents=3000` reste le plafond de sécurité.

Les snapshots v1 et v2 historiques conservent leurs anciennes sémantiques et ne
sont jamais réinterprétés rétroactivement.

## Résolution

Les profils sont résolus par priorité d'affectation (segment client, terminal,
station, établissement/défaut selon le parcours), dates de validité et priorité.
Les mutations passent par les mécanismes serveur, sont validées, versionnées et
auditées.

Pour le pilote, DTA21269, DTA21277 et DTA22032 doivent toutes résoudre :

- `guest` → profil Express `chargeur.ch Premium` ;
- `member` → profil `Chargeurs.ch Client`.

## Snapshot

À la création de la location, le serveur copie toutes les règles nécessaires dans
un JSON autonome. Son hash canonique est stocké. Checkout et règlement recalculent
le hash et refusent toute absence, altération, devise différente ou profil/version
incohérent.

Modifier un profil publié ne change jamais une location en cours. Un trigger
`BEFORE` crée les versions et une contrainte unique protège
`(price_profile_id, version)`.

## Calcul final

La durée est arrondie au nombre supérieur de périodes. Le plafond journalier
s'applique à la location normale. En `pricing_rules_version=3`, le non-retour est
un **total contractuel cible** défini dans le snapshot. Les versions v1/v2 gardent
leur comportement historique. Taxes, arrondis, minimum et maximum proviennent du
snapshot ; les profils pilote v3 sont configurés avec une taxe tarifaire à 0.

## Déploiement v3

La migration `20260827010000_pilot_pricing_rules_v3.sql` et le calculateur de
settlement v3 doivent être déployés de manière coordonnée. Ne pas appliquer la
migration seule sur staging si `settle-rental-payment` utilise encore un helper
qui ne comprend pas `pricing_rules_version=3`.

## Extension

Le schéma supporte plusieurs profils, affectations, validités, périodes,
garanties, frais et plafonds. Toute nouvelle sémantique financière doit créer une
nouvelle `pricing_rules_version` au lieu de modifier silencieusement une version
historique.
