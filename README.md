# Chargeurs.ch

Chargeurs.ch est une plateforme de location de batteries externes / powerbanks destinée aux bars, restaurants, hôtels, clubs, commerces et événements en Suisse romande.

Le dépôt contient l'application web publique, les écrans kiosk, l'espace client, l'administration, le moteur tarifaire, le Rental Orchestrator, les sources Supabase et l'application Android.

> Commencer par `docs/SYSTEM_OF_RECORD.md`. Il distingue la vérité du source,
> la vérité du runtime, la vérité terrain, la cible et les inconnues. L'ancienne
> `docs/PROJECT_BIBLE.md` est un document historique et contient des hypothèses
> Lovable, pricing et architecture qui ne décrivent plus intégralement le
> runtime.

## Current Architecture Decision — 2026-08-29

| Domaine | Décision actuelle |
|---|---|
| Repository | `Kermitos690/chargeurs-codex` |
| Mainline | `main` |
| Baseline d'audit | `410dac320278b32f66cab08a801fda8edd46d784` |
| Frontend staging | Vercel, sous réserve de réconciliation du propriétaire et de la provenance du déploiement |
| Backend staging | Supabase `xqepbqnaenoeyfjkjnzl` |
| Paiements staging | Stripe TEST uniquement |
| Cloudflare | Expérience parallèle, non canonique et non utilisée par la flotte |
| Android | Aucune APK staging canonique |
| Production | `NOT CONFIGURED` / `NO-GO` |

`main` est la direction canonique du source, mais ne représente pas encore
parfaitement le staging déployé. Aucun déploiement production ni aucune migration
de borne vers Cloudflare n'est autorisé.

## Parcours produit cible

Cette section décrit `TARGET_ARCHITECTURE`, pas la preuve d'un parcours
actuellement validé de bout en bout.

1. Le client voit une borne Chargeurs.ch.
2. Il scanne le QR code affiché par le kiosk.
3. Stripe autorise ou collecte le montant déterminé par le snapshot tarifaire serveur selon le moyen de paiement.
4. Le backend confirme le paiement puis demande l'éjection d'une batterie précise à ChargeNow.
5. La location devient active après confirmation matérielle.
6. Le retour physique est corrélé à la batterie et au slot.
7. Le moteur calcule le montant final et effectue la capture, l'annulation ou le remboursement approprié.
8. En cas de non-retour confirmé, le backend applique le contrat versionné du snapshot de la location.

## Vérité tarifaire

Les valeurs tarifaires historiques inscrites dans d'anciens documents ne sont
pas l'autorité du pricing actuel. Pour une nouvelle location, la vérité runtime
est le profil tarifaire actif et versionné dans la base de l'environnement. Pour
une location existante, l'autorité est son snapshot tarifaire immuable.

Le navigateur, le kiosk et une redirection Stripe `success_url` ne sont jamais
une source de vérité financière. La preuve de paiement repose sur l'objet Stripe
et un webhook Stripe vérifié et traité côté serveur.

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

Le backend staging canonique actuel est le projet
`xqepbqnaenoeyfjkjnzl` (`chargeurs-ch-staging`). Il contient davantage de
migrations et de fonctions actives que `main`; voir
`docs/MIGRATION_RECONCILIATION.md` et
`docs/SUPABASE_FUNCTION_INVENTORY.md`.

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

Le projet Android natif se trouve dans `android-kiosk/`. Il inclut le Gradle
Wrapper, l'enrôlement à usage unique, Android Keystore, WebView restreinte,
démarrage après boot, watchdog, diagnostic matériel et garde-fous de pont natif.

Il n'existe pas encore une seule ligne Android staging canonique. DTA21269,
DTA21277 et DTA22032 rapportent trois libellés de version différents, et le
package, `versionCode`, signer, APK SHA et commit source installés ne sont pas
tous prouvés. Voir `docs/STATION_RUNTIME_MATRIX.md`.

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

- Vercel sert actuellement le frontend des trois bornes connues.
- Cloudflare Pages sert un build parallèle différent, sans borne autorisée.
- Supabase staging contient 257 entrées de migration et 100 Edge Functions
  actives, contre 151 fichiers de migration et 59 répertoires de fonctions dans
  `main`.
- Stripe TEST est le seul mode de paiement autorisé.
- Aucune architecture production complète n'est prouvée.
- Aucune APK staging canonique n'est désignée.

Une CI verte validerait uniquement les étapes réellement exécutées. Un run avec
`runner_id=0` et `steps=[]` n'est pas un échec de tests : aucun runner n'a lancé
les commandes. Même une CI réellement verte ne prouve pas une connexion Stripe,
Supabase ou ChargeNow ni un résultat matériel.

## Sécurité de bêta

L'activation effective des locations et mutations reste une vérité runtime et
doit être vérifiée sans publier la valeur des secrets. Aucun gate ne doit être
activé avant :

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

Toute modification des règles métier, de l'architecture, de l'ordre
d'intégration ou du domaine actif doit actualiser
`docs/SYSTEM_OF_RECORD.md` et la matrice concernée avant fusion. Les anciennes
décisions de `docs/PROJECT_BIBLE.md` doivent être citées comme `HISTORICAL`, pas
comme runtime actuel.

## DO NOT

- aucun `supabase db push` aveugle ;
- aucune suppression massive d'Edge Functions ;
- aucune réécriture de timestamps de migration contre staging ;
- aucune bascule de flotte vers Cloudflare ;
- aucune fusion monolithique de #338 ;
- aucune fusion de #341 ;
- aucun choix d'APK fondé uniquement sur le numéro de version ;
- aucun usage Stripe LIVE ;
- aucune mutation hardware depuis un endpoint diagnostic ou public de secours.

## Documentation de livraison

Commencer par :

1. `docs/SYSTEM_OF_RECORD.md`
2. `docs/DEPLOYMENT_MATRIX.md`
3. `docs/STATION_RUNTIME_MATRIX.md`
4. `docs/SUPABASE_FUNCTION_INVENTORY.md`
5. `docs/MIGRATION_RECONCILIATION.md`
6. `docs/PR_CONVERGENCE_REGISTER.md`
7. `docs/RELEASE_RUNBOOK.md`
8. `ARCHITECTURE.md`

`DEPLOYMENT.md`, `REQUIRED_CREDENTIALS.md`, `PRODUCTION_CHECKLIST.md`,
`KNOWN_LIMITATIONS.md`, `FINAL_DELIVERY_REPORT.md` et les guides historiques
restent des références à confronter au présent registre avant utilisation.
