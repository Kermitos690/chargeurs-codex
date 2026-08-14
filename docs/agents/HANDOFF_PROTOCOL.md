# Handoff Protocol

Use this compact payload only when work must cross ownership boundaries. A
handoff is not a long project brief and does not transfer authority outside its
stated scope.

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

Rules:

- Link evidence by issue, PR, SHA, test output, release identity, or recorded
  physical observation; do not replace it with an assertion.
- State `PROTECTED_CORE: YES` before any protected implementation change.
- A recipient accepts, rejects, or returns the handoff as incomplete. It may not
  silently broaden scope.
- A failed validation returns a new handoff to the domain owner with the exact
  failed gate and evidence.
