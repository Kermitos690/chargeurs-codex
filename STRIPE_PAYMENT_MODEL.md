# Modèle de paiement — Stripe et solde prépayé

## Principe

Le prix final, le plafond, la garantie éventuelle et le non-retour proviennent exclusivement du `pricing_snapshot` immuable de la location. Le navigateur ne décide jamais d'un montant financier.

Deux familles de rails sont volontairement séparées :

- **Stripe** pour Express et pour un membre qui n'a pas les 30 CHF de solde prépayé nécessaires au rail interne ;
- **`membership_prepaid`** lorsque le membre possède déjà au moins 30 CHF de solde Chargeurs.ch disponible.

Le pilote ne combine pas un solde partiel et une garantie Stripe partielle. Le first-rail-wins interdit qu'une même location engage simultanément Stripe et le solde prépayé.

## Express — garantie Stripe

Le snapshot pilote v3 utilise une garantie de référence de **30 CHF**.

### Carte / Wallet éligible

Checkout ou Stripe Terminal crée un PaymentIntent à capture manuelle lorsque la méthode le permet. Après retour, le moteur capture uniquement le prix final dû selon le snapshot et libère le reste de l'autorisation. Une autorisation bancaire n'est jamais supposée valable indéfiniment.

### TWINT / capture automatique

Lorsque la méthode ne permet pas la capture manuelle, le montant de garantie du snapshot est encaissé. Après retour, Stripe conserve uniquement le prix final et rembourse la différence selon le flux serveur confirmé.

## Membre — solde prépayé Chargeurs.ch

Lorsque `customer_segment=member`, que le snapshot est en `pricing_rules_version=3` et qu'au moins **30 CHF** sont disponibles dans le ledger :

1. le client accepte les documents contractuels ;
2. le serveur revendique le rail `membership_prepaid` ;
3. il réserve atomiquement **3 000 centimes** dans le ledger ;
4. aucun Checkout, PaymentIntent ou débit Stripe supplémentaire n'est créé ;
5. le Rental Orchestrator reçoit `payment_started` puis `payment_authorized` ;
6. la session devient financièrement couverte avec `settlement_status=prepaid` ;
7. l'éjection reste soumise aux mêmes garde-fous matériels que pour Stripe.

Au retour, le prix v3 est recalculé exclusivement depuis le snapshot historique : seul ce montant est engagé dans le ledger et le reste de la réservation de 30 CHF est libéré. Par exemple, une location membre coûtant 2,20 CHF engage 2,20 CHF et libère 27,80 CHF.

Si le solde disponible est inférieur à 30 CHF, le rail prépayé est libéré sans réservation partielle et le client utilise le parcours de garantie Stripe complet ou recharge son solde avant une nouvelle tentative.

## Non-retour v3

Pour les nouvelles locations v3, le non-retour confirmé à **72 heures** correspond à **30 CHF au total**, et non au prix de durée plus une pénalité de 30 CHF.

La formule est versionnée dans le snapshot. Les locations historiques v1/v2 conservent leurs anciennes règles. La déclaration/automatisation d'un non-retour doit rester une procédure autorisée, auditable et juridiquement validée avant activation commerciale automatique.

## Complément Stripe

Le modèle v3 du pilote est plafonné à 30 CHF. Aucun nouveau mécanisme de débit complémentaire ne doit être introduit pour contourner ce plafond. Les chemins historiques de complément restent conservés pour les snapshots qui les requièrent, avec consentement compatible, authentification et revue manuelle lorsque nécessaire.

## Compensation et incertitude

- échec Stripe avant effet financier : le rail peut être libéré selon les règles existantes ;
- résultat Stripe incertain : conserver l'état de réconciliation plutôt que supposer l'absence d'effet ;
- rail prépayé autorisé mais résultat hardware incertain : conserver la réservation jusqu'à réconciliation, afin d'éviter une double dépense du même solde ;
- échec matériel confirmé sans remise de batterie : la réservation/autorisation doit être annulée ou libérée de manière idempotente par le chemin de compensation autorisé.

Les captures, annulations, remboursements, réservations, engagements et libérations utilisent des clés d'idempotence et une preuve serveur auditable.