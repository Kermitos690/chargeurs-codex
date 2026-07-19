# Sécurité

## Principes

Refus par défaut, moindre privilège, calcul serveur, idempotence, séparation test/live, journalisation sans secret et aucune confiance accordée au navigateur, aux URLs de retour ou aux métadonnées non rapprochées.

## Paiement

- Signature Stripe vérifiée sur le corps brut.
- Montant, devise, Checkout, PaymentIntent et empreinte du snapshot vérifiés.
- Éjection seulement après webhook et transition serveur valide.
- Clés d'idempotence sur Checkout, webhook, remboursement, capture, complément et commande fournisseur.

## Autorisations

Rôles : `super_admin`, `operations_admin`, `finance_admin`, `support_agent`, `maintenance_technician`, `partner_owner`, `partner_staff`, `customer`, `kiosk_device`, `api_client`. Les anciens rôles restent compatibles pendant migration. RLS, Edge Functions et navigation appliquent les contrôles ; les membres partenaires ne lisent que leur organisation.

## Secrets

La clé `service_role`, les clés Stripe secrètes, les secrets ChargeNow, sels, clés de signature et keystore Android ne doivent jamais être versionnés ou injectés dans Vite. Les tokens kiosque sont hachés en base et chiffrés au repos sur Android. Les journaux masquent les clés portant token/secret/password/authorization.

## Android

TLS invalide refusé, debug WebView désactivé en release, origine/port verrouillés, accès fichier désactivé, Keystore AES-GCM et commande matérielle JWS courte avec anti-rejeu. Aucun contournement root observé dans l'APK fournisseur n'est reproduit.

## API

Clés préfixées test/live, valeur brute affichée une fois, hash en base, scopes, quotas minute/jour, révocation et logs avec IP hachée. Les webhooks sortants sont signés.

## Signalement

En cas de vulnérabilité, ne pas créer d'issue publique contenant des secrets. Contacter le propriétaire du dépôt et suivre `INCIDENT_RESPONSE.md`. Révoquer immédiatement toute clé exposée, même si le commit est ensuite supprimé.
