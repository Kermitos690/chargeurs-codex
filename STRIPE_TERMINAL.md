# Stripe Terminal

## Statut

Stripe Terminal est secondaire et facultatif. La configuration par défaut demeure `QR_PRIMARY_TERMINAL_FALLBACK`. L'absence de lecteur ne bloque jamais Stripe Checkout QR.

L'APK fournisseur contient un SDK Terminal et des filtres USB observés, mais aucune clé, configuration marchand ou implémentation propriétaire n'a été reprise. La nouvelle application ne contient actuellement pas le SDK Terminal. Le statut honnête est `BLOQUÉ PAR FOURNISSEUR` jusqu'à la fourniture du modèle de lecteur, de sa méthode de connexion et d'un environnement Stripe Terminal de test ; le lecteur réel exigera ensuite `TERMINÉ — TEST MATÉRIEL REQUIS`.

## Activation future

1. Vérifier les modèles de lecteurs et le pays auprès de Stripe.
2. Créer une location Terminal et des ConnectionTokens exclusivement côté serveur.
3. Ajouter le SDK officiel dans une variante Android contrôlée.
4. Associer lecteur, location Stripe et station dans le back-office.
5. Tester découverte, connexion, collecte, confirmation, annulation, perte USB et réconciliation.
6. Activer `QR_PRIMARY_TERMINAL_FALLBACK` borne par borne.

`TERMINAL_ONLY` doit rester désactivé sauf installation future explicitement qualifiée. Les mêmes règles webhook, montant, devise, snapshot et compensation s'appliquent.
