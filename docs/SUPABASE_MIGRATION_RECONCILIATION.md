# Réconciliation des migrations Supabase — staging

## État constaté le 31 juillet 2026

Le projet staging lié par la CLI est `xqepbqnaenoeyfjkjnzl`. Son historique de migrations ne correspond pas encore à l'historique versionné dans ce dépôt. Cette situation est un blocage de reproductibilité, **pas** une autorisation de réinitialiser, réparer ou réécrire l'historique.

### Écarts observés

- Locales absentes de l'historique distant : `20260720003000`, `20260724060000`, `20260724061000`, `20260731132542`.
- Distantes absentes du dépôt : la séquence `20260725042947` à `20260725050549`, ainsi que `20260731055742`, `20260731055744` et `20260731055745`.
- Les migrations communes antérieures sont alignées jusqu'à `20260719221000`, puis à `20260731100927` et `20260731101422`.

La migration additive `20260731132542_kiosk_numeric_enrollment_rate_limits.sql` a été exécutée une fois directement sur staging après revue : elle ajoute un journal privé de tentatives, deux colonnes non destructives, des index et deux surcharges de fonction de redemption. Cette exécution n'a pas réparé le tableau d'historique Supabase : elle doit donc rester explicitement traitée comme une exception contrôlée jusqu'à la baseline.

## Garanties de sécurité

- Aucun `supabase db reset --linked`, `migration repair`, `db push` ni DDL destructif n'a été exécuté pour traiter cette dérive.
- Aucun export de mot de passe, URL directe de base, token ou secret n'est stocké dans ce document.
- Les environnements fournisseur, Stripe live et matériel restent désactivés.

## Procédure de baseline requise

1. Exporter les métadonnées de schéma du staging dans un emplacement local sécurisé, sans données applicatives ni secrets.
2. Rapatrier les migrations distantes manquantes avec leur contenu réel ou les classer formellement comme des changements manuels historiques. Ne pas les recréer à partir d'une supposition.
3. Sur une base vierge isolée, rejouer l'historique local candidat et comparer tables, contraintes, index, fonctions et RLS au staging.
4. Produire une migration de compatibilité additive pour chaque écart de schéma réellement établi.
5. Faire relire le plan ordonné, effectuer un `db push --dry-run`, puis appliquer seulement les migrations compatibles sur staging.
6. Une fois le schéma vérifié, réparer l'historique uniquement avec des correspondances version/contenu prouvées et consigner la décision.

## Critères de sortie

La réconciliation peut être considérée reproductible seulement si :

- une base vierge reconstruit un schéma équivalent au staging ;
- chaque version distante possède un fichier versionné ou une décision de baseline documentée ;
- le dry-run ne propose aucun changement inattendu ;
- les tests SQL, RLS et de provisioning passent sur le schéma reconstruit ;
- les versions appliquées sont consignées dans le rapport de déploiement.

Jusque-là, les nouveaux changements de schéma doivent être rares, additifs, revus individuellement et documentés comme l'exception kiosk ci-dessus.
