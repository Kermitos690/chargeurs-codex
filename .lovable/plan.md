
# Diagnostic — écran bleu sur `/kiosk/DTA21269`

Analyse en lecture seule du commit publié `a0392e1…`. Aucun fichier n'a été modifié et aucune requête ChargeNow/Stripe/base n'a été émise.

## 1. Cause racine principale — trou de rendu quand `station === null`

`src/pages/Kiosk.tsx` :
- ligne 103 : `setPhase((p) => (p === "loading" ? "idle" : p))` est appelé **même si `data` est `null`**.
- ligne 394 : `{phase === "idle" && station && ( … )}` — la branche `idle` n'est rendue **que si `station` n'est pas null**.
- ligne 385 : `main` n'a **aucun contenu de repli** (pas de « Chargement… », pas d'état d'erreur borne inconnue).

Chemins qui produisent `station === null` durablement :
1. `stationId` d'URL absent du DNS `public.stations` (typo, borne pas encore provisionnée, ancienne borne supprimée).
2. `maybeSingle()` renvoie `data: null` en cas d'erreur RLS/PostgREST silencieuse ; comme le retour d'erreur n'est pas tracé, on ne le sait pas côté UI.
3. Timing : entre 0 et la première résolution de `loadStation()`, `phase` bascule à `idle` avant que `station` soit chargé (le `setStation` et le `setPhase` sont ordonnés mais si `loadStation` **rejette** — offline, JWT expiré, etc. — le `setPhase(idle)` n'est jamais atteint mais `loading` n'affiche que « Chargement… ». Sinon l'inverse : `station=null` puis `idle` → écran vide).

Effet observable : `<LiquidBackground />` (fond bleu animé) + header, `main` vide.

## 2. Garde anti-écran vide — trop lent et masqué par le header

`src/components/kiosk/KioskRuntimeGuard.tsx` :
- `BLANK_SCREEN_DELAY_MS = 8000` — 8 s de fond bleu autorisées avant secours.
- `hasMeaningfulKioskContent` ne regarde **que `main`**. Le header (bouton Aide, LanguageSwitcher, logo) contient du texte mais est **hors** `main`, donc la détection reste correcte ; en revanche le seuil de 5 caractères est atteint dès que la branche `loading` s'affiche (« Chargement… » = 12 chars) → le guard ne se déclenche jamais tant que `phase === "loading"` persiste.

Résultat : si `loadStation` reste bloqué en état de chargement (réseau lent, JWT en cours de refresh, SW qui répond du cache), l'utilisateur voit « Chargement… » indéfiniment, pas d'écran de secours.

## 3. Authentification `sync-cabinet-status` — non bloquante mais camoufle le vrai état

- `Kiosk.tsx` ligne 183 : `supabase.functions.invoke("sync-cabinet-status", { body: { stationId } })`.
- `kioskAwareFetch` injecte `X-Kiosk-Token` uniquement si le token existe dans `localStorage.kiosk_token`.
- Si la borne n'a **pas** encore été appairée (token absent) : la function répond `401 KIOSK_AUTH_REQUIRED`, le `.then(({ data }))` reçoit `data = null` → `setConfigured(false)` → bandeau « API non configurée » (comportement voulu).
- MAIS `loadStation()` en parallèle nécessite juste la lecture publique de `stations` (RLS `Public read`, grants colonne OK). Donc `station` devrait être chargé indépendamment.

Point à vérifier en prod : si la ligne `stations` pour `DTA21269` n'existe pas ou si `station_id` a été renommé (`DTA21269` vs `DTA-21269`), on retombe sur la cause 1. À confirmer par requête lecture sur `public.stations` (hors périmètre de ce plan puisqu'aucune modif demandée).

## 4. Verrou `localStorage` — nom réel `kiosk_locked_station`

Le prompt évoque `kiosk_station_id` ; la clé réelle est `kiosk_locked_station` (`src/lib/kioskLock.ts`).
- Chemin `mismatch === true` (borne verrouillée A, URL demande B) : rendu correct avec écran « Borne verrouillée » — pas d'écran bleu.
- Chemin `stationId` invalide (regex `/^[A-Za-z0-9_-]{4,32}$/` échoue) : `lockStationIfUnset` retourne `null`, `mismatch = false`, le composant continue vers le rendu principal → `loadStation` avec un `stationId` non validé → PostgREST filtre → `station = null` → cause 1.

## 5. Routage BrowserRouter / SW / cache

- `App.tsx` déclare bien `path="/kiosk/:stationId"` **et** `path="/kiosk/station/:stationId"` — les deux URL demandées matchent.
- `main.tsx` n'active la PWA que sur les routes `/kiosk*`. Sur les **autres** pages, le SW `/sw.js` est désinscrit.
- Risque : un ancien SW généré par `vite-plugin-pwa` peut servir un `index.html` en `NetworkFirst` mais des chunks JS anciens en `CacheFirst`. Si le déploiement `a0392e1` a introduit une nouvelle référence de colonne ou d'API et que le kiosk tourne encore sur un chunk précédent en cache, la requête peut échouer sans que l'UI le signale — même symptôme : `station = null`, écran bleu.
- `registerSW.ts` ne bloque pas la route en preview Lovable (`id-preview--…lovable.app`), c'est correct.

## 6. Autres pistes secondaires vérifiées

- `kiosk_devices` marqué actif mais `last_seen_at` jamais mis à jour : n'a **aucun impact** sur le rendu de la page — `verifyKioskDevice` ne consulte pas `last_seen_at`, seulement `active`, `revoked_at`, `expires_at`, `station_id`. Pas de cause d'écran bleu.
- Auth Supabase : la page kiosk n'a besoin d'aucune session utilisateur (clé publishable = rôle `anon`). Pas de refresh JWT bloquant.

---

## Liste minimale de fichiers à corriger

1. **`src/pages/Kiosk.tsx`**
   - `loadStation` : capturer et exposer l'erreur PostgREST (au lieu de `const { data }` seul), stocker `stationLoadError` en state.
   - Ne basculer `phase` à `idle` **que** quand `station` a été résolue OU quand la requête a explicitement échoué.
   - Ajouter une branche de rendu `phase === "idle" && !station` : écran « Borne inconnue / non provisionnée » avec `stationId` affiché, bouton Réessayer, et lien diagnostic. Pas de fond nu.
   - Ajouter aussi un rendu de repli dans la branche `loading` en cas d'erreur réseau persistante (spinner + message « Impossible de joindre le serveur » après ~5 s).
   - Valider `isValidStationId(stationId)` avant `loadStation`/`loadQuote` ; sinon afficher un écran « URL invalide » plutôt que d'appeler l'API avec un id vide.

2. **`src/components/kiosk/KioskRuntimeGuard.tsx`**
   - Réduire `BLANK_SCREEN_DELAY_MS` à ~4 s (ou rendre configurable).
   - Étendre `hasMeaningfulKioskContent` pour distinguer « spinner de chargement bloqué depuis > N secondes » (par ex. considérer que la seule présence du texte « Chargement… » plus de 10 s = écran non progressif) — à implémenter en suivant l'état passé par le composant Kiosk plutôt qu'en heuristique DOM.

3. **`src/lib/kioskLock.ts`** (ajustement mineur)
   - Rien à changer fonctionnellement, mais documenter la clé effective (`kiosk_locked_station`) là où le prompt attendait `kiosk_station_id`, pour éviter la confusion opérateur.

Aucun autre fichier ne participe à la cause racine. Pas de touche au paiement, au SW, au routage, ni à ChargeNow.

## Tests à ajouter

Tous en vitest (frontend) :

1. **`src/test/kioskPage.render.test.tsx`** (nouveau)
   - `station === null` après résolution → écran « Borne inconnue » rendu, pas `main` vide.
   - `stationId` invalide (regex) → écran « URL invalide » rendu, aucun appel réseau.
   - `station` chargée + `configured=false` → bandeau « API non configurée » visible, `main` non vide.

2. **`src/test/kioskRuntimeGuard.test.tsx`** (extension du fichier existant)
   - Le guard bascule vers `RecoveryScreen` si `main` reste vide au-delà du nouveau seuil.
   - Le guard **ne** bascule **pas** si `main` contient un spinner + texte de chargement légitime **court** (< seuil).
   - Nouveau cas : `main` ne contenant que « Chargement… » pendant > seuil « chargement figé » → RecoveryScreen.

3. **`src/test/kioskLock.test.ts`** (nouveau ou extension)
   - `isValidStationId` accepte `DTA21269`, refuse `""`, `"abc"`, `"../etc"`.
   - `lockStationIfUnset` idempotent, `forceSetStation` écrase.

Aucun test matériel, aucune éjection, aucune migration.

## Vérifications de sortie proposées (sans modification)

- `npm run lint`, `tsgo --noEmit`, `vitest run` doivent rester verts après ajout des tests.
- Pas de build, pas de publish, pas d'appel edge function réel.
