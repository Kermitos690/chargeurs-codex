# Moteur tarifaire

## Règles canoniques

Les montants ne sont pas documentés ici comme valeurs commerciales fixes. Le
profil actif affecté à une station et le `pricing_snapshot` immuable de chaque
location sont les seules sources de vérité pour la période, la garantie, le
plafond journalier, le délai et le montant de non-retour.

## Résolution

Les profils sont résolus par priorité d'affectation (terminal/station/établissement/défaut), dates de validité et priorité. Les mutations passent par `pricing-admin`, sont validées, versionnées et auditées.

## Snapshot

À la création de la location, `compute_rental_pricing_snapshot` copie toutes les règles nécessaires dans un JSON autonome. Son hash canonique est stocké. Checkout et règlement recalculent le hash et refusent toute absence, altération, devise différente ou profil/version incohérent.

Modifier un profil publié ne change jamais une location en cours. Un trigger `BEFORE` crée les versions et une contrainte unique protège `(price_profile_id, version)`.

## Calcul final

La durée est arrondie au nombre supérieur de périodes. Le plafond journalier
s'applique à la location normale. Le non-retour est un total contractuel défini
dans le snapshot, et non une surcharge silencieuse. Taxes, arrondis, minimum
et maximum proviennent du snapshot.

## Extension

Le schéma supporte plusieurs profils, affectations, validités, périodes, cautions, frais et plafonds. Promotions/coupons/périodes gratuites nécessitent une extension versionnée du `pricing_rules_version`, pas une modification silencieuse du calcul v1.
