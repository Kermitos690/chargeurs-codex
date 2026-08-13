import fs from "node:fs";

function replaceOnce(source, from, to, label) {
  const count = source.split(from).length - 1;
  if (count !== 1) throw new Error(`${label}: expected 1 match, found ${count}`);
  return source.replace(from, to);
}

const runtimePath = "android-kiosk/app/src/main/java/ch/chargeurs/kiosk/StripeTerminalReaderRuntime.java";
let runtime = fs.readFileSync(runtimePath, "utf8");
runtime = replaceOnce(runtime, `    private static StripeTerminalReaderRuntime instance;\n\n`, ``, "remove static runtime singleton");
runtime = replaceOnce(
  runtime,
`    static synchronized StripeTerminalReaderRuntime getOrCreate(Context context, KioskConfig config) {
        if (instance == null || !instance.config.stationId().equals(config.stationId())) {
            instance = new StripeTerminalReaderRuntime(context.getApplicationContext(), config);
        }
        return instance;
    }

    private StripeTerminalReaderRuntime(Context context, KioskConfig config) {`,
`    StripeTerminalReaderRuntime(Context context, KioskConfig config) {`,
  "runtime constructor ownership",
);
runtime = replaceOnce(
  runtime,
`    void ensureStarted() {`,
`    boolean matchesStation(String stationId) {
        return stationId != null && stationId.equals(config.stationId());
    }

    void ensureStarted() {`,
  "runtime station matcher",
);
fs.writeFileSync(runtimePath, runtime);

const appPath = "android-kiosk/app/src/main/java/ch/chargeurs/kiosk/ChargeursKioskApplication.java";
let app = fs.readFileSync(appPath, "utf8");
app = replaceOnce(
  app,
`public final class ChargeursKioskApplication extends Application {
    @Override`,
`public final class ChargeursKioskApplication extends Application {
    private StripeTerminalReaderRuntime terminalRuntime;

    synchronized StripeTerminalReaderRuntime terminalRuntime(KioskConfig config) {
        if (terminalRuntime == null || !terminalRuntime.matchesStation(config.stationId())) {
            terminalRuntime = new StripeTerminalReaderRuntime(getApplicationContext(), config);
        }
        return terminalRuntime;
    }

    @Override`,
  "application runtime owner",
);
fs.writeFileSync(appPath, app);

const bridgePath = "android-kiosk/app/src/main/java/ch/chargeurs/kiosk/NativeBridge.java";
let bridge = fs.readFileSync(bridgePath, "utf8");
bridge = replaceOnce(
  bridge,
`        this.terminalRuntime = StripeTerminalReaderRuntime.getOrCreate(activity.getApplicationContext(), config);`,
`        ChargeursKioskApplication application = (ChargeursKioskApplication) activity.getApplication();
        this.terminalRuntime = application.terminalRuntime(config);`,
  "bridge application runtime lookup",
);
fs.writeFileSync(bridgePath, bridge);

console.log("Applied Application-owned StripeTerminalReaderRuntime; no static Context owner remains");
