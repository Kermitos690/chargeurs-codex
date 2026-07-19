# Modèle de paiement Stripe

## Garantie et prix final

La garantie initiale est de 30 CHF. Le prix final provient exclusivement du snapshot tarifaire immuable : 0,75 CHF par 30 minutes, plafond journalier 18 CHF, non-retour 99 CHF. Le complément maximal théorique après la garantie est 69 CHF.

## Stratégie carte

Pour une carte/Wallet éligible, Checkout crée un PaymentIntent à capture manuelle et demande une autorisation étendue lorsque disponible. Après retour, le moteur capture uniquement le prix final jusqu'au montant autorisé. Une autorisation n'est jamais supposée valable indéfiniment.

## Stratégie capture automatique

Pour TWINT ou une méthode ne permettant pas la capture manuelle, les 30 CHF sont encaissés. Après retour, Stripe rembourse la différence entre 30 CHF et le prix final. L'éjection attend la confirmation serveur de l'encaissement.

## Complément

Si le prix final dépasse 30 CHF, le moteur tente un paiement hors session uniquement avec un moyen sauvegardé et un consentement compatible. Si une authentification supplémentaire est requise ou le paiement échoue, l'état devient `supplemental_required`/revue manuelle ; aucun débit arbitraire n'est simulé.

## Non-retour

Le résultat contractuel de non-retour est exactement 99 CHF, non réduit par le plafond journalier ordinaire. Il doit être déclaré par une procédure autorisée et auditée. Le calcul du snapshot applique ensuite le plafond maximum de 99 CHF.

## Compensation

Échec ChargeNow/éjection après paiement : incident + remboursement idempotent. Les captures, annulations, remboursements et compléments utilisent des clés d'idempotence déterministes et un verrou de règlement récupérable.
