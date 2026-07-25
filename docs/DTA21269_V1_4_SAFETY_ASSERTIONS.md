# Assertions de sécurité — v1.4

Le code et les exports v1.4 conservent explicitement :

- `safeReadOnly: true` ;
- `vendorCodeExecuted: false` ;
- `serialPortOpened: false` ;
- `serialBytesWritten: 0` ;
- `physicalEjectionEnabled: false` ;
- `protocolSolved: false` ;
- `payloadRecovered: false`.

L’analyse statique ne doit jamais être interprétée comme une autorisation d’écrire une trame inconnue.
