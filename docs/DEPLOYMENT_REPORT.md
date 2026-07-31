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
