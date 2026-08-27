# Moteur tarifaire canonique

## Règles canoniques

Le profil actif affecté à une station et le `pricing_snapshot` immuable de chaque
location restent les seules sources de vérité exécutables. Les règles commerciales
ci-dessous sont la politique **approuvée pour le pilote v3**. Le navigateur ne
calcule jamais lui-même le montant financier faisant foi.

### Express / guest

- jusqu'à 30 min : **1,90 CHF** ;
- jusqu'à 2 h : **3,90 CHF** ;
- jusqu'à 6 h : **5,90 CHF** ;
- jusqu'à 24 h : **7,90 CHF** ;
- continuation après 24 h : période de 24 h à **7,90 CHF** ;
- garantie de référence : **30 CHF**.

### Client avec solde prépayé

- **2,00 CHF jusqu'à 2 heures** ;
- après 2 heures, **+1,00 CHF par heure supplémentaire commencée** ;
- plafond : **5,90 CHF par période de 24 h** ;
- le profil technique final encode cette formule avec
  `initial_fee_cents=100`, `included_minutes=60`, `period_minutes=60`,
  `price_per_period_cents=100` et `min_amount_cents=200` ;
- cette représentation technique donne exactement : 0–120 min = 2,00 CHF,
  121–180 min = 3,00 CHF, 181–240 min = 4,00 CHF,
  241–300 min = 5,00 CHF, puis 5,90 CHF jusqu'à 24 h.

Le rail de paiement par solde prépayé réserve **30 CHF** dans le ledger
Chargeurs.ch lorsqu'au moins 30 CHF sont disponibles. Cette réservation interne
n'est pas une seconde garantie Stripe. Elle reste soumise aux garde-fous serveur,
à l'acceptation contractuelle et au contrôle matériel avant éjection.

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

## Migrations v3

`20260827010000_pilot_pricing_rules_v3.sql` a introduit la version de calcul v3.
`20260827030000_member_pricing_v3_final.sql` est la correction tarifaire finale
et seule référence pour les nouvelles locations membre v3. Une migration déjà
appliquée n'est jamais réécrite pour modifier l'historique.

Le calculateur de settlement TypeScript/Deno et les fonctions PostgreSQL
`compute_customer_pricing_snapshot` et `customer_wallet_pricing_state` doivent
rester compatibles avec cette configuration. La migration corrective contient
des assertions sur tous les points de bascule commerciaux ainsi que sur les trois
bornes pilote.

## Extension

Le schéma supporte plusieurs profils, affectations, validités, périodes,
garanties, frais et plafonds. Toute nouvelle sémantique financière doit créer une
nouvelle `pricing_rules_version` au lieu de modifier silencieusement une version
historique.
