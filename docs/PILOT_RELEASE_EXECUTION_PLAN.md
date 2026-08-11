# Chargeurs.ch — Pilot Release Execution Plan

## Mission
Transformer l'état actuel en un produit réellement installable chez un partenaire, sans réécrire l'architecture existante et sans introduire de nouvelles fonctions non nécessaires au pilote.

## Règle de travail
Priorité absolue à la fiabilité du parcours réel et à la récupération après erreur. Toute amélioration visuelle vient après les invariants métier. Chaque changement doit être incrémental, testable, réversible et compatible avec le WebView Chrome 88 de la borne.

## Périmètre pilote figé
- Une borne pilote DTA21269.
- Location Express sans compte.
- Client Chargeurs / membre existant.
- Paiement Stripe Checkout par QR sur le téléphone.
- Garantie 30 CHF.
- Tarification Express 0.75 CHF / 30 min, plafond 18 CHF/jour.
- Retour par réinsertion physique d'une batterie.
- ChargeNow comme source matérielle.
- FR / EN / DE.
- Back-office pour consultation, diagnostic et opérations sûres.

Tout ce qui n'est pas nécessaire à ce parcours est hors chemin critique du pilote.

## Gate 0 — Baseline et sécurité
GO uniquement si :
- main est déployé avec statut Vercel success ;
- la tablette est authentifiée et liée à DTA21269 ;
- aucun ancien checkout/session ne peut reprendre après reboot ;
- aucune fonction one-shot/ops de diagnostic ne peut exécuter une mutation accidentelle ;
- les webhooks Stripe et ChargeNow sont actifs et dédupliqués ;
- la borne est online et son inventaire correspond au cabinet réel.

## Gate 1 — Shell kiosk et tactile
Corriger une seule structure d'écran commune :
- header fixe ;
- stepper séparé ;
- contenu dans une safe-zone centrée ;
- action contextuelle Annuler/Retour séparée ;
- aucune couche décorative ne capte les pointer events ;
- aucun doublon Retour accueil ;
- aucune superposition header/stepper/actions sur 16:9 ;
- toutes les cibles tactiles >= 48 px ;
- pas de scroll sur les scènes kiosk.

Critère d'acceptation : 20 interactions successives sur la borne sans zone morte, sans reload, sans reconnexion inattendue.

## Gate 2 — Home claire et premium
- Hero parfaitement cadré, sans chevauchement de texte.
- Trois choix immédiatement compréhensibles : Express / Client Chargeurs / Pass & Offres.
- Titres et descriptions suffisamment grands pour être lus à distance.
- Barre moyens de paiement propre, sans capsules mal centrées, avec marques cohérentes.
- Borne 3D localisée FR/EN/DE.
- Fumée/glow/animations uniquement décoratifs et pointer-events:none.
- Aucune animation ne doit ralentir ou bloquer le tactile.

## Gate 3 — Express : choix → QR → paiement
- Le choix d'une batterie utilise le snapshot backend réel.
- Le pricing doit toujours être résolu avant création du Checkout ; aucun écran client ne doit afficher PRICING_NOT_CONFIGURED sur DTA21269.
- Le QR Stripe reste stable pendant la session.
- Pendant QR : aucun auto-retour accueil.
- Un bouton Annuler explicite revient à l'accueil sans prétendre annuler un paiement déjà confirmé.
- Après paiement confirmé : aucun spinner infini sur le téléphone.
- Le téléphone affiche un état confirmé et suit la location.

## Gate 4 — Paiement → sortie batterie
- Le webhook Stripe est la seule preuve financière de paiement.
- Une seule commande ChargeNow peut être envoyée.
- BATTERY_BORROW_OUT exact devient immédiatement battery_released + rental_activated.
- La borne quitte « Libération en cours » dès que la preuve matérielle existe.
- Scène attendue : « Prenez votre batterie — Slot X » puis « Location active ».
- Timeout/fallback d'affichage sans jamais simuler une sortie qui n'est pas prouvée.

Critère d'acceptation : 5 locations successives, 0 double-éjection, 0 écran bloqué, confirmation visuelle < 2 s après événement matériel.

## Gate 5 — Retour batterie
Règle canonique : BATTERY_IN est corrélé d'abord par battery_id à la seule location active correspondante.
- Retrouver started_at automatiquement.
- Prendre comme returned_at le premier BATTERY_IN réel reçu après started_at.
- orderId/station/slot servent de contrôles de cohérence, pas de dépendance fragile.
- Une batterie sans location active ne règle rien.
- Un retour valide déclenche une seule fois : return_detected → pricing_finalized → settlement → rental_completed.
- Aucun polling financier en boucle.

Critère d'acceptation : 5 retours successifs, prix exact, une seule tentative normale de settlement, UI de retour affichée en quelques secondes.

## Gate 6 — Pricing
- DTA21269 possède une stratégie Express active et un fallback explicite.
- Le membre possède une stratégie serveur active et non hardcodée dans le frontend.
- Le snapshot tarifaire est figé au début de la location.
- Le retour utilise exclusivement ce snapshot.
- Aucun tarif fournisseur/legacy ne peut remplacer silencieusement le tarif Chargeurs.ch.

## Gate 7 — Reboot, réseau et récupération
Tester réellement :
- reboot sur accueil ;
- reboot pendant sélection ;
- reboot avec QR non payé ;
- reboot après paiement avant sortie ;
- reboot après sortie ;
- perte réseau 10–30 s ;
- retour réseau.

Le kiosk-resume-state doit restaurer l'état serveur sans créer une nouvelle session et sans repartir systématiquement sur « connexion à la borne ».

## Gate 8 — Back-office minimal exploitable
À garantir uniquement pour le pilote :
- Overview ;
- Bornes / détail borne ;
- Locations ;
- Paiements ;
- Événements ;
- Santé ;
- Maintenance sûre ;
- Tarification ;
- Tablettes kiosque.

Chaque bouton visible doit soit fonctionner, soit être masqué. Aucun bouton qui appelle volontairement une action interdite par le backend.

## Gate 9 — Nettoyage sécurité / dette de test
- Neutraliser ou supprimer les fonctions ops-* / *-once temporaires de mutation.
- Ne garder les outils readonly réellement utiles qu'avec authentification appropriée.
- Vérifier qu'aucun secret n'est exposé dans logs, URLs, UI ou api_coverage.
- Fermer les sessions checkout abandonnées anciennes sans toucher aux paiements actifs.
- Résoudre les incidents obsolètes ou clairement corrigés.

## Gate 10 — Finition partenaire
- Home et parcours cohérents visuellement.
- FR/EN/DE complets sur toutes les scènes.
- Aide simple et transverse.
- Mentions prix/garantie/non-retour lisibles avant paiement.
- Écran final propre après sortie et après retour.
- Aucun texte technique brut visible au client.
- Aucun « SUCCESS.title », code interne, PRICING_NOT_CONFIGURED ou message Supabase/Stripe/ChargeNow brut.

## Gate 11 — Test de sortie pilote
Un seul scénario de certification est accepté :
1. reboot propre ;
2. accueil ;
3. Express ;
4. sélection batterie ;
5. QR ;
6. paiement test ;
7. sortie physique ;
8. confirmation borne + téléphone ;
9. location active ;
10. retour dans un slot disponible ;
11. calcul ;
12. capture ;
13. reçu/fin ;
14. retour accueil ;
15. deuxième location immédiatement possible.

Le test doit être répété au moins 3 fois sans intervention DB manuelle.

## GO / NO-GO partenaire
GO seulement si :
- 3 cycles complets consécutifs passent sans intervention manuelle ;
- aucun double débit / double éjection ;
- aucun écran tactile bloqué ;
- reboot et perte réseau récupèrent correctement ;
- aucun tarif manquant ;
- le back-office permet de diagnostiquer une location ;
- le frontend déployé correspond exactement au commit certifié.

## Prompt d'exécution permanent
« Agis comme ingénieur principal responsable de la mise en production pilote de Chargeurs.ch. Ne réécris pas l'application. Corrige l'existant incrémentalement. Priorise invariants métier, idempotence, sécurité financière et preuve matérielle avant animation. Chaque changement doit avoir une cause racine, un patch minimal, un test et une preuve. Ne déclenche jamais une mutation physique ou financière pour tester sans autorisation explicite lorsqu'elle n'est pas déjà impliquée dans un test utilisateur en cours. Ne prétends jamais qu'une version est déployée sans preuve Vercel/Supabase. Le pilote est prêt uniquement après 3 parcours complets consécutifs sans intervention manuelle. »
