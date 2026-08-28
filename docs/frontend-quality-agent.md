# Frontend Quality Agent — Chargeurs.ch

## Objectif

Ce composant transforme la qualité frontend en boucle mesurable : **auditer → prioriser → corriger → re-tester**. Il couvre le site public, les pages de borne, le kiosk, l'authentification/compte et les états de paiement synthétiques. Il privilégie la compréhension, la confiance, la conversion légitime et la fidélisation plutôt que la décoration.

Le contrat comportemental Codex/frontend est défini dans `src/AGENTS.md`.

## Ce que l'agent mesure

Le score global est pondéré sur six axes :

- fiabilité/runtime : erreurs JavaScript, réseau, images cassées, page vide ;
- accessibilité : titre/langue, H1, labels, alt, ids, structure de titres ;
- responsive/tactile : débordements, cibles tactiles, viewport mobile/kiosk ;
- clarté : actions visibles, longueur des libellés, liens incohérents ;
- performance : temps de chargement navigateur, poids transféré, nombre de ressources ;
- confiance/commercial : visibilité des repères CHF sur les écrans commerciaux et récupération claire sur les états d'erreur.

Il contrôle aussi statiquement que les nouvelles routes client absolues restent couvertes et signale les clés EN/DE qui héritent encore du français dans le dictionnaire i18n.

Le rapport JSON conserve l'évidence brute ; le rapport Markdown fournit la file de priorités.

## Garde-fous financiers et matériels

L'agent v1 est **navigation-only**. Il ne clique sur aucune action, ne soumet aucun formulaire et n'effectue aucune mutation métier. Les routes de paiement sont ouvertes uniquement avec l'UUID synthétique `00000000-0000-0000-0000-000000000000` afin d'évaluer la qualité des erreurs/récupérations sans créer de location.

Les hôtes acceptés par défaut sont `localhost`, `127.0.0.1` et le staging Chargeurs.ch. Tout autre hôte doit être ajouté explicitement à `FRONTEND_AGENT_ALLOWED_HOSTS`. Cette barrière empêche un audit accidentel d'une production non autorisée.

## Exécution locale

```bash
npm run agent:frontend -- --base-url http://127.0.0.1:4173 --scope smoke
npm run agent:frontend -- --base-url https://chargeurs-ch-staging.vercel.app --scope full
```

Chrome/Chromium est requis. `CHROME_BIN` permet de fournir un chemin explicite.

Les rapports sont écrits dans `artifacts/frontend-quality-agent/`. `--screenshots failures` conserve une capture uniquement pour les audits contenant une anomalie blocker/high.

## Boucle de correction

1. Exécuter `smoke` avant une modification importante pour établir le point de départ.
2. Corriger un cluster cohérent de problèmes, pas une suite de pixels isolés.
3. Exécuter lint/typecheck/build existants selon le périmètre du changement.
4. Rejouer `smoke` sur les routes touchées puis `full` avant de déclarer la passe terminée.
5. Ne jamais améliorer le score en masquant une erreur, en supprimant un garde-fou, ou en affaiblissant l'authentification/l'état financier.
6. Lorsque le score monte mais que l'action principale devient moins évidente, considérer le changement comme une régression UX.

## CI

`.github/workflows/frontend-quality-agent.yml` utilise le checkout de la branche, construit l'application et l'audite localement pour les PR frontend prêtes à la revue. Il peut également être lancé manuellement contre staging. Il n'effectue aucun déploiement.

Il n'y a **aucun cron** en v1 : 0 exécution planifiée par mois. Les déclenchements automatiques sont limités aux changements frontend ciblés et à `main`, avec `concurrency/cancel-in-progress`. Les captures/rapports complets ne sont uploadés comme artifact qu'en cas d'échec afin de limiter le coût runner et le stockage.

## Évolution prévue

Après établissement d'un baseline fiable, la v2 pourra ajouter : scénarios authentifiés avec compte de test isolé, comparaison visuelle par baseline, métriques de funnel anonymisées côté produit, et un mode de remédiation Codex qui ouvre une PR limitée aux corrections frontend à faible risque. Les opérations argent/hardware/production resteront hors autonomie.
