# Protocole de handoff

Utiliser cette charge utile compacte uniquement lorsqu’un travail traverse une
frontière de responsabilité. Un handoff n’est pas un long brief projet et ne
transfère aucune autorité hors de son périmètre déclaré.

```text
TASK_ID:
TITLE:
FROM:
TO:
DOMAIN:
PRIORITY:
WHY_HANDOFF:
CURRENT_STATE:
EVIDENCE:
IN_SCOPE:
OUT_OF_SCOPE:
FILES_OR_SURFACES:
DEPENDENCIES:
PROTECTED_CORE: YES | NO
PHYSICAL_VALIDATION: required | not_required | completed
COST_IMPACT: none | COST_APPROVAL_REQUIRED
ACCEPTANCE_CRITERIA:
NEXT_ACTION:
```

Règles :

- Lier les preuves par issue, PR, SHA, sortie de test, identité de release ou observation physique consignée ; ne pas les remplacer par une affirmation.
- Déclarer `PROTECTED_CORE: YES` avant toute modification d’implémentation protégée.
- Le destinataire accepte, refuse ou retourne le handoff comme incomplet. Il ne peut pas élargir silencieusement le périmètre.
- Une validation échouée retourne un nouveau handoff au propriétaire du domaine avec le gate exact échoué et les preuves.
