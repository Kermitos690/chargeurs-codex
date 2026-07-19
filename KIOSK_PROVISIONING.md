# Provisionnement d'une borne

## Avant l'installation

1. Créer/valider la station réelle dans le back-office.
2. Confirmer son identifiant fournisseur, numéro de série, établissement et profil tarifaire canonique.
3. Vérifier que les locations bêta restent fermées.
4. Dans « Tablettes kiosque », générer un code d'appairage de 5 à 60 minutes.

## Sur la tablette

1. Installer l'APK signé par Chargeurs.ch.
2. Ouvrir l'application et saisir le code `kc_…` affiché une seule fois.
3. L'application crée une identité publique locale, appelle l'URL HTTPS d'enrôlement et stocke le token reçu via Android Keystore.
4. Le code devient immédiatement inutilisable et n'est jamais enregistré en clair côté serveur.
5. Vérifier l'écran kiosque, l'identifiant de station, la version APK, la connexion et le statut matériel.

## Contrôles

- Une URL avec une autre station doit être refusée côté application et côté serveur.
- Révoquer le terminal dans le back-office doit bloquer la prochaine opération authentifiée.
- Une réinstallation crée une nouvelle identité et exige un nouveau code.
- Tester réseau perdu/retrouvé, redémarrage, boot, certificat TLS invalide et origine externe.

## Test matériel contrôlé

Le test d'éjection ne peut être exécuté qu'après installation de l'adaptateur protocolaire approuvé, sur une borne de staging isolée, avec confirmation physique et sans paiement live. La configuration par défaut refuse toute commande locale.

## Mise en service

Après Checkout test, webhook signé, commande ChargeNow, éjection, retour et règlement test complets, valider la station dans `PRODUCTION_CHECKLIST.md`. Activer ensuite la borne et les feature flags par une action manuelle journalisée.
