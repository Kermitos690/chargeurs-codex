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

## Limites et rollback

- L'historique de migrations staging reste divergent de Git. Aucun `db push`,
  `migration repair` ou déploiement de migration historique n'est autorisé
  tant qu'une baseline reproductible n'a pas été validée.
- Aucun Stripe live, paiement réel, mutation ChargeNow, redémarrage ou éjection
  matérielle n'a été réalisé.
- Rollback frontend : promouvoir le déploiement Vercel précédent. Rollback de
  fonction : redéployer le commit précédent après une revue ; la migration est
  additive et ne doit pas être supprimée.
