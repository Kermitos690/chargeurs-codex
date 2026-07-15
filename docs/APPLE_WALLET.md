# Apple Wallet — carte membre Chargeurs.ch

## Statut réel

L'architecture logicielle de la carte membre est intégrée au dépôt. Un fichier `.pkpass` n'est installable sur iPhone que lorsque les certificats Apple réels sont configurés dans les secrets Supabase/GitHub. Aucun certificat, fichier `.p12`, mot de passe ou token brut ne doit être commité.

Cette carte est une **carte membre `storeCard`**. Elle n'est ni Apple Pay, ni une carte bancaire, ni un moyen de paiement.

## Architecture existante réutilisée

- Frontend : Vite, React, TypeScript, React Router et composants shadcn/ui.
- Authentification : Supabase Auth. Le retour après connexion conserve `?next=/wallet/...`.
- Backend : Supabase Edge Functions Deno.
- Base : PostgreSQL/Supabase, profils et locations existants.
- Données réelles : `profiles`, `rental_sessions`, et, seulement lorsqu'elles existent, `wallets` et `subscriptions`.
- Administration : section `/admin/wallet-passes` dans le back-office existant.

Aucune application parallèle et aucune seconde base ne sont créées.

## Fichiers principaux

- `supabase/functions/_shared/appleWallet.ts` : résolution des données, chiffrement des tokens, génération et signature.
- `supabase/functions/apple-wallet-pass` : téléchargement propriétaire authentifié du `.pkpass`.
- `supabase/functions/apple-wallet-web-service` : API Apple Wallet de registre, désenregistrement, recherche des mises à jour, récupération du pass et logs.
- `supabase/functions/wallet-link` : résolution sécurisée du QR opaque.
- `supabase/functions/wallet-admin` : gestion administrative.
- `src/components/account/AppleWalletButton.tsx` : bouton du compte client.
- `src/pages/WalletLanding.tsx` : destination neutre et sécurisée du QR.
- `src/pages/admin/AdminWalletPasses.tsx` : interface d'exploitation.

## Données visibles

La carte utilise uniquement les valeurs réellement disponibles :

- nom public du profil, sinon libellé neutre `Membre Chargeurs.ch` ;
- numéro membre stable produit par `ensure_member_number` ;
- statut réel du profil ;
- abonnement si une valeur réelle est trouvée ;
- crédit si une valeur réelle en centimes est trouvée ;
- total des locations rattachées au compte ;
- location active et état réel ;
- dernière location ;
- liens compte, bornes et support.

Un champ absent n'est pas inventé. Le crédit et l'abonnement sont retirés du pass lorsqu'aucune source réelle compatible n'existe.

## QR et lien tactile

Le QR contient uniquement :

`https://<PUBLIC_APP_URL>/wallet/<token-opaque>`

Le token :

- est généré avec 256 bits aléatoires ;
- n'inclut ni UUID utilisateur, ni email, ni téléphone, ni JWT ;
- est stocké sous forme de hash pour la recherche et chiffré AES-256-GCM pour régénérer le pass ;
- peut être révoqué ou remplacé par le super-administrateur.

Comportement :

- propriétaire déjà connecté : redirection vers `/compte` ;
- propriétaire non connecté : connexion puis retour automatique ;
- autre personne ou token invalide : page neutre sans donnée personnelle ;
- personne sans compte : lien vers l'inscription, sans association automatique à la carte d'un tiers.

Le verso du pass contient un champ explicite « Ouvrir mon compte » utilisant la même URL sécurisée. Il ne dépend pas d'un clic sur le dessin du QR.

## Variables d'environnement obligatoires

```text
APPLE_PASS_TYPE_IDENTIFIER=pass.ch.chargeurs.loyalty
APPLE_TEAM_IDENTIFIER=<Apple Team ID>
APPLE_PASS_WEB_SERVICE_URL=https://<supabase-project>.supabase.co/functions/v1/apple-wallet-web-service
APPLE_PASS_SIGNER_CERTIFICATE_BASE64=<certificat Pass Type ID PEM encodé en base64>
APPLE_PASS_SIGNER_KEY_BASE64=<clé privée PEM encodée en base64>
APPLE_PASS_SIGNER_KEY_PASSPHRASE=<mot de passe de la clé, vide si aucun>
APPLE_WWDR_CERTIFICATE_BASE64=<certificat Apple WWDR PEM encodé en base64>
WALLET_TOKEN_ENCRYPTION_KEY=<32 octets aléatoires encodés en base64>
PUBLIC_APP_URL=https://app.chargeurs.ch
```

`WALLET_TOKEN_ENCRYPTION_KEY` peut être produit localement :

```bash
openssl rand -base64 32
```

Ne jamais afficher ces valeurs dans l'administration. La page admin ne montre que `configuré / manquant`.

## Configuration Apple Developer — procédure manuelle

1. Ouvrir Apple Developer → Certificates, Identifiers & Profiles.
2. Créer un identifiant de type **Pass Type ID**.
3. Utiliser l'identifiant `pass.ch.chargeurs.loyalty` ou mettre à jour la variable et le certificat ensemble.
4. Créer localement une clé privée et un CSR dans Trousseau d'accès ou avec OpenSSL.
5. Générer le certificat **Pass Type ID Certificate** depuis le CSR.
6. Télécharger le certificat Apple et l'associer à la clé privée ayant créé le CSR.
7. Exporter, si nécessaire, le couple au format `.p12` uniquement sur une machine sécurisée.
8. Convertir localement le certificat et la clé au format PEM :

```bash
openssl pkcs12 -in chargeurs-wallet.p12 -clcerts -nokeys -out signer-cert.pem
openssl pkcs12 -in chargeurs-wallet.p12 -nocerts -out signer-key-encrypted.pem
```

9. Télécharger le certificat intermédiaire Apple WWDR actuellement recommandé par Apple et le convertir en PEM si nécessaire.
10. Encoder les trois fichiers PEM en base64 sans saut de ligne :

```bash
base64 < signer-cert.pem | tr -d '\n'
base64 < signer-key-encrypted.pem | tr -d '\n'
base64 < AppleWWDR.pem | tr -d '\n'
```

11. Ajouter les valeurs dans les secrets Supabase, jamais dans `.env` commité.
12. Déployer les migrations et les Edge Functions depuis GitHub CI/CD.
13. Vérifier que `APPLE_PASS_WEB_SERVICE_URL` est publiquement joignable en HTTPS.
14. Se connecter sur un iPhone avec Safari, ouvrir `/compte`, puis toucher « Ajouter à Apple Wallet ».
15. Vérifier dans Wallet le QR, le lien du verso et l'enregistrement de l'appareil dans l'administration.

## Mises à jour dynamiques

Les migrations incrémentent la version du pass lorsque des données visibles peuvent changer :

- profil ou statut du compte ;
- location créée, démarrée, retournée ou clôturée ;
- solde du portefeuille lorsque la table `wallets` existe ;
- abonnement lorsque la table `subscriptions` existe.

Apple demande ensuite les numéros de série modifiés et télécharge une nouvelle version signée. Les push tokens sont stockés pour l'envoi APNs ; l'envoi APNs effectif exige une configuration Apple supplémentaire et doit être activé dans une étape de déploiement contrôlée.

## Sécurité

- génération et signature uniquement côté serveur ;
- propriété déterminée par le JWT Supabase vérifié côté serveur ;
- endpoint Apple protégé par `Authorization: ApplePass <token>` ;
- tokens sensibles chiffrés et hashés ;
- tables sensibles non lisibles par `anon` ou `authenticated` ;
- vue propriétaire limitée aux métadonnées sûres ;
- administration protégée par rôle, révocation/rotation réservées au super-administrateur ;
- journaux expurgés ;
- réponse neutre contre l'énumération ;
- aucun montant ou statut modifiable depuis le QR.

## Limites avant certification

Sans certificat Pass Type ID, clé privée et WWDR valides :

- l'endpoint retourne `APPLE_WALLET_NOT_CONFIGURED` ;
- le frontend explique que Wallet n'est pas encore configuré ;
- aucune affirmation d'installation réussie ne doit être faite.

Les migrations et fonctions doivent d'abord être validées sur staging, puis testées sur un iPhone réel avant production.
