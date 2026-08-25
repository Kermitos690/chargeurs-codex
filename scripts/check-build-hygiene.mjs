import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const packagePath = path.join(root, "package.json");
const vitePath = path.join(root, "vite.config.ts");

const fail = (message) => {
  console.error(`[build-hygiene] FAIL: ${message}`);
  process.exit(42);
};

const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
const vite = fs.readFileSync(vitePath, "utf8");

const requiredInstallScripts = {
  "@swc/core@1.13.2": true,
  "esbuild@0.25.12": true,
};

for (const [dependency, expected] of Object.entries(requiredInstallScripts)) {
  if (pkg.allowScripts?.[dependency] !== expected) {
    fail(`package.json must explicitly approve ${dependency} install scripts`);
  }
}

if (pkg.devDependencies?.jsdom !== "26.1.0") {
  fail(`canonical staging requires jsdom 26.1.0; found ${pkg.devDependencies?.jsdom ?? "missing"}`);
}

const requiredViteMarkers = [
  ["static bundle splitting", "manualChunks"],
  ["Chrome 61 kiosk compatibility", 'target: "chrome61"'],
  ["Chargeurs+ push worker asset", '"chargeurs-plus-push-sw.js"'],
  ["Chargeurs+ push worker import", 'importScripts: ["/chargeurs-plus-push-sw.js"]'],
  ["controlled PWA activation", 'registerType: "prompt"'],
];

for (const [label, marker] of requiredViteMarkers) {
  if (!vite.includes(marker)) {
    fail(`vite.config.ts lost ${label} (${marker})`);
  }
}

const forbiddenViteMarkers = [
  ['registerType: "autoUpdate"', "automatic service-worker activation"],
  ["skipWaiting: true", "uncontrolled service-worker skipWaiting"],
];

for (const [marker, label] of forbiddenViteMarkers) {
  if (vite.includes(marker)) {
    fail(`vite.config.ts enables forbidden ${label} (${marker})`);
  }
}

console.log("[build-hygiene] PASS");
console.log(JSON.stringify({
  jsdom: pkg.devDependencies.jsdom,
  swcInstallScriptApproved: true,
  esbuildInstallScriptApproved: true,
  chrome61Target: true,
  staticChunks: true,
  chargeursPlusPushWorker: true,
  controlledServiceWorkerActivation: true,
}));
