# Registre actuel des agents

Base d’audit : `main@703decf67504a466ac63b19e9933fc512e134ef3`, 2026-08-14.
Les preuves incluent le programme maître ouvert [#114], l’architecture cible
[#151] et les issues/PR actives associées. C’est un registre de rôles, pas une
liste de processus Codex en cours d’exécution.

| ID | Mission actuelle et domaine principal | Références vérifiées | Surface d’écriture / limite | Statut | Recommandation |
| --- | --- | --- | --- | --- | --- |
| A0 | WIP multi-agent, dépendances, collisions, dispatch et handoffs | [#114], [#151] | Tableaux de gouvernance et handoffs ; pas d’implémentation fonctionnelle par défaut | `ACTIVE_CORE` | `KEEP` |
| A1 | Architecture produit, contrats inter-domaines et architecture Protected Core | [#119], [#150], [#151], [#169] | Documents d’architecture/gouvernance ; pas d’UI, paiement, location ou hardware | `ACTIVE_CORE` | `KEEP` |
| A2 | Backend, pricing, paiement et contrats Stripe | [#114], [#151], [#168] | Contrats et tests pricing/paiement côté serveur ; pas présentation Kiosk ni comportement fournisseur | `ACTIVE_CORE` | `KEEP` |
| A3 | Bug Hunter : RCA, première divergence et corrections minimales de sécurité | [#55], [#85], [#92], [#102], [#111] | Incident/RCA et surface corrective transmise ; pas de redesign opportuniste | `ACTIVE_CORE` | `KEEP` |
| A4 | UX Kiosk, interaction, navigation et présentation | [#105], [#150], `docs/agent4-kiosk-auth-failsafe-plan.md` | Présentation Kiosk et tests UX ; jamais la vérité pricing, paiement, location ou hardware | `ACTIVE_CORE` | `KEEP` |
| A5 | Runtime Advertising, campagnes, médias et playlists | [#151] | Runtime et outils Ads ; ne peut pas bloquer une location | `ACTIVE_ON_DEMAND` | `KEEP_ON_DEMAND` |
| A6 | Technologie créative, primitives 3D et motion | [#82], [#151], [#170] | Primitives visuelles de présentation ; ni navigation, ni paiement, ni hardware, ni sémantique de succès | `SPECIALIST_ON_DEMAND` | `KEEP_ON_DEMAND` |
| A7 | Inventory, supply chain et vérité des assets matériels | [#108], [#151] | Faits fournisseur, assets sérialisés, Inventory/admin Inventory ; pas transitions de location ni commandes d’éjection | `ACTIVE_ON_DEMAND` | `KEEP_ON_DEMAND` |
| A8 | Intégration, identité de release et validation physique | [#110], [#151], [#171] | Manifeste de release, preuves d’intégration et QA physique ; pas de développement fonctionnel par défaut | `ACTIVE_CORE` | `KEEP` |
| A9 | Growth et partenariats | [#151] | Pipeline commercial et propositions à capacité vérifiée ; ne peut fixer prix, capacité ou readiness | `ACTIVE_ON_DEMAND` | `KEEP_ON_DEMAND` |

[#55]: https://github.com/Kermitos690/chargeurs-codex/issues/55
[#82]: https://github.com/Kermitos690/chargeurs-codex/issues/82
[#85]: https://github.com/Kermitos690/chargeurs-codex/issues/85
[#92]: https://github.com/Kermitos690/chargeurs-codex/issues/92
[#102]: https://github.com/Kermitos690/chargeurs-codex/issues/102
[#105]: https://github.com/Kermitos690/chargeurs-codex/issues/105
[#108]: https://github.com/Kermitos690/chargeurs-codex/issues/108
[#110]: https://github.com/Kermitos690/chargeurs-codex/issues/110
[#111]: https://github.com/Kermitos690/chargeurs-codex/issues/111
[#114]: https://github.com/Kermitos690/chargeurs-codex/issues/114
[#119]: https://github.com/Kermitos690/chargeurs-codex/issues/119
[#150]: https://github.com/Kermitos690/chargeurs-codex/pull/150
[#151]: https://github.com/Kermitos690/chargeurs-codex/pull/151
[#168]: https://github.com/Kermitos690/chargeurs-codex/pull/168
[#169]: https://github.com/Kermitos690/chargeurs-codex/pull/169
[#170]: https://github.com/Kermitos690/chargeurs-codex/pull/170
[#171]: https://github.com/Kermitos690/chargeurs-codex/issues/171

## Cibles de handoff et de validation

| Depuis | Cibles habituelles de handoff | Rôle de validation |
| --- | --- | --- |
| A0 | tout propriétaire ; A1 pour conflit de contrat ; A8 pour release | Acceptation WIP/collision |
| A1 | A0, A2, A4, A7, A8 selon contrat | Acceptation de contrat inter-domaines |
| A2 | A3 pour RCA, A4 pour projection, A8 pour intégration | Tests domaine et preuves Protected Core |
| A3 | propriétaire réel du domaine ; A8 pour preuve de release | Preuve RCA et périmètre de correction minimale |
| A4 | A2/A3 pour divergence de vérité ; A5/A6 pour support de présentation ; A8 pour QA terrain | Acceptation présentation Kiosk |
| A5 | A4 pour contrat de surface Kiosk ; A8 si lié à une release | Preuve d’isolation Ads |
| A6 | A4 pour intégration ; A8 pour preuve physique/performance | Dégradation visuelle et preuve de performance |
| A7 | A2/A3 pour preuve runtime ; A8 pour readiness terrain ; A9 pour capacité | Preuve asset/fournisseur |
| A8 | A0 pour décision de release ; propriétaire réel pour gate échoué | Preuve intégration et physique |
| A9 | A7 capacité ; A1/A2 contrat produit ; A8 readiness ; humain pour conditions/prix | Vérification de capacité réelle |

## Non-décisions explicites

- Ce document ne renumérote aucun agent.
- A6 reste un spécialiste à la demande ; ce n’est pas une lane continuellement active et critique au lancement.
- A9 reste à la demande. Son empreinte d’implémentation active doit être revérifiée avant tout grand chantier Growth.
- Aucun nouvel agent QA dédié n’est créé. Le contrat QA est indépendant et utilise A8 comme gate release/physique.
