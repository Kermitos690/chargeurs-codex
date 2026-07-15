# APK kiosk Chargeurs.ch

## Objectif

L’APK Android est un wrapper plein écran autour de l’interface web `/kiosk/:stationId`. Il ne duplique pas la logique Stripe, Supabase ou ChargeNow : cette logique reste côté web et backend afin de permettre des mises à jour rapides sans réinstaller toutes les bornes.

## Responsabilités de l’APK

- démarrage automatique après redémarrage Android ;
- affichage plein écran immersif ;
- verrouillage sur une station déterminée ;
- stockage local du `stationId` et du jeton kiosk ;
- reconnexion automatique ;
- reprise après coupure électrique ;
- cache PWA minimal ;
- désactivation de la navigation libre, du zoom et des menus système lorsque le matériel le permet ;
- écran de maintenance protégé ;
- journal local des erreurs réseau et WebView.

## URL cible

```text
https://chargeurs.ch/kiosk/DTA21269
```

En staging, utiliser le domaine de preview avec une station de démonstration.

## Sécurité

Le jeton kiosk doit être provisionné directement sur la tablette. Il ne doit jamais être inclus dans l’URL, dans un QR code public ou dans le dépôt GitHub. L’application web l’envoie au backend via l’en-tête `X-Kiosk-Token`.

Une tablette est verrouillée sur un seul identifiant de borne. Une URL comportant un autre identifiant doit afficher une erreur de correspondance, sans changer silencieusement la configuration.

## Recommandation technique

Première version : Android WebView ou Trusted Web Activity selon les capacités du matériel.

Utiliser une WebView lorsque les bornes nécessitent :

- lancement automatique strict ;
- contrôle du mode immersif ;
- pont JavaScript avec un SDK matériel ;
- diagnostics locaux ;
- gestion avancée des erreurs réseau.

Utiliser une Trusted Web Activity uniquement si le matériel accepte une expérience PWA standard sans pont natif.

## Critères de recette

1. L’APK démarre automatiquement sur la bonne borne.
2. La tablette ne change pas de station en modifiant simplement l’URL.
3. Une coupure réseau empêche clairement un nouveau paiement.
4. Une mise à jour PWA n’interrompt jamais un paiement en cours.
5. Après redémarrage électrique, l’écran kiosk revient automatiquement.
6. Le menu de diagnostic reste inaccessible au client ordinaire.
7. Aucun secret n’apparaît dans les logs ou captures d’écran.
