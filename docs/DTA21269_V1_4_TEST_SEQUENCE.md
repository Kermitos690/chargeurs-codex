# Séquence de test DTA21269 — analyseur v1.4

1. Conserver installés `com.szbjkj.bajietouchpower`, HappyNet et Chargeurs FreeTest.
2. Installer l’APK `ch.chargeurs.kiosk.analyzer` v1.4.0-local.
3. Ouvrir **Chargeurs Graphe DTA**.
4. Lancer **Construire le graphe d’appels**.
5. Vérifier à l’écran le nombre de DEX, méthodes, appels, racines, sorties et chemins.
6. Exporter le rapport dans `Téléchargements/Chargeurs`.
7. Ne déclencher aucune commande série depuis FreeTest ou l’analyseur.

Le résultat attendu est un rapport statique. Une absence de chemin complet reste une information exploitable : le rapport fournit alors les racines, sorties, appelants proches et chaînes référencées pour la passe suivante.
