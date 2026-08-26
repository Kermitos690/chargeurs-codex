# Chargeurs.ch

Chargeurs.ch est une plateforme de location de batteries externes / powerbanks destinée aux bars, restaurants, hôtels, clubs, commerces et événements en Suisse romande.

Le dépôt contient l'application web publique, les écrans kiosk, l'espace client, l'administration, le moteur tarifaire, le Rental Orchestrator et les fonctions Supabase utilisées pour Stripe et ChargeNow.

> Source opérationnelle canonique de préproduction : `docs/PRE_PRODUCTION_CANONICAL_OVERVIEW.md`.
> `docs/PROJECT_BIBLE.md` et les rapports datés restent des éléments d’historique et ne doivent plus servir de source tarifaire courante.

## Parcours produit cible

1. Le client voit une borne Chargeurs.ch.
2. Il choisit le parcours Express ou connecte son compte Chargeurs.ch.
3. Le serveur crée un snapshot tarifaire immuable pour cette location.
4. Le client vérifie les montants et accepte explicitement les documents contractuels.
5. Express utilise la garantie Stripe prévue dans son snapshot.
6. Un membre disposant d'au moins 30 CHF de solde prépayé disponible peut réserver 30 CHF dans son solde Chargeurs.ch au lieu de fournir une deuxième garantie bancaire.
7. Le backend n'autorise l'éjection qu'après une autorité financière serveur confirmée (`authorized` ou `prepaid`) et la validation des garde-fous matériels.
8. La location devient active uniquement après confirmation physique de la remise de la batterie.
9. Au retour, le moteur calcule le prix depuis le snapshot accepté, règle le rail financier correspondant et libère le surplus éventuel.
10. Pour les nouvelles locations v3, un non-retour confirmé à 72 heures produit un total contractuel de 30 CHF, et non une pénalité ajoutée au prix accumulé.

## Tarification pilote canonique — nouvelles locations v3

### Express

- jusqu'à 30 minutes : **1,90 CHF** ;
- jusqu'à 2 heures : **3,90 CHF** ;
- jusqu'à 6 heures : **5,90 CHF** ;
- jusqu'à 24 heures : **7,90 CHF** ;
- le mécanisme de garantie de référence du pilote est **30 CHF** ;
- non-retour à **72 heures : 30 CHF au total**.

### Client avec solde prépayé Chargeurs.ch

- premières 30 minutes : **1,00 CHF** ;
- chaque tranche supplémentaire de 30 minutes commencée : **+0,40 CHF** ;
- plafond : **5,90 CHF par période de 24 heures** ;
- avec au moins **30 CHF disponibles**, le backend réserve 30 CHF dans le solde prépayé et ne crée pas de garantie Stripe supplémentaire ;
- au retour, seul le prix réel est consommé et le reste de la réservation est libéré ;
- non-retour à **72 heures : 30 CHF au total**.

Pour le pilote, un solde inférieur à 30 CHF ne doit pas être combiné avec une garantie Stripe partielle : le client recharge jusqu'au seuil requis ou utilise le parcours de garantie Stripe complet. Les recharges et les réservations sont des écritures serveur de ledger ; le navigateur ne peut jamais créditer ou débiter lui-même un solde.

Ces règles sont introduites sous `pricing_rules_version = 3`. Les locations v1/v2 déjà créées conservent définitivement leur `pricing_snapshot` historique et ne sont jamais recalculées avec la v3.

Les montants doivent provenir exclusivement d'un snapshot tarifaire serveur. Le navigateur et le kiosk ne sont jamais une source de vérité financière.

## Architecture actuelle

### Frontend

- Vite
- React 18
- TypeScript
- React Router
- TanStack Query
- Tailwind CSS et shadcn/ui
- PWA limitée aux routes kiosk

Routes principales :

- `/` : site public
- `/powerbank/:citySlug` : pages locales SEO
- `/partenaires` : présentation partenaires
- `/support` : assistance
- `/kiosk/:stationId` : interface de borne
- `/pay/:rentalSessionId` : suivi du paiement
- `/compte` : espace client
- `/admin` : exploitation, stations, tarifs, paiements, locations et maintenance

### Backend

- Supabase PostgreSQL
- Supabase Auth
- Supabase Edge Functions avec Deno
- Row-Level Security
- mutations privilégiées réservées au rôle serveur `service_role`

### Paiements et solde prépayé

- Stripe Checkout et PaymentIntent pour les rails Stripe ;
- cartes éligibles : autorisation puis capture finale ;
- TWINT et méthodes à capture automatique : collecte initiale puis remboursement du solde inutilisé ;
- webhooks Stripe comme preuve des événements Stripe ;
- ledger Chargeurs.ch pour les crédits prépayés, réservations, engagements et libérations ;
- `membership_prepaid` est un rail interne distinct de Stripe : aucun PaymentIntent ne doit être créé lorsqu'il gagne le first-rail-wins.

### Matériel

- API et callbacks ChargeNow ;
- aucune commande matérielle n'est autorisée directement depuis le navigateur ;
- kiosks liés à une seule station par token ;
- une autorité financière confirmée ne constitue jamais, à elle seule, une preuve d'éjection physique.

### Android

Le projet Android natif consolidé se trouve dans `android-kiosk/`. Il inclut le Gradle Wrapper, l'enrôlement à usage unique, Android Keystore, WebView restreinte, démarrage après boot, watchdog, diagnostic matériel et un pont natif qui refuse toute éjection sans autorisation JWS courte. La signature production et la certification matérielle restent des validations du propriétaire.

## Rental Orchestrator

Le Rental Orchestrator est l'autorité du cycle de location :

- machine à états stricte ;
- événements typés et idempotents ;
- snapshots versionnés ;
- journal immuable ;
- incidents opérationnels ;
- compensation ;
- réconciliation Stripe / solde prépayé / ChargeNow / état local.

Le frontend, le kiosk et les webhooks ne doivent jamais imposer directement un état final.

## État de préproduction

La PR de hardening consolide le frontend, Stripe TEST, le ledger membre, ChargeNow, l'enrôlement, les contrats et la préparation du pilote. Une CI verte valide le code du dépôt ; elle ne remplace pas une preuve physique de terrain ni une validation juridique/comptable.

Restent notamment à valider avant production commerciale :

- déploiement coordonné et validation staging des fonctions/migrations v3 ;
- tests contrôlés du rail membre prépayé sans Stripe et du fallback Express ;
- éjection/retour physique sur les bornes qualifiées ;
- identité légale, adresse et revue humaine des CGV/confidentialité ;
- qualification comptable/juridique suisse du solde prépayé ;
- plan commercial Vercel ;
- runtime Stripe LIVE séparé et explicitement approuvé ;
- sauvegarde chiffrée/offsite et procédure de restauration.

## Sécurité de bêta

Les locations kiosk doivent rester désactivées tant que le gate complet n'est pas validé :

```text
beta_rentals_enabled = false
```

Ne pas activer ce réglage avant :

- validation des migrations sur un Supabase staging distinct ;
- déploiement des Edge Functions staging ;
- tests Stripe contrôlés ;
- tests du ledger prépayé sur données de test ;
- synchronisation ChargeNow en lecture seule ;
- premier scénario matériel approuvé.

## Développement local

```bash
npm install
npm run dev
```

Validation principale :

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Des scripts supplémentaires existent pour les tests Deno, PostgreSQL, Stripe, ChargeNow, callbacks, concurrence, résilience, sécurité et Android. Voir `TESTING.md`, `package.json` et les workflows GitHub Actions.

## Environnements et secrets

Aucun secret ne doit être commité.

Les valeurs Stripe, Supabase, ChargeNow, Android signing et notifications doivent rester dans les environnements sécurisés correspondants.

Variables importantes, sans leurs valeurs :

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `PUBLIC_APP_URL`
- secrets ChargeNow requis par les fonctions partagées

ChargeNow utilise `CHARGENOW_API_BASE_URL` et, en priorité, `CHARGENOW_BASIC_AUTH`. Les mutations fournisseur sont refusées tant que `CHARGENOW_MUTATIONS_ENABLED` n'est pas explicitement activé.

Tous les domaines sont configurables ; aucun domaine temporaire n'est une hypothèse de production.

## Gouvernance

Toute modification des règles métier, de l'architecture, de l'ordre d'intégration ou du domaine actif doit être enregistrée dans `docs/PRE_PRODUCTION_CANONICAL_OVERVIEW.md` avant fusion. Les documents historiques ne doivent jamais reprendre le statut de source de vérité sans décision explicite.

## Documentation de livraison

Commencer par `docs/PRE_PRODUCTION_CANONICAL_OVERVIEW.md`, `ARCHITECTURE.md`, `DEPLOYMENT.md`, `REQUIRED_CREDENTIALS.md`, `PRODUCTION_CHECKLIST.md`, `KNOWN_LIMITATIONS.md` et `FINAL_DELIVERY_REPORT.md`. Les guides Stripe, ChargeNow, Android, provisionnement, sécurité, incidents et exploitation sont à la racine du dépôt.
