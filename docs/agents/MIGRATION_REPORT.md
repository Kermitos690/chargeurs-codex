# Rapport de migration — Système d’exploitation des agents V2

## Périmètre et preuves d’audit

Audit en lecture seule, 2026-08-14. Base :
`main@703decf67504a466ac63b19e9933fc512e134ef3`. Ont été inspectés : le
`AGENTS.md` racine, les documents Kiosk/gouvernance pertinents, les issues et
PR GitHub actives, ainsi que la topologie actuelle des PR.

Aucun code produit, pricing, intégration Stripe, base de données, APK, hardware,
déploiement, migration, merge de PR, ni suppression d’ancien document n’a été
effectué.

## Constats

| Classification | Constat | Décision |
| --- | --- | --- |
| `CANONICAL_CANDIDATE` | La PR [#151] définit la cible Owner Map et Protected Core | absorber ses principes ici ; ne pas la merger automatiquement |
| `CANONICAL_CANDIDATE` | La PR [#150] définit la Kiosk Target Architecture V4 | conserver comme entrée d’architecture ; l’implémentation reste propriété A4 |
| `CONFLICTING` | Chemins return/settlement et sécurité hardware se chevauchant, dont [#81] et [#136] | un seul chemin propriétaire ; aucun merge additif sans gates A1/A2/A8 |
| `CONFLICTING` | Terminal couvre architecture [#169], Android [#167], backend [#168] et présentation | contrat A1 d’abord ; A8 a bloqué l’intégration TEST à ce stade |
| `STALE_OR_UNMERGED` | Les architectures sont dans des PR ouvertes, pas dans la vérité `main` | cette proposition centralise les règles sans prétendre que ces PR sont mergées |
| `LEGACY_REQUIRED` | Générations de présentation Kiosk superposées | A4 retire progressivement ; pas de nouveau propriétaire UI parallèle |
| `MISSING_GATE` | Pas de contrat QA canonique compact dans la gouvernance racine | résolu par le modèle opérationnel ; A8 possède le gate intégration/physique |
| `MISSING_OWNER` | L’owner UI public web/admin global reste non assigné dans [#151] | rester non assigné jusqu’à ce que A0 choisisse un owner réel au démarrage |
| `COST_RISK` | Prendre chaque rôle A0–A9 pour un sous-agent en cours | résolu par politique single-agent-first explicite |

[#81]: https://github.com/Kermitos690/chargeurs-codex/pull/81
[#136]: https://github.com/Kermitos690/chargeurs-codex/pull/136
[#150]: https://github.com/Kermitos690/chargeurs-codex/pull/150
[#151]: https://github.com/Kermitos690/chargeurs-codex/pull/151
[#167]: https://github.com/Kermitos690/chargeurs-codex/pull/167
[#168]: https://github.com/Kermitos690/chargeurs-codex/pull/168
[#169]: https://github.com/Kermitos690/chargeurs-codex/pull/169

## Décision de migration de rôles

`AGENT_ROLE_MIGRATION_REQUIRED` n’est **pas** déclenché. Le roster vérifié est
cohérent avec A2 en backend/pricing/paiement et A6 en motion/3D. Réaffecter l’un
ou l’autre selon un modèle QA/Core Platform théorique contredirait les preuves du
programme actif ; ce n’est donc pas appliqué.

## Prochaine action de gouvernance recommandée

Relire cette Draft PR avec #150 et #151. Si elle est acceptée, traiter ce
répertoire comme routeur de gouvernance concis et marquer les futurs documents
remplacés par `SUPERSEDED_BY` plutôt que les supprimer. Les collisions produit
réelles restent à résoudre dans leurs PR de domaine ; ce changement de
gouvernance ne les merge ni ne les réécrit.
