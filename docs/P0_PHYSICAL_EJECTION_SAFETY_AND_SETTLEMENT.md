# P0: sortie physique et règlement — correctif en attente de déploiement

## Incident observé

Les photos du 12 août 2026 de la borne pilote `DTA21269` montrent qu'une seule
location Stripe Test a mené à la sortie physique de **deux batteries**. Cette
observation prime sur tout accusé HTTP fournisseur : le comportement précédent
ne peut pas être considéré comme exactement-une-sortie.

Les mêmes observations montrent un écran actif incohérent, dont une scène
« batterie prête » qui pointait vers le mauvais slot et dont les textes se
chevauchaient. Aucun de ces écrans ne constitue une preuve de l'état matériel.

## Cause technique traitée dans ce commit

Avant ce correctif, un accusé fournisseur asynchrone pouvait faire progresser
la location vers l'état actif. Il ne vérifiait pas qu'une seule batterie avait
quitté le cabinet. De plus, les redéliveries de callback pouvaient posséder un
identifiant d'enveloppe différent tout en représentant le même fait de retour,
ce qui permettait de réappeler le règlement. Enfin, le retry de règlement
transitoire n'avait pas de prochain instant persistant : le polling pouvait le
réactiver très fréquemment.

## Changement mis en œuvre

1. `hardware_commands` est une intention persistée, unique par
   `(rental_session_id, command_type)`, créée **avant** toute mutation
   fournisseur. Un timeout est `unknown_provider_result`, jamais une nouvelle
   commande automatique.
2. La callback de sortie est désormais uniquement un accusé fournisseur. Elle
   ne peut plus émettre `battery_released` ou `rental_activated`.
3. Seule une lecture cabinet, sans mutation, peut confirmer la sortie du slot
   sélectionné. Elle compare également le snapshot de pré-vol : si un autre
   slot précédemment occupé est devenu vide, l'état devient `needs_support`,
   l'intention est `physical_ambiguity` et un incident critique
   `MULTIPLE_SLOT_CHANGE_AFTER_EJECTION` est créé. Aucun second appel matériel
   n'est alors possible.
4. Le mapping visuel physique est fixé à `1 | 3` en haut, `2 | 4` en bas.
5. Les retours utilisent un fait métier stable
   `return:<trade_no>:<battery_id>` et `rental_return_events` empêche une
   redélivrance callback de relancer le règlement.
6. Un échec de règlement reçoit une échéance persistée de retry avec backoff
   exponentiel (5 min au minimum, plafonné à 24 h). Le polling kiosk ne doit
   jamais déclencher une boucle financière de cinq secondes.
7. Le paiement confirmé et l'éjection sont deux scènes distinctes : le kiosque
   n'affiche pas une animation de libération avant que le serveur ait persisté
   l'état `ejecting`.

## Migration requise

`20260812090000_hardware_intents_return_events_and_settlement_backoff.sql`
est additive. Elle ajoute les tables d'intentions/révénements et les colonnes
de backoff, sans supprimer de données ni modifier une migration historique.

Cette migration **n'est pas appliquée sur staging au moment de ce document**.
Par conséquent, le correctif n'est ni `DEPLOYED_STAGING`, ni
`HARDWARE_TESTED`, ni `PHYSICALLY_VERIFIED`.

## Validation réalisée localement

- 29 tests Deno de contrats Edge, incluant commande unique, callback,
  réconciliation lecture seule, détection d'un deuxième slot et déduplication
  de retour : `PASS`.
- TypeScript : `PASS`.
- Tests Vitest : 110 tests : `PASS`.
- Build Vite : `PASS`.

Ces validations prouvent le code et les contrats, pas le comportement du
cabinet physique. Aucun paiement, callback réel, appel ChargeNow, éjection,
redémarrage de cabinet ni écriture staging n'a été exécuté pendant cette
correction.

## Étape de validation suivante, contrôlée

1. Revoir puis appliquer la migration additive sur staging.
2. Déployer les Edge Functions concernées et le build web identifié.
3. Vérifier les logs avec des callbacks de test sans mutation matériel.
4. Relire un snapshot DTA21269.
5. Seulement après les contrôles verts, demander explicitement :

   `AUTORISER ÉJECTION TEST DTA21269 SLOT X`

Le test devra contrôler qu'un seul slot change, qu'une seule batterie est
physiquement sortie et que l'état est mis en quarantaine à la première
divergence.
