# Règles de développement attentives aux coûts

Ces règles sont obligatoires pour tout agent et contributeur de ce dépôt.

## Système d’exploitation des agents

Ce fichier est la constitution compacte et le routeur du système d’exploitation
des agents Chargeurs. Les documents de fonctionnement canoniques sont dans
[`docs/agents/`](docs/agents/README.md).

- Un **agent** est un propriétaire logique de domaine. Ce n’est pas un processus
  Codex permanent et cela n’implique pas une exécution de modèle séparée.
- Par défaut : **un agent principal et un seul rédacteur par surface
  d’implémentation**. Un sous-agent n’est justifié que pour une tâche bornée,
  indépendante et dont le bénéfice est documenté.
- Chaque capacité importante a un seul propriétaire principal. Un contributeur
  peut aider, mais ne devient pas propriétaire simplement parce qu’il touche un fichier.
- Un propriétaire transmet le travail entre domaines via le contrat compact
  [`HANDOFF_PROTOCOL.md`](docs/agents/HANDOFF_PROTOCOL.md).
- Toute modification du Protected Core doit être marquée `PROTECTED_CORE_CHANGE`
  et respecter les gates de [`PROTECTED_CORE.md`](docs/agents/PROTECTED_CORE.md).
  Les surfaces UI, Ads, Growth et Inventory ne peuvent pas affaiblir un invariant
  de sécurité côté serveur.
- `MERGED`, `DEPLOYED`, `APK_INSTALLED` et `PHYSICALLY_VALIDATED` sont des états
  distincts. Seul le gate de release peut déclarer `READY_FOR_RELEASE`.
- Les décisions métier (prix, caution, plafonds, remboursements, conditions,
  promesses commerciales ou modèle économique) exigent une validation humaine
  explicite : `BUSINESS_DECISION_REQUIRED`.
- Aucun nouveau service IA payant, plateforme multi-agent, monitoring SaaS,
  base vectorielle, service cloud ou tâche LLM récurrente ne peut être ajouté sans
  `COST_APPROVAL_REQUIRED`.

Pour le roster actuel, les responsabilités, le modèle QA/release et les constats
de migration, lire les documents ci-dessus avant tout changement de gouvernance
ou travail inter-domaines.

## Workflow par défaut

- Commencer tout travail de fonctionnalité dans une **pull request en brouillon**.
- Regrouper les changements liés localement avant de pousser ; ne pas créer de commits vides, `WIP`, `Changes` ou uniquement destinés à déclencher un workflow.
- Ne jamais ajouter de déclencheur automatique sur `push` pour les branches feature, `agent/**` ou d’intégration.
- La CI de pull request doit ignorer les brouillons et s’exécuter quand la PR est prête, lancée manuellement ou fusionnée dans `main`.
- Utiliser `paths` ou `paths-ignore` pour que code, documentation, Android, Wallet, base de données et frontend non liés ne déclenchent pas leurs workflows respectifs.
- Tout workflow automatique doit utiliser `concurrency` avec `cancel-in-progress: true`.

## Conception de la CI

- Exécuter les contrôles rapides et peu coûteux avant les contrôles coûteux.
- Ne pas utiliser `continue-on-error` pour les lint, typecheck, tests ou builds requis.
- Préférer un seul job séquentiel, sauf si le parallélisme apporte un bénéfice documenté supérieur à son coût runner.
- Utiliser les caches de dépendances et des installations déterministes telles que `npm ci --no-audit --no-fund --prefer-offline`.
- N’envoyer des artefacts qu’en cas d’échec, les conserver peu de temps et ne jamais archiver les logs de routine avec `if: always()`.
- Les tests E2E navigateur, builds Android, previews, migrations et opérations de production doivent être ciblés et exécutés seulement si pertinents.
- Les déploiements staging/production et migrations restent manuels avec confirmation explicite.

## Automatisations planifiées et ponctuelles

- Préférer le système cron/jobs de la plateforme applicative aux runners GitHub s’il offre le même service.
- Avant d’ajouter un workflow GitHub planifié, documenter son nombre d’exécutions mensuelles attendu et choisir la fréquence utile la plus basse.
- Ne pas créer de workflow auto-modifiant ou ponctuel qui commit et pousse du code. Utiliser un script revu ou un workflow manuel, puis le supprimer dans le même changement revu.

## Contrôle des changements

- Ne pas ajouter ou élargir un déclencheur GitHub Actions sans expliquer son impact mensuel sur les coûts dans la PR.
- Réutiliser les workflows existants plutôt que créer des workflows qui se chevauchent pour les mêmes fichiers.
- Fermer les pull requests remplacées et neutraliser les workflows de branches obsolètes.
- Relancer uniquement les jobs en échec ; ne pas redémarrer un pipeline déjà réussi.
