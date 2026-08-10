# Contrat de transition ChargeNow → Chargeurs.ch

## Objectif

Cette spécification définit la première tranche verticale du remplacement progressif de ChargeNow par Chargeurs.ch pour la borne pilote `DTA21269`.

Pendant cette phase, le matériel reste relié à ChargeNow :

```text
DTA21269 → cloud ChargeNow → backend Chargeurs.ch → Supabase → interfaces Chargeurs.ch
```

La tablette ne se connecte pas directement à la Platform API publique. Les intégrations partenaires utilisent des clés `chg_test_...` ou `chg_live_...`; la tablette utilise exclusivement son `X-Kiosk-Token` propre à la station.

## Périmètre de la première tranche

Lecture seule, limitée aux informations nécessaires pour exploiter et qualifier DTA21269 :

- identité de la borne ;
- statut en ligne et dernier état observable ;
- signal réseau fournisseur ;
- nombre total de slots ;
- nombre de batteries louables ;
- nombre de retours possibles ;
- batteries présentes et leur slot ;
- magasin associé ;
- stratégie tarifaire appliquée ;
- réponses et erreurs des différentes routes fournisseur.

Aucune route mutante ChargeNow n'est appelée par l'audit. `CHARGENOW_MUTATIONS_ENABLED` reste à `false`.

## Sources fournisseur

Base documentée :

```text
https://developer.chargenow.top/cdb-open-api/v1
```

La documentation Apifox est parfois incohérente entre `Basic` et `Bearer`. Le client backend Chargeurs.ch conserve donc deux modes possibles, configurés uniquement par secrets serveur :

- authentification Basic avec `CHARGENOW_BASIC_AUTH` ou le couple `CHARGENOW_BASIC_USERNAME` / `CHARGENOW_BASIC_PASSWORD` ;
- authentification OAuth2 avec un compte OpenAccount, mot de passe SHA-256 et jeton Bearer.

Le compte du dashboard web n'est pas présumé être un compte OpenAccount tant qu'un test en lecture seule ne l'a pas confirmé.

## Endpoint fournisseur activé en staging

| Fonction Chargeurs.ch | Endpoint ChargeNow | Méthode | Usage |
|---|---|---:|---|
| Snapshot principal borne | `/rent/cabinet/query?deviceId=...` | GET | Borne, magasin, prix et batteries dans une réponse |

Les autres opérations observées ou documentées restent modélisées dans le centre
de couverture interne, mais elles sont signalées `PROVIDER_ENDPOINT_MISSING` ou
`PROVIDER_MUTATION_DISABLED` tant que ChargeNow n'a pas confirmé le contrat à
utiliser. Aucun hôte alternatif ou endpoint déduit n'est appelé.

## Modèle canonique Chargeurs.ch

```ts
type ProviderStationSnapshot = {
  stationId: string;
  cabinetId: string;
  collectedAt: string;
  providerReachable: boolean;
  stateKnown: boolean;
  online: boolean | null;
  signal: number | null;
  totalSlots: number | null;
  rentableCount: number;
  returnableCount: number | null;
  shop: {
    id: string | null;
    name: string | null;
    address: string | null;
    latitude: string | null;
    longitude: string | null;
  };
  pricing: {
    name: string | null;
    currency: string | null;
    depositAmount: number | null;
    price: number | null;
    priceMinute: number | null;
    freeMinutes: number | null;
    dailyMaxPrice: number | null;
    timeoutAmount: number | null;
    timeoutDay: number | null;
  };
  batteries: Array<{
    batteryId: string;
    slotNum: number | null;
    powerLevel: number | null;
  }>;
  attempts: Array<{
    source: string;
    status: number;
    ok: boolean;
    error: string | null;
  }>;
};
```

## Mapping Supabase

| Snapshot fournisseur | Projection Chargeurs.ch |
|---|---|
| `cabinet.id` | `stations.cabinet_id` |
| `cabinet.online` | `stations.online` et `stations.status` |
| `cabinet.signal` | `stations.signal` |
| `cabinet.slots` | `stations.total_count` |
| `cabinet.busySlots` ou batteries présentes | `stations.rentable_count` |
| `cabinet.emptySlots` | `stations.returnable_count` |
| batterie + slot | `batteries` et `slots` |
| `shop` | tables de lieux / organisations, après validation |
| `priceStrategy` | snapshot fournisseur de comparaison, jamais autorité tarifaire du paiement Chargeurs.ch |

La tarification financière autoritaire reste le snapshot serveur Chargeurs.ch : `0,75 CHF / 30 minutes`, plafond `18 CHF / jour`, caution `30 CHF`, non-retour `99 CHF`. Une valeur ChargeNow différente déclenche un écart de configuration ; elle ne remplace jamais silencieusement le tarif Chargeurs.ch.

## Règles de sûreté

1. Aucun secret fournisseur dans le navigateur, le dépôt ou les réponses publiques.
2. Aucun appel mutatif pendant l'audit en lecture seule.
3. Une réponse HTTP 2xx avec code métier non nul reste un échec.
4. Une réponse non reconnue ne met jamais la station en ligne par défaut.
5. Les réponses des routes complémentaires sont indépendantes et explicitement marquées en succès ou échec.
6. Les données brutes fournisseur restent dans les journaux backend protégés ; le frontend reçoit un modèle normalisé.
7. Aucun événement `BATTERY_IN` ne ferme une location sans correspondance exacte entre trade number, batterie, station et slot.
8. Aucune éjection ne sera activée avant validation FreeTest, verrou idempotent, confirmation administrateur et campagne matérielle DTA21269.

## Critère de sortie de cette phase

La phase lecture seule est validée lorsque le backend Chargeurs.ch peut, pour DTA21269 :

1. authentifier un accès fournisseur sans exposer le secret ;
2. obtenir un snapshot reconnu ;
3. afficher borne, slots, batteries, magasin et prix dans l'administration ;
4. distinguer clairement panne réseau, rejet d'authentification, borne inconnue et réponse non reconnue ;
5. enregistrer un historique de synchronisation sans provoquer d'éjection, location ou paiement.

Toute phase matérielle ultérieure exige une autorisation explicite séparée ;
elle ne fait pas partie de la présente validation staging en lecture seule.
