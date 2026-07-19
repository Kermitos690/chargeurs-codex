# Rapport final de livraison

Date de consolidation : 19 juillet 2026. Ce rapport distingue l'implémentation vérifiée localement d'une validation externe ou physique. Un écran seul n'est jamais considéré comme terminé.

## Plateforme

| Fonction | Statut | Preuve/condition |
|---|---|---|
| Frontend public, stations réelles, tarifs, FAQ, SEO, support et partenaires | TERMINÉ ET TESTÉ | build/typecheck/tests locaux ; aucun fallback démo production |
| Formulaires support/installation | TERMINÉ — CLÉ EXTERNE REQUISE | Edge + table + file admin ; sel/origines Supabase requis |
| Compte client, historique, profil, paiements, remboursements, incidents, export/suppression | TERMINÉ — CLÉ EXTERNE REQUISE | Auth/RLS/Edge implémentés ; staging requis |
| Back-office opérations/finance/support/maintenance | TERMINÉ — CLÉ EXTERNE REQUISE | données réelles et RBAC ; Supabase staging requis |
| Organisations et séparation partenaires | TERMINÉ — CLÉ EXTERNE REQUISE | schéma/RLS présents ; comptes partenaires à provisionner |
| Pages légales | TERMINÉ — CLÉ EXTERNE REQUISE | contenu intégré ; identité/validation juridique requises |

## Paiement et location

| Fonction | Statut | Preuve/condition |
|---|---|---|
| Stripe Checkout QR prioritaire | TERMINÉ — CLÉ EXTERNE REQUISE | URL unique serveur, garantie 30 CHF, QR ; clé/webhook test requis |
| Preuve webhook, montant/devise/snapshot, idempotence | TERMINÉ ET TESTÉ | tests Deno et contrats ; redirect navigateur exclu |
| Carte capture différée / méthode prépayée-remboursement | TERMINÉ — CLÉ EXTERNE REQUISE | moteur implémenté ; compte Stripe test requis |
| Apple Pay / Google Pay / TWINT | TERMINÉ — CLÉ EXTERNE REQUISE | méthodes dynamiques Checkout ; activation/appareils requis |
| Stripe Terminal secondaire | BLOQUÉ PAR FOURNISSEUR | modèle/lecteur/configuration non fournis ; SDK absent de la nouvelle APK, QR reste pleinement indépendant |
| Snapshot tarifaire et 1,50 CHF/h, 18 CHF/j, 99 CHF non-retour | TERMINÉ ET TESTÉ | hash/binding/version et calcul gelé testés |
| Orchestrateur, doubles webhooks/commandes, compensation | TERMINÉ ET TESTÉ | contrats idempotence/concurrence locaux |

## ChargeNow et matériel

| Fonction | Statut | Preuve/condition |
|---|---|---|
| Client API, timeouts, erreurs, callbacks, réconciliation | TERMINÉ — CLÉ EXTERNE REQUISE | endpoints existants conservés, aucune invention ; sandbox fournisseur requis |
| Éjection uniquement après paiement confirmé | TERMINÉ ET TESTÉ | ordre serveur et tests de contrat |
| Retour batterie/slot exact | TERMINÉ — TEST MATÉRIEL REQUIS | corrélation stricte ; borne réelle requise |
| Protocole série local | BLOQUÉ PAR FOURNISSEUR | trames/API autorisée absentes ; fail-closed |
| Analyse APK fournisseur | TERMINÉ ET TESTÉ | `APK_ANALYSIS.md`, hash et inventaire statique |

## Android et exploitation

| Fonction | Statut | Preuve/condition |
|---|---|---|
| Projet Android, Gradle Wrapper, debug/release/AAB | TERMINÉ — CLÉ EXTERNE REQUISE | builds locaux ; release production exige keystore |
| Enrôlement, Keystore, origine WebView, boot/watchdog | TERMINÉ ET TESTÉ | code/tests/lint Android locaux |
| Lock-task Device Owner | TERMINÉ — TEST MATÉRIEL REQUIS | support applicatif ; DPC/tablette requis |
| Pont natif et autorisation JWS anti-rejeu | TERMINÉ — TEST MATÉRIEL REQUIS | vérification implémentée ; protocole réel absent |
| CI/CD | TERMINÉ — CLÉ EXTERNE REQUISE | workflows manuels/ciblés validés localement ; exécution GitHub et secrets d'environnement requis |
| Staging/production déployés | TERMINÉ — CLÉ EXTERNE REQUISE | procédures prêtes ; projets/accès non fournis |

## Décision de mise en production

Le dépôt est consolidé et prêt pour la phase de branchement externe, mais l'ouverture publique reste interdite tant que les cases de `PRODUCTION_CHECKLIST.md` ne sont pas cochées. Les seuls travaux qui ne peuvent pas être réalisés depuis ce dépôt sont l'apport des accès, l'application sur les environnements du propriétaire, la qualification fournisseur et les tests physiques/live explicitement manuels.

## Validation locale exécutée

- frontend : lint sans erreur (13 avertissements Fast Refresh/hooks connus), typecheck, 68 tests et build PWA ;
- backend : `deno check` de toutes les Edge Functions et 160 tests Deno ;
- dépendances npm de production : 0 vulnérabilité signalée ;
- Android : tests unitaires, lint debug/release, APK debug, APK release non signée et AAB ;
- APK debug : signature v1/v2 vérifiée ; release/AAB volontairement non signés sans keystore propriétaire ;
- SQL : contrats présents mais non exécutés, faute de serveur PostgreSQL/Supabase jetable dans la session ;
- aucun paiement live, déploiement distant ou ordre matériel réel n'a été lancé.

SHA-256 des artefacts locaux :

- `app-debug.apk` : `05af773b7cdbdd10acfa30fd38828b0666585fb79262226f7fd7673c6ceb00c4`
- `app-release-unsigned.apk` : `4575ebb79e6467d44e757375a477a3d58691fc9888bee0de9b2b2571016ad6d6`
- `app-release.aab` : `3450a86929f22de7387ff33761346b87989004aa65de1a2fcaab6e9724adcd7d`
