# Chargeurs.ch V2 — avancement

## Lot 1 — SEO local et indexation

- pages locales dynamiques par ville ;
- priorité Vaud et Suisse romande ;
- métadonnées, canonical et JSON-LD ;
- sitemap public ;
- robots excluant admin, compte, paiement et kiosk.

## Lot 2 — accueil, tarifs, bornes et support

- page d'accueil repositionnée sur la location de powerbanks et la recharge de natel ;
- règles tarifaires publiques centralisées ;
- caution 30 CHF ;
- 1.50 CHF par heure, incréments de 30 minutes ;
- plafond journalier 18 CHF ;
- non-retour 99 CHF ;
- trois bornes de démonstration DTA21269, DTA21277 et DTA22032 ;
- page partenaires ;
- page support ;
- liens de navigation publics ;
- tests unitaires du moteur tarifaire public.

## Prudence production

Les bornes de démonstration restent explicitement marquées comme telles lorsqu'elles ne sont pas connectées. Les moyens de paiement affichés doivent correspondre aux méthodes effectivement activées dans Stripe avant ouverture publique.

## Prochains lots

1. Alignement du moteur tarifaire public avec le moteur backend réel.
2. Notifications de location et alertes client.
3. Pages SEO par partenaire et borne.
4. Monitoring et health score des stations.
5. APK wrapper Android kiosk.
6. Validation complète lint, typecheck, tests et build.
