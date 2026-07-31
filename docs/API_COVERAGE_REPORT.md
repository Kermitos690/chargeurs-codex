# Intégrations et couverture API

## Règle de preuve

Le centre d'administration **Intégrations et couverture API** lit la table
`api_coverage`. Un statut d'interface ne constitue pas une preuve de connexion
fournisseur. Les statuts utilisés sont ceux définis pour Chargeurs.ch ; une
opération n'est `FUNCTIONAL_AND_TESTED` qu'après une preuve automatisée ou une
réponse staging contrôlée.

## ChargeNow — état staging au 31 juillet 2026

| Opération | Endpoint externe | Mode | Statut | Preuve / action restante |
|---|---|---|---|---|
| Synchroniser une borne | `GET /rent/cabinet/query?deviceId=…` | lecture | `PROVIDER_CONNECTED_READ_ONLY` | Client, erreurs HTTP/code métier et parsing couverts par 175 tests Deno ; exécution avec des identifiants réels reste une action admin contrôlée. |
| Éjection, verrouillage, redémarrage, firmware | non exécuté | mutation | `PROVIDER_MUTATION_DISABLED` | Architecture et tests de simulation présents ; flag de mutation maintenu à `false`. |
| Autres routes observées/documentées | non activé | lecture/mutation | `PROVIDER_ENDPOINT_MISSING` | Écran, modèle interne et codes de couverture conservés ; aucun appel fournisseur tant qu'un contrat officiel n'est pas confirmé. |
| Stripe Checkout QR | Stripe test | paiement | `EXTERNAL_CONFIGURATION_REQUIRED` | Aucun secret Stripe test confirmé dans ce run ; aucun paiement déclenché. |
| Kiosk Android | `kiosk-enroll` | provisioning | `STAGING_TEST_REQUIRED` | Fonctions version 13, migration additive et APK debug vérifié ; activation réelle attend une tablette et un code fraîchement créé. |

## Garde-fous actifs

- Seul l'hôte configuré par `CHARGENOW_API_BASE_URL` est appelé.
- Seule la lecture O1 est autorisée par la gateway staging.
- Toute opération différente échoue explicitement avec
  `PROVIDER_ENDPOINT_MISSING` ou `PROVIDER_MUTATION_DISABLED`.
- Les valeurs d'autorisation, tokens et réponses brutes ne sont jamais
  retournés au navigateur ; les journaux serveur utilisent la redaction.
