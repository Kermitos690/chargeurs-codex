# Deployment traceability

Every kiosk diagnostic must expose, without secrets:

- web commit SHA and build id;
- APK version and version code;
- APK SHA-256 and signing certificate fingerprint;
- environment and Supabase project alias;
- deployed Edge Function version or deployment id.

The test report must record the exact tuple:

```text
tablet serial/device id + web SHA + APK SHA + Edge version + migration set
```

Current APK reference is `1.0.15-staging` / versionCode `115`, a debug-signed
staging variant. It is not an RC signing proof. `1.0.16-rc1` needs a controlled
release certificate stored outside Git, `apksigner verify` evidence and an
upgrade test over the installed build.
