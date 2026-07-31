# Pont matériel fournisseur — état de préparation

## Décision d’architecture

Chargeurs.ch ne réutilise ni le code, ni les bibliothèques natives, ni les
identifiants, ni les fichiers privés de l’APK Bajie/ChargeNow. L’application
Android Chargeurs.ch et l’agent fournisseur sont deux applications Android
distinctes, isolées par le sandbox du système.

L’observation d’une APK fournisseur installée ne donne **pas** à Chargeurs.ch :

- l’accès à son processus ou à sa connexion persistante ;
- l’accès à son port série/RS485 ou à ses permissions constructeur ;
- l’accès à ses données privées, clés, jetons ou fichiers ;
- un contrat Intent, Binder ou SDK public.

Cette limitation vient d’Android et des privilèges du firmware de la borne ; ce
n’est pas un paramètre que Stripe, Vercel ou Supabase peut corriger.

## Ce qui est disponible côté Chargeurs.ch

| Couche | État | Preuve / comportement |
|---|---|---|
| Activation kiosk à six chiffres | Fonctionnelle côté application | identité locale Keystore + enrôlement serveur |
| Parcours kiosque et Stripe Checkout QR | Fonctionnel côté plateforme staging | le paiement est confirmé par webhook serveur |
| Lecture ChargeNow | Préparée sur l’API Open officielle | le backend est le seul détenteur des credentials |
| Création de commande, callback de sortie et retour | Contrats backend présents | restent contrôlés par les feature flags et les tests de recette |
| Éjection locale depuis Chargeurs.ch | `NOT_CONFIGURED` | aucun protocole d’octets ni permission DTA supposés |
| Éjection cloud ChargeNow | `PROVIDER_MUTATION_DISABLED` | aucune mutation fournisseur envoyée dans ce build |

La documentation officielle ChargeNow couvre notamment la création de commande
de location, la consultation de commande et les callbacks `0` (échec de
sortie), `1` (sortie réussie) et `2` (retour). Elle ne fournit pas, dans le
périmètre utilisé par cette application, un SDK Android public permettant de
reprendre l’agent série local de la borne.

## Diagnostic intégré à l’APK

Depuis l’écran d’activation, **Diagnostic matériel automatique** ne réalise que
des lectures locales limitées : version Android, USB, candidats de ports série,
présence et état activé de l’APK fournisseur. Il ne :

- lance ni n’arrête l’APK fournisseur ;
- ne lit pas ses fichiers, ses identifiants ou sa configuration ;
- n’envoie aucune trame série, commande cloud, location, retour ou éjection ;
- ne révèle aucun credential.

États possibles de l’application fournisseur :

| État | Signification |
|---|---|
| `VENDOR_APP_NOT_INSTALLED` | l’agent fournisseur n’est pas présent |
| `VENDOR_APP_DISABLED` | il est présent mais Android le désactive |
| `VENDOR_APP_PRESENT_NO_LAUNCHER` | il est présent sans activité de lancement publique |
| `VENDOR_APP_PRESENT_NO_PUBLIC_BRIDGE` | il est détecté, mais aucun pont public documenté ne peut être utilisé par Chargeurs.ch |
| `VENDOR_APP_STATUS_UNAVAILABLE` | Android n’a pas permis de lire les métadonnées de package |

`VENDOR_APP_PRESENT_NO_PUBLIC_BRIDGE` ne signifie ni « connecté », ni
« déconnecté ». L’état réel de sa session réseau n’est pas observable par une
autre application Android sans API publique expresse.

## Parcours physique compatible sans contourner le fournisseur

La voie sûre est de laisser l’agent DTA/Bajie gérer son propre lien matériel et
d’utiliser **uniquement l’Open API ChargeNow documentée** depuis le backend
Chargeurs.ch :

```text
Kiosk Chargeurs.ch → Stripe Checkout + webhook serveur
                        ↓
                 Backend Chargeurs.ch
                        ↓
            Open API ChargeNow documentée
                        ↓
          Agent DTA/Bajie autorisé sur la borne
                        ↓
                 slot / batterie / callback
```

Ce mode requiert une recette contrôlée avec une borne pilote : le fournisseur
doit confirmer que l’agent local reste enregistré lorsqu’il est en arrière-plan
et accepte les commandes issues de l’Open API. Chargeurs.ch n’envoie aucune
commande avant que les flags de mutation soient explicitement activés pour ce
test, avec procédure de remboursement et personne présente.

## Conditions nécessaires pour un remplacement de l’agent local

Le seul moyen de remplacer réellement l’APK fournisseur par l’APK Chargeurs.ch
est de disposer d’au moins un élément officiel :

1. SDK Android/Binder/Intent public du constructeur ;
2. contrat documenté du service système qui possède le port DTA/RS485 ;
3. protocole série officiel (trames, débit, parité, CRC, gestion du retour) et
   droit firmware/SELinux d’ouvrir le port ;
4. firmware ou MDM qui donne à Chargeurs.ch le rôle d’agent matériel autorisé.

Sans l’un de ces éléments, générer des trames ou tenter d’accéder aux données
de l’APK fournisseur serait à la fois non fiable et hors du périmètre autorisé.
