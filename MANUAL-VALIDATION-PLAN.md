# MANUAL-VALIDATION-PLAN.md

Validations qui ne peuvent **pas** être automatisées (matériel réel, authentification
humaine, paiement réel, callback fournisseur réel, configuration externe).
Aucune n'a été exécutée pendant la mission automatisée.

Légende gravité : **CRITIQUE** (bloque la prod) · **MAJEURE** · **MINEURE**.

---

## A. Tests des rôles avec sessions humaines
**ID A1 — Accès back-office par rôle**
- Objectif : vérifier que viewer/staff/operator voient l'UI mais ne peuvent pas écrire ; admin/super_admin peuvent écrire.
- Préconditions : un compte réel par rôle dans `user_roles`.
- Étapes : se connecter avec chaque compte → tenter une action d'écriture (ex. reconcile, refund) → observer 403 côté serveur pour les rôles non-write.
- Résultat attendu : écritures refusées côté serveur (pas seulement masquées) pour viewer/staff/operator.
- Preuve : capture réseau du 403 + entrée `audit_logs`.
- Tables/logs : `user_roles`, `audit_logs`, logs edge `rental-admin-action`.
- Critère d'acceptation : aucun rôle non-write ne réussit une écriture.
- Rollback : aucun (lecture/refus). Gravité : **CRITIQUE**.

## B. Tests Stripe réels
**ID B1 — Checkout réel en mode test puis live**
- Objectif : Checkout Session créée, QR affiché, paiement réel abouti, webhook signé reçu.
- Préconditions : clés Stripe configurées, webhook pointant sur `stripe-webhook`.
- Étapes : lancer une location kiosk → payer avec une vraie carte (mode test d'abord) → vérifier passage `payment_succeeded`.
- Preuve : `payments` row, `webhook_events` row, dashboard Stripe.
- Critère : montant Stripe = `pricing_snapshot.final_cents`. Gravité : **CRITIQUE**.

## C. Apple Pay — **BLOQUÉ PAR CONFIGURATION EXTERNE**
- Nécessite domaine vérifié Apple Pay dans Stripe + appareil Apple réel. Vérifier l'affichage du bouton et un paiement réel.

## D. Google Pay — **BLOQUÉ PAR CONFIGURATION EXTERNE**
- Nécessite environnement compatible + appareil réel. Vérifier bouton et paiement réel.

## E. TWINT — **BLOQUÉ PAR CONFIGURATION EXTERNE**
- Activer TWINT dans Stripe (compte CH) ; tester un paiement réel TWINT.

## F. Provisioning tablette
**ID F1** — Provisionner une tablette via `kiosk-admin` (création token), stocker le token, ouvrir `/kiosk/:stationId`, vérifier que le devis s'affiche. Preuve : `kiosk_devices.last_seen_at` mis à jour. Gravité : **MAJEURE**.

## G. Rotation et révocation sur tablette
**ID G1** — Roter le token (admin) → l'ancien token doit échouer immédiatement (`KIOSK_AUTH_INVALID`). Révoquer → échec immédiat. Preuve : réponse RPC `kiosk_quote`. Gravité : **CRITIQUE**.

## H. Borne ChargeNow réelle — **RÉSERVÉ À LA PHASE MANUELLE (MATÉRIEL)**
- Vérifier statut station, slots, batterie disponible via la vraie API sur une borne physique.

## I. Éjection physique — **RÉSERVÉ À LA PHASE MANUELLE (MATÉRIEL)**
- Après webhook payé, déclencher `eject-after-payment`, observer l'éjection physique et le callback réel.

## J. Retour physique — **RÉSERVÉ À LA PHASE MANUELLE (MATÉRIEL)**
- Rendre la batterie ; vérifier `BATTERY_IN` réel → `battery_returned`.

## K. Retour dans une autre station — **RÉSERVÉ À LA PHASE MANUELLE (MATÉRIEL)**
- Rendre dans une station différente si autorisé ; vérifier corrélation `trade_no`.

## L. Remboursement réel
**ID L1** — Déclencher un remboursement réel (`rental-admin-action`/Stripe) ≤ montant encaissé ; vérifier idempotence (second appel = no-op). Preuve : `refunds`, dashboard Stripe. Gravité : **CRITIQUE**.

## M. Cycle complet réel — **RÉSERVÉ À LA PHASE MANUELLE**
- Parcours bout en bout : devis → paiement → éjection → location → retour → clôture → reçu.

## N. Vérification production finale
**ID N1** — Confirmer migrations appliquées en prod, secrets présents (sans les lire), webhooks Stripe/ChargeNow pointant sur le bon environnement, aucune donnée de test résiduelle. Gravité : **CRITIQUE**.
