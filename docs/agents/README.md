# Système d’exploitation des agents Chargeurs V2

Statut : `CANONICAL GOVERNANCE PROPOSAL — DRAFT PR REQUIRED`

Ce répertoire documente les propriétaires logiques de responsabilités de
Chargeurs.ch. Un rôle d’agent est un contrat de propriété et de handoff ; il ne
lance **pas** un sous-agent Codex, ne crée pas de dépendance payante et
n’autorise pas une action à lui seul.

## À lire dans cet ordre

1. [Registre actuel des agents](CURRENT_AGENT_REGISTRY.md) — rôles vérifiés et recommandation de lancement.
2. [Matrice de responsabilités](OWNERSHIP_MATRIX.md) — exactement un propriétaire principal par capacité critique.
3. [Modèle opérationnel](OPERATING_MODEL.md) — dispatch, QA, release, vérité physique, sources de vérité et politique de sous-agents.
4. [Protected Core](PROTECTED_CORE.md) — frontières protégées et gates de changement.
5. [Protocole de handoff](HANDOFF_PROTOCOL.md) — charge utile minimale entre propriétaires.
6. [Rapport de migration](MIGRATION_REPORT.md) — preuves, collisions et travail exclu de ce changement.

## Principes directeurs

```text
HUMAN DECIDES BUSINESS
GOVERNANCE CONTROLS OWNERSHIP
ONE OWNER EXECUTES
SPECIALISTS COLLABORATE ONLY WHEN NEEDED
EVIDENCE VALIDATES
RELEASE CONTROLS PRODUCTION
PHYSICAL REALITY OVERRIDES ASSUMPTION
GROWTH SELLS ONLY VERIFIED CAPABILITY
```

Aucun document ici ne remplace une décision métier humaine explicite ni les
règles existantes attentives aux coûts du `AGENTS.md` racine.
