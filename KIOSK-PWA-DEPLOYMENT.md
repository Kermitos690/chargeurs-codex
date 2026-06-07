# Chargeurs.ch Kiosk — PWA borne (déploiement tablette Android)

## 1. Ce que fait la PWA (automatique)
- **Installable** depuis Chrome Android (manifest + icônes 192 / 512 + maskable, `display: fullscreen`, orientation `portrait`, thème `#0a1024`).
- **Service Worker** (`/sw.js`, généré par `vite-plugin-pwa`) : précache du shell de l'app, `NetworkFirst` pour les navigations HTML, `CacheFirst` pour les assets hashés uniquement.
- **Verrouillage borne** : à la 1ʳᵉ ouverture d'une URL `/kiosk/DTAxxxxx`, le cabinet est mémorisé localement (`localStorage`). `start_url = /kiosk` rouvre toujours cette borne après fermeture, reboot, mise à jour, perte réseau ou rechargement. Une autre URL de borne affiche « Borne verrouillée » et ne bascule jamais silencieusement.
- **Mode kiosque** : pas de zoom (double-tap / pinch), pas de sélection de texte, pas de menu contextuel, pas de pull-to-refresh, retour arrière / rechargement bloqués pendant paiement/location. Annulation toujours possible.
- **États réseau** : bannière « Connexion indisponible » ; aucune location/paiement créé hors-ligne ; statuts borne (en ligne / hors ligne / API non configurée).
- **Données dynamiques jamais mises en cache** : QR Stripe, session de paiement, statut location, statut batterie, réponses ChargeNow, données admin (toutes cross-origin → réseau seul).
- **Mises à jour** : détection nouvelle version ; auto-appliquée quand la borne est inactive ; jamais pendant un paiement/location ; bannière discrète.
- **Diagnostic protégé** : 5 tapotements sur le logo → version frontend, version SW, cabinet ID, dernière synchro, réseau, ChargeNow, Stripe, re-verrouillage borne, sortie plein écran.

## 2. Installation d'une borne (à faire sur chaque tablette)
1. Ouvrir Chrome et aller sur l'URL **exacte** de la borne :
   - `https://chargeurs-kiosk.lovable.app/kiosk/DTA21269`
   - `https://chargeurs-kiosk.lovable.app/kiosk/DTA21277`
   - `https://chargeurs-kiosk.lovable.app/kiosk/DTA22032`
2. Menu Chrome (⋮) → **Installer l'application / Ajouter à l'écran d'accueil**.
3. Ouvrir l'application depuis l'icône (elle démarre en plein écran).
4. Le cabinet est désormais verrouillé sur cette tablette.

## 3. Configuration Android (hors PWA — à faire manuellement)
- **Lancement auto au démarrage** : nécessite une app tierce (ex. « Autostart ») ou un launcher kiosque.
- **Épinglage d'écran (App pinning)** : Paramètres → Sécurité → Épinglage d'écran → activer, puis épingler la PWA. Empêche de quitter l'app.
- **Veille désactivée** : Paramètres → Affichage → Mise en veille → maximum, ou activer « rester allumé » en charge (options développeur).
- **Bloquer l'accès aux réglages** : via épinglage d'écran + verrouillage parental, ou MDM.

## 4. Mode appareil dédié (recommandé production)
Pour une vraie borne publique inviolable, utiliser un **MDM / mode kiosque Android dédié** (Android Enterprise, Fully Kiosk Browser, Scalefusion, etc.) :
- launcher kiosque verrouillé sur l'URL de la borne,
- redémarrage auto, anti-veille, blocage total des réglages,
- mise à jour à distance.
La PWA seule ne peut pas garantir le verrouillage matériel de la tablette.

## 5. Sécurité (vérifié)
- Aucun secret ChargeNow / Stripe dans le frontend ni le Service Worker.
- Aucun jeton admin mis en cache (les routes `/admin/*` sont exclues du SW : `navigateFallbackDenylist`).
- Le tarif et la location sont autorisés côté serveur par un **token kiosque lié à la borne** (`kiosk_quote`) : changer le cabinet ID dans l'URL ne contourne aucune autorisation serveur et ne donne pas accès à une autre borne.
- Les appels sensibles (Stripe, ChargeNow, éjection) restent côté Edge Functions.

## 6. Verdict
- **PWA prête** : ✅ (manifest, SW, verrouillage borne, mode kiosque, états réseau, mises à jour, diagnostic).
- **PWA installable mais configuration Android restante** : ⚠️ (autostart, épinglage, anti-veille, blocage réglages = manuel ou MDM).
- **Prête pour test physique** : ✅ sur les 3 URLs.
- **Prête pour production** : ❌ **NON** tant que les tests sur **tablette physique** + **vraie location/paiement** ne sont pas réalisés.
