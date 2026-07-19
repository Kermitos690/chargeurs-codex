# Déploiement

## Préconditions

Node, npm, Deno 2, Supabase CLI, Java 17 et Android SDK 36. Renseigner les variables de `.env.example` dans un coffre de secrets ; ne jamais créer un `.env` versionné.

## Staging

1. Créer un projet Supabase distinct et noter son `project-ref`.
2. Lier le CLI au projet staging.
3. Vérifier la liste des migrations puis exécuter `supabase db push` sur staging uniquement.
4. Déployer toutes les Edge Functions déclarées dans `supabase/config.toml`.
5. Renseigner les secrets Supabase/Stripe test/ChargeNow test et les origines staging.
6. Déployer le frontend avec les variables `VITE_*` staging.
7. Créer le webhook Stripe test vers `stripe-webhook` et enregistrer son secret.
8. Laisser `beta_rentals_enabled=false` jusqu'aux tests Checkout, callback, remboursement et matériel.

## Production

Reproduire la procédure avec de nouveaux projets/clefs. Effectuer une revue manuelle du diff de migrations, une sauvegarde, un test de restauration et une validation à quatre yeux avant `supabase db push`. Le déploiement frontend doit être atomique et réversible. L'activation des mutations ChargeNow et de Stripe live est une action manuelle finale.

## Android

Le debug se construit avec :

```bash
cd android-kiosk
./gradlew testDebugUnitTest lintDebug assembleDebug
```

La release exige `ANDROID_KEYSTORE_PATH`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`, `CHARGEURS_ENROLLMENT_URL` et la clé publique d'autorisation d'éjection. Construire ensuite `lintRelease assembleRelease bundleRelease`. Le workflow Android est uniquement manuel.

## Retour arrière

- Frontend : republier l'artefact web précédent.
- Edge Function : redéployer la version Git précédente.
- Base : préférer une migration corrective ; ne jamais supprimer une migration déjà appliquée.
- Android : conserver un APK signé antérieur compatible avec la même clé et un `versionCode` inférieur.

Voir aussi `SUPABASE_SETUP.md`, `STRIPE_SETUP.md`, `CHARGENOW_SETUP.md` et `PRODUCTION_CHECKLIST.md`.
