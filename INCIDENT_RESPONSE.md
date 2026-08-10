# Réponse aux incidents

## Priorités

- Critique : secret exposé, débit incorrect massif, éjection non autorisée, compromission admin.
- Haute : paiements reçus sans délivrance, retours non rapprochés, borne incontrôlable.
- Moyenne : borne hors ligne, stock incohérent, remboursement retardé.
- Basse : défaut d'affichage ou demande isolée sans impact financier.

## Procédure

1. Contenir : fermer les locations/feature flags, révoquer terminal/API/secret concerné, isoler la borne.
2. Préserver : noter heures, IDs non secrets, versions, événements Stripe/ChargeNow et audits ; ne pas modifier les preuves.
3. Analyser : comparer Rental Orchestrator, Stripe, ChargeNow et état physique.
4. Corriger : utiliser une action idempotente auditée ; ne jamais éditer directement un état critique pour « faire disparaître » l'incident.
5. Communiquer : message client factuel, délai de remboursement réaliste, aucune promesse d'éjection non confirmée.
6. Rétablir progressivement en staging puis sur une borne pilote.
7. Rédiger le post-mortem et ajouter un test de non-régression.

## Échec après paiement

Marquer la délivrance comme non confirmée, créer l'incident, lancer le remboursement idempotent et afficher « remboursement en cours ». Une reprise manuelle d'éjection exige de confirmer l'état Stripe et l'absence de première délivrance.

## Secret exposé

Révoquer/rotater immédiatement dans le fournisseur, GitHub et Supabase ; rechercher les usages ; redéployer ; vérifier les audits. Supprimer un secret du dernier commit ne suffit pas.
