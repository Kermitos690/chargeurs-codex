# Agrégation des slots batterie

Le snapshot fusionne C4 (cabinet detail), C7 (battery list), C8 (slot list) et O1 (cabinet query) dans `cabinetSnapshot.ts`.

Chaque slot conserve :

- identité batterie et présence ;
- niveau de charge, uniquement depuis des clés explicites (`chargePercent`, `powerLevel`, `soc`, etc.) ;
- température, auto-test, défauts, état réseau et capacité d’éjection ;
- timestamps source, conflits et niveau de confiance.

Les champs génériques `vol`, `capacity` et `batteryCapacity` ne sont jamais interprétés comme une charge. Une température de `31.2 °C` reste une température, jamais `31.2 %`.

Un conflit entre les sources rend le slot non louable et le client voit `Vérification`. Le détail est disponible aux administrateurs via l’Edge Function `cabinet-slot-diagnostics` et la fiche de station.
