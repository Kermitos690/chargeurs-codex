# Rapport final de livraison

Date de consolidation : 19 juillet 2026. Ce rapport distingue l'implémentation vérifiée localement d'une validation externe ou physique. Un écran seul n'est jamais considéré comme terminé.

## Plateforme

| Fonction | Statut | Preuve/condition |
|---|---|---|
| Frontend public, stations réelles, tarifs, FAQ, SEO, support et partenaires | TERMINÉ ET TESTÉ | build/typecheck/tests locaux ; aucun fallback démo production |
| Formulaires support/installation | TERMINÉ — CLÉ EXTERNE REQUISE | Edge + table + file admin ; sel/origines Supabase requis |
| Compte client, historique, profil, paiements, remboursements, incidents, export/suppression | TERMINÉ — CLÉ EXTERNE REQUISE | Auth/RLS/Edge implémentés ; staging requis |
| Back-office opérations/finance/support/maintenance | TERMINÉ ET TESTÉ | staging Supabase déployé, administrateur invité, données pilotes et RBAC |
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
| Frontend staging Vercel | TERMINÉ ET TESTÉ | `https://chargeurs-ch-staging.vercel.app`, routes `/admin`, `/kiosk` et route pilote HTTP 200 ; build du commit `fb4de66` |
| Supabase staging | TERMINÉ ET TESTÉ | `chargeurs-ch-staging` (`xqepbqnaenoeyfjkjnzl`, Zurich), 46 migrations appliquées et 22 Edge Functions déployées |

## Décision de mise en production

Le dépôt est consolidé et prêt pour la phase de branchement externe, mais l'ouverture publique reste interdite tant que les cases de `PRODUCTION_CHECKLIST.md` ne sont pas cochées. Les seuls travaux qui ne peuvent pas être réalisés depuis ce dépôt sont l'apport des accès, l'application sur les environnements du propriétaire, la qualification fournisseur et les tests physiques/live explicitement manuels.

## Validation locale exécutée

- frontend : lint sans erreur (13 avertissements Fast Refresh/hooks connus), typecheck, 68 tests et build PWA ;
- backend : `deno check` de toutes les Edge Functions et 163 tests Deno ;
- dépendances npm de production : 0 vulnérabilité signalée ;
- Android : tests unitaires, lint debug et APK debug staging ; release de production non reconstruite sans keystore propriétaire ;
- APK debug : signature v1/v2 vérifiée ; release/AAB volontairement non signés sans keystore propriétaire ;
- SQL : migrations appliquées sur le staging distant ; suite centrale, RLS, snapshot tarifaire et appairage atomique validés ;
- Edge Functions déployées ; `kiosk-enroll` répond de façon contrôlée avec HTTP 400 sur une requête invalide ;
- aucun paiement live ni ordre matériel réel n'a été lancé.

SHA-256 des artefacts locaux :

- `app-debug.apk` staging : `4b0745edbdf5cd9115df950e4854f6efa44b439b7d22f16da1df845a074bf25e`
- `app-release-unsigned.apk` : `2a9b4c371560a02a6d1a1017825f8c344194a95de023cc984a663f9ddadfb1df`
- `app-release.aab` : `9b9b5185bf636da5d4ba64b19559d45f7a990954862becfa0911af66b9282c3c`
