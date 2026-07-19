# Accès et informations à fournir

Ne transmettre aucun secret dans une issue, un email non chiffré ou Git. Utiliser les secrets Supabase/Vercel/GitHub selon la colonne « destination ».

| Élément | Utilité et source | Destination | Mode | Sensibilité | Vérification |
|---|---|---|---|---|---|
| Projets Supabase | Dashboard Supabase, un projet staging et un production | CLI, Vite pour URL/anon, secrets Edge pour `service_role` | test/live séparés | critique pour service role | migrations, Auth et health staging |
| Stripe publishable/secret | Dashboard Developers/API keys | publishable côté client si nécessaire, secret côté Edge | test/live | critique pour secret | Checkout test puis lecture PaymentIntent |
| Secrets webhook Stripe | Dashboard Webhooks, un par endpoint/environnement | secret Edge `STRIPE_WEBHOOK_SECRET` | test/live | critique | Stripe CLI et événement signé |
| Activation Wallets/TWINT | Dashboard Payment methods et paramètres domaine | compte Stripe | test/live | administrateur | Checkout compatible affiche les moyens |
| Banque et identité Stripe | Dashboard business/payouts | compte Stripe | live | critique/juridique | compte « charges enabled » et payouts |
| ChargeNow HTTP Basic | Valeur officielle après le préfixe `Basic` | secret Edge `CHARGENOW_BASIC_AUTH` | test | critique | requête borne en lecture seule, HTTP et code métier |
| Documentation API/protocole | Fournisseur de la borne | dépôt privé/référence contrôlée, jamais secrets | les deux | confidentiel | endpoints, signatures, slots et erreurs confirmés |
| Identifiants/numéros de série bornes | Étiquettes/portail fournisseur | back-office stations | test/live | interne | statut de la bonne borne uniquement |
| Domaine et DNS | Registrar/DNS du propriétaire | hébergeur web/Stripe/Auth | staging/live | administrateur | HTTPS, redirects Auth, webhook et Apple Pay |
| Hébergeur web | Projet Vercel ou équivalent | variables frontend/server | staging/live | administrateur | build, routes profondes et rollback |
| GitHub Actions | Settings du dépôt | secrets/variables d'environnement | staging/live | critique | workflow manuel sans exposition |
| Keystore Android | Nouveau coffre de signature Chargeurs.ch | secret CI et coffre hors ligne | live | critique irréversible | `apksigner verify` et empreinte archivée |
| Clé publique JWS éjection | Générée avec la clé privée backend | variable build Android | test/live | publique | autorisation valide/altérée testée |
| Tablette et borne pilote | Matériel possédé par Chargeurs.ch | laboratoire staging | test | physique | cycle boot/réseau/USB/location/retour |
| Emails support/partenaire | Comptes de messagerie du propriétaire | configuration applicative | live | interne | réception et SLA |
| Identité juridique/CGV | Registre suisse et conseil juridique | pages légales | live | juridique | validation signée avant ouverture |
| Sels/secret interne | Générés aléatoirement par environnement | secrets Edge | test/live | critique | fonctions refusent une valeur absente/courte |

## Variables particulières

- `CHARGENOW_RENT_SLOT_ZERO_MODE` reste vide. N'utiliser `provider_auto_select` qu'après confirmation écrite du fournisseur.
- `CHARGENOW_API_BASE_URL` vaut `https://developer.chargenow.top/cdb-open-api/v1`; le couple `CHARGENOW_BASIC_USERNAME`/`CHARGENOW_BASIC_PASSWORD` est uniquement un fallback.
- `CHARGENOW_MUTATIONS_ENABLED` reste `false` jusqu'à l'autorisation explicite d'un essai matériel.
- `PUBLIC_CONTACT_IP_HASH_SALT` doit contenir au moins 32 caractères aléatoires.
- `ALLOWED_ORIGINS` est une liste exacte séparée par virgules, sans joker en production.
- Les quatre variables `ANDROID_KEYSTORE_*` sont requises pour une release installable.

Le fichier `.env.example` est la liste machine lisible de référence.
