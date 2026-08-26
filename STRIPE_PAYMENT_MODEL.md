# Modèle de paiement Stripe

## Garantie et prix final

La garantie initiale, le prix final, le plafond et le non-retour proviennent
exclusivement du snapshot tarifaire immuable de la location. Cette documentation
ne publie pas de montants commerciaux fixes : ils doivent être affichés au
client avant l’acceptation et validés juridiquement avant la production.

## Stratégie carte

Pour une carte/Wallet éligible, Checkout crée un PaymentIntent à capture manuelle et demande une autorisation étendue lorsque disponible. Après retour, le moteur capture uniquement le prix final jusqu'au montant autorisé. Une autorisation n'est jamais supposée valable indéfiniment.

## Stratégie capture automatique

Pour TWINT ou une méthode ne permettant pas la capture manuelle, le montant de
garantie du snapshot est encaissé. Après retour, Stripe rembourse la différence
entre cette garantie et le prix final. L'éjection attend la confirmation serveur
de l'encaissement.

## Complément

Si le prix final dépasse la garantie du snapshot, le moteur tente un paiement
hors session uniquement avec un moyen sauvegardé et un consentement compatible.
Si une authentification supplémentaire est requise ou le paiement échoue, l'état
devient `supplemental_required`/revue manuelle ; aucun débit arbitraire n'est simulé.

## Non-retour

Le résultat contractuel de non-retour est celui du snapshot accepté, non réduit
par le plafond journalier ordinaire. Il doit être déclaré par une procédure
autorisée et auditée.

## Compensation

Échec ChargeNow/éjection après paiement : incident + remboursement idempotent. Les captures, annulations, remboursements et compléments utilisent des clés d'idempotence déterministes et un verrou de règlement récupérable.
