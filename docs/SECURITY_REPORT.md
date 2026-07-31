# Sécurité — exécution master

## Corrections appliquées

| Risque | Correction | Preuve | État |
|---|---|---|---|
| Appairage alphanumérique impraticable sur borne | Code strict à six chiffres avec zéro initial préservé | tests Deno et Android source | corrigé localement et staging |
| Réutilisation d'un code | Hash, expiration, liaison station/organisation, consumption atomique et renouvellement invalidant | migration + fonctions Edge | déployé staging |
| Brute force de code court | Limites sur appareil, station et origine hachée ; pause progressive ; aucun code brut journalisé | migration + test de contrat | déployé staging |
| Coût CI Android automatique | workflow diagnostic devenu manuel | workflow GitHub | corrigé |

## Risques résiduels

- La base staging a une dérive d'historique de migrations. Elle bloque un
  `db push` reproductible ; aucune réparation d'historique n'a été faite à
  l'aveugle.
- Deux avis npm React Router de sévérité modérée restent documentés. La seule
  mise à jour proposée par l'audit a été refusée car elle introduisait deux
  avis de sévérité élevée. Une migration compatible doit être étudiée avant
  production.
- L'APK ne peut pas encore être construit localement faute de licence SDK
  Android acceptée. Aucune assertion sur son comportement runtime n'est faite.
- Aucun test matériel ni fournisseur mutatif n'a été exécuté ; les flags restent
  fermés (`CHARGENOW_MUTATIONS_ENABLED=false`, Stripe live désactivé, éjection
  matérielle désactivée).
