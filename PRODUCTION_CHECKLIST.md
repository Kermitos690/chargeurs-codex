# Checklist de production

Toutes les cases sont bloquantes sauf mention explicite.

## Juridique et accès

- [ ] Raison sociale, IDE/TVA, adresse, CGV et confidentialité validées.
- [ ] Comptes nominatifs, MFA et propriétaires de secours configurés.
- [ ] `REQUIRED_CREDENTIALS.md` complété sans secret dans Git.

## Plateforme

- [ ] Projets Supabase staging/production distincts, sauvegarde/restauration testée.
- [ ] Migrations et RLS validées sur une installation neuve et une mise à niveau.
- [ ] Frontend, Edge Functions, API/OpenAPI et domaine/DNS déployés.
- [ ] Origines CORS, quotas, alertes et rétention des logs vérifiés.

## Stripe

- [ ] Compte live vérifié, banque et moyens de paiement activés.
- [ ] Checkout test et webhook signé complets ; aucun redirect ne déclenche d'éjection.
- [ ] Capture/remboursement/expiration/doublon/asynchrone testés.
- [ ] Live activé seulement après validation manuelle.

## ChargeNow et borne

- [ ] Contrat API/protocole/slots confirmé par le fournisseur.
- [ ] Auth, statut, commande, callback, retour et réconciliation testés en staging.
- [ ] Échec après paiement ouvre incident et remboursement.
- [ ] Une borne pilote a réussi le cycle complet avec preuve physique.

## Android

- [ ] Keystore de production sauvegardé hors dépôt et accès documenté.
- [ ] APK/AAB release signés, empreinte publiée, rollback disponible.
- [ ] Device Owner/lock-task, boot, réseau, watchdog et révocation validés.
- [ ] Adaptateur matériel réel qualifié ; `NOT_CONFIGURED` interdit l'ouverture publique.

## Go live

- [ ] Revue sécurité et test de restauration terminés.
- [ ] Support et astreinte opérationnels.
- [ ] Bêta activée borne par borne, mutations ChargeNow puis Stripe live.
- [ ] Surveillance renforcée pendant le premier cycle d'exploitation.
