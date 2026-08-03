# Déploiement staging — Chargeurs.ch

## 31 juillet 2026

- Environnement : staging uniquement.
- Projet Supabase : `xqepbqnaenoeyfjkjnzl`.
- Projet Vercel : `chargeurs-ch-staging`.
- Branche source : `agent/finalize-chargeurs-platform`.
- Commit déployé : `e47fdaf`.

## Composants déployés

- Migration additive exécutée directement via la Management API :
  `20260731132542_kiosk_numeric_enrollment_rate_limits.sql`.
  Elle ajoute le journal privé des tentatives, deux colonnes de suivi sur les
  codes d'appairage, les index associés et la surcharge cinq-arguments de la
  fonction de redemption. Elle ne supprime aucune donnée ni table.
- Fonctions Edge `kiosk-admin` et `kiosk-enroll` : version 13.
- Fonctions Edge `sync-cabinet-status` : version 18, `dta-pilot-qualification` : version 5 et `chargenow-admin` : version 11. Elles n'autorisent désormais qu'O1 (`GET /rent/cabinet/query`) vers l'API fournisseur ; les mutations et routes non confirmées répondent fail-closed.
- Stripe Test : destination webhook `chargeurs-ch-staging-checkout` active sur
  `stripe-webhook`. Les fonctions `create-stripe-checkout`, `stripe-webhook`,
  `rental-admin-action`, `eject-after-payment`, `settle-rental-payment`,
  `admin-maintenance-action` et `platform-api` ont été déployées en version 13.
  Leurs secrets sont stockés exclusivement dans le coffre Supabase.
- Frontend Vercel :
  [déploiement inspectable](https://vercel.com/gaetans-projects-4974c31a/chargeurs-ch-staging/BPJwYnnMK8yjXDnBoBkkaPUPGDSF),
  URL attribuée `https://chargeurs-ch-staging-j753dq8vn-gaetans-projects-4974c31a.vercel.app`,
  alias staging `https://chargeurs-ch-staging.vercel.app`.

## Vérifications effectuées

- `kiosk-enroll` répond à une requête volontairement malformée par HTTP 400 et
  `INVALID_ENROLLMENT_REQUEST` : l'endpoint est joignable sans créer ni
  consommer de code.
- La table de tentatives et les colonnes de contrôle existent dans staging.
- Les routes `/`, `/admin` et `/kiosk/DTA21269` répondent toutes par HTTP 200
  via l'alias staging ; le manifeste PWA répond également.
- L'inspection Vercel retourne `Ready` pour le déploiement ci-dessus.
- Recherche ciblée dans le HTML servi : aucun secret serveur, identifiant
  ChargeNow, clé Stripe secrète ni service role détecté.
- Un événement Stripe Test signé `checkout.session.expired` a été livré au
  webhook staging avec `200 OK`. Une requête volontairement non signée reste
  refusée par HTTP 400 / `MISSING_SIGNATURE`.

## Limites et rollback

- L'historique de migrations staging reste divergent de Git. Aucun `db push`,
  `migration repair` ou déploiement de migration historique n'est autorisé
  tant qu'une baseline reproductible n'a pas été validée.
- Aucun Stripe live, paiement réel, mutation ChargeNow, redémarrage ou éjection
  matérielle n'a été réalisé.
- Rollback frontend : promouvoir le déploiement Vercel précédent. Rollback de
  fonction : redéployer le commit précédent après une revue ; la migration est
  additive et ne doit pas être supprimée.

## Correctif récupération de mot de passe — 31 juillet 2026, 19:57 CEST

- Commit : `4450c1c` ; projet Vercel staging uniquement.
- Déploiement : `dpl_6qT4wpAM24wHauy6wXTt7FbqbAhd`, état `Ready` ; alias
  `https://chargeurs-ch-staging.vercel.app` conservé.
- Les demandes de récupération utilisent désormais un client d’authentification
  dédié en flux implicite et non persistant. Le lien peut être ouvert depuis
  Gmail/Safari ou un autre appareil ; le fragment d’URL est nettoyé aussitôt
  après l’établissement de la session de récupération.
- Le client PKCE principal reste utilisé pour les sessions ordinaires. Aucun
  e-mail de réinitialisation, mot de passe ni session n’a été créé durant la
  vérification de déploiement.

## Correctif orientation du compte administrateur — 31 juillet 2026, 20:05 CEST

- Commit applicatif : `5a70bb6` ; déploiement staging :
  `dpl_FYKwaeo9daMJUzjSpbtxBETcg8QC`, état `Ready`.
- URL inspectable :
  `https://chargeurs-ch-staging-7ap7kscb1-gaetans-projects-4974c31a.vercel.app`.
  L’alias `https://chargeurs-ch-staging.vercel.app` pointe vers ce déploiement.
- Une connexion depuis « Mon compte » consulte désormais les rôles propres au
  compte connecté : un rôle de back-office est orienté vers `/admin`, un
  client reste dans `/compte`. La vérification backend/RLS n’est pas modifiée.
- `/admin` répond via l’alias staging. Typecheck, 68 tests Vitest et build Vite
  ont réussi avant le déploiement. Aucune donnée distante n’a été modifiée.

## Correctif WebView kiosk — 31 juillet 2026, 22:14 CEST

- Staging uniquement ; aucune migration, Edge Function, configuration Stripe
  ou configuration ChargeNow n’a été modifiée.
- Déploiement `dpl_7HwR6hLPG4tQBAVRWnWCbn65Q6bT`, état `Ready` :
  `https://vercel.com/gaetans-projects-4974c31a/chargeurs-ch-staging/7HwR6hLPG4tQBAVRWnWCbn65Q6bT`.
- L’alias `https://chargeurs-ch-staging.vercel.app` cible ce déploiement et
  sert le bundle `assets/index-Bnc-yZa9.js` avec sa feuille CSS associée.
- Correctif publié : compatibilité Chromium 61 pour Android WebView et pas de
  service worker dans le wrapper natif. Typecheck, 68 tests Vitest et build
  Vite ont réussi avant le déploiement.

## Correctif configuration Vercel — 31 juillet 2026, 22:28 CEST

- Le déploiement précédent ciblait un environnement Vercel personnalisé sans
  variables Vite et entraînait `supabaseUrl is required` dans le navigateur.
  Il est écarté et ne constitue pas un déploiement staging valide.
- Les variables publiques `VITE_SUPABASE_URL`,
  `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID`,
  `VITE_APP_ENV`, `VITE_ROUTER_MODE` et `VITE_ENABLE_STRIPE_TERMINAL` sont
  maintenant définies uniquement dans Vercel Preview. Aucune clé de service,
  Stripe secrète ou secret ChargeNow n’a été configuré côté Vercel.
- Déploiement valide : `dpl_6WbRftsof1cWc8VmCrxtUE2s7iUn`, état `Ready` ;
  l’alias `https://chargeurs-ch-staging.vercel.app` lui est affecté.
- Contrôle HTTP : le bundle `assets/index-Cuhxv-s1.js` expose l’URL Supabase
  publique du staging et aucune valeur sensible.

## Portail client, borne publique et Checkout kiosque — 3 août 2026

- Frontend staging : commit `6bc89e7`, déploiement Vercel
  `dpl_79GS61VC3D6BxLrZiosk5nZYu9AD`, état `Ready` ; l’alias
  `https://chargeurs-ch-staging.vercel.app` a été vérifié en HTTP 200 pour
  `/`, `/bornes/DTA21269`, `/compte`, `/admin` et `/kiosk/DTA21269`.
- Le portail `/compte` comprend des vues protégées pour les locations,
  paiements, support et profil. Les erreurs de lecture restent explicites et
  aucune donnée de démonstration n’est injectée.
- La fiche publique `/bornes/:stationId` ne lit qu’une liste de colonnes
  publiée ; elle ne redirige plus vers un kiosk et n’expose aucun payload
  fournisseur interne.
- Edge Functions staging déployées depuis `189dbb9` :
  `create-stripe-checkout`, `eject-after-payment`, `chargenow-admin`. Les
  sondes sans effet ont confirmé les réponses `405`, `405`, `401` : les
  endpoints sont publiés, sans créer de Checkout, paiement ni commande
  matérielle.
- Contrôles avant déploiement : 76 tests Vitest, typecheck TypeScript,
  build Vite ; 47 tests Deno ciblés et `deno check` des modules fonctionnels.
  Aucune migration, opération Stripe live ou mutation ChargeNow n’a été
  effectuée.

## Expurgation des rapports de test — 3 août 2026

- Commit `2f374be`, déploiement staging `dpl_JBrsHfeuU94vr7aMMBQHuGry4YJj`,
  état `Ready` ; l’alias `https://chargeurs-ch-staging.vercel.app` a été
  actualisé.
- Le contrôle de test ne lit plus les derniers `api_logs` globaux. Il filtre
  les journaux Stripe par `rentalSessionId` et les journaux ChargeNow par
  `tradeNo`, puis applique une expurgation récursive avant l’affichage ou un
  export local.
- Vérifications avant publication : deux tests de confidentialité dédiés,
  typecheck TypeScript et build Vite réussis. Aucune donnée distante n’a été
  modifiée.

## Durcissement des codes publics de location — 3 août 2026

- Edge Function staging : `create-rental-session` déployée depuis le commit
  `8b996f0`. Les nouvelles locations recevront un code public `CHG-` de douze
  caractères issu du générateur cryptographique Web Crypto.
- Sonde passive effectuée sans payload : réponse `400 MISSING_STATION`, ce qui
  confirme que l'endpoint est joignable et refuse une requête incomplète. Aucune
  location, session Checkout, paiement, commande fournisseur ou opération
  matérielle n'a été créée.
- La migration SQL associée à la restriction des helpers de rôle est
  volontairement non appliquée : voir
  `docs/SUPABASE_MIGRATION_RECONCILIATION.md`.

## Frontend staging — rôles explicites — 3 août 2026

- Commit déployé : `65dd17e` sur le projet Vercel explicitement nommé
  `chargeurs-ch-staging`. L'URL d'inspection est protégée par le SSO Vercel ;
  aucune URL de production Chargeurs.ch n'a été ciblée.
- L'alias `https://chargeurs-ch-staging.vercel.app` a répondu HTTP 200 aux
  routes `/admin` et `/kiosk/DTA21269` après le déploiement.
- L'écran utilisateurs distingue les rôles immédiatement attribuables des
  rôles en attente de migration/RLS. Aucun compte, rôle ou donnée staging n'a
  été créé par ce déploiement.
