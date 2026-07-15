# Chargeurs.ch

Chargeurs.ch est une plateforme de location de batteries externes / powerbanks destinée aux bars, restaurants, hôtels, clubs, commerces et événements en Suisse romande.

Le dépôt contient l'application web publique, les écrans kiosk, l'espace client, l'administration, le moteur tarifaire, le Rental Orchestrator et les fonctions Supabase utilisées pour Stripe et ChargeNow.

> Source opérationnelle canonique : `docs/PROJECT_BIBLE.md`.

## Parcours produit cible

1. Le client voit une borne Chargeurs.ch.
2. Il scanne le QR code affiché par le kiosk.
3. Stripe autorise ou collecte la base initiale de 30 CHF selon le moyen de paiement.
4. Le backend confirme le paiement puis demande l'éjection d'une batterie précise à ChargeNow.
5. La location devient active après confirmation matérielle.
6. Le retour physique est corrélé à la batterie et au slot.
7. Le moteur calcule le montant final et effectue la capture, l'annulation ou le remboursement approprié.
8. En cas de non-retour confirmé, le total prévu est de 99 CHF.

## Règles tarifaires canoniques

- Base initiale : 30 CHF
- Prix : 1,50 CHF par heure
- Incrément : 30 minutes, soit 0,75 CHF
- Plafond journalier : 18 CHF
- Non-retour : 99 CHF au total
- Supplément potentiel après les 30 CHF initiaux : 69 CHF

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

### Paiements

- Stripe Checkout et PaymentIntent
- cartes : autorisation puis capture finale lorsque la méthode est éligible
- TWINT et méthodes à capture automatique : collecte initiale puis remboursement du solde inutilisé
- webhooks Stripe comme preuve du paiement

### Matériel

- API et callbacks ChargeNow
- aucune commande matérielle n'est autorisée directement depuis le navigateur
- kiosks liés à une seule station par token

### Android

Le wrapper Android natif est développé dans la PR dédiée, mais n'est pas encore fusionné, signé pour la production ni certifié sur le matériel réel.

## Rental Orchestrator

Le Rental Orchestrator est destiné à devenir l'autorité unique du cycle de location :

- machine à états stricte ;
- événements typés et idempotents ;
- snapshots versionnés ;
- journal immuable ;
- incidents opérationnels ;
- compensation ;
- réconciliation Stripe / ChargeNow / état local.

Le frontend, le kiosk et les webhooks ne doivent jamais imposer directement un état final.

## État réel du projet

### Fusionné dans `main`

- refonte publique V2, SEO local, tarifs et support ;
- machine à états et réconciliation du Rental Orchestrator ;
- couche transactionnelle Supabase du Rental Orchestrator ;
- Project Bible canonique ;
- routage profond Lovable et service worker kiosk-only ;
- sécurité d'activation kiosk, diagnostic ChargeNow et verrou de bêta fermé par défaut.

### Développé mais pas encore fusionné

- moteur de règlement Stripe complet ;
- Platform API ;
- wrapper Android kiosk.

### Non encore prouvé sur staging et matériel

- application de toutes les migrations récentes ;
- autorisation et capture partielle Stripe test ;
- remboursement partiel TWINT ;
- éjection et retour ChargeNow corrélés ;
- cycle complet sur DTA21269 ;
- APK installé et testé sur la tablette réelle.

Une CI verte valide la qualité du code du dépôt. Elle ne prouve pas une connexion réelle à Stripe, Supabase ou ChargeNow.

## Sécurité de bêta

Les locations kiosk doivent rester désactivées tant que le gate complet n'est pas validé :

```text
beta_rentals_enabled = false
```

Ne pas activer ce réglage avant :

- validation des migrations sur un Supabase staging distinct ;
- déploiement des Edge Functions staging ;
- tests Stripe contrôlés ;
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

Des scripts supplémentaires existent pour les tests Deno, PostgreSQL, Stripe, ChargeNow, callbacks, concurrence, résilience et sécurité. Voir `package.json` et les workflows GitHub Actions.

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

Le domaine de test temporaire est actuellement :

```text
https://chargeurs-codex.lovable.app
```

Il doit rester configurable et ne pas être utilisé comme hypothèse définitive de production.

## Gouvernance

Toute modification des règles métier, de l'architecture, de l'ordre d'intégration ou du domaine actif doit être enregistrée dans `docs/PROJECT_BIBLE.md` avant fusion.
