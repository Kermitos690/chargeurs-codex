#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { buildRoutes, coveredAbsoluteRoutes, DEFAULT_BASE_URL, DEFAULT_STATION_ID, profiles, scoringWeights } from "./frontend-agent/config.mjs";
import { auditPage, captureScreenshot, closeAuditTarget, launchBrowser } from "./frontend-agent/cdp.mjs";

const SEVERITY_ORDER = { blocker: 4, high: 3, medium: 2, low: 1, info: 0 };

function parseArgs(argv) {
  const result = {
    baseUrl: process.env.FRONTEND_AGENT_BASE_URL || DEFAULT_BASE_URL,
    stationId: process.env.FRONTEND_AGENT_STATION_ID || DEFAULT_STATION_ID,
    scope: process.env.FRONTEND_AGENT_SCOPE || "full",
    outDir: process.env.FRONTEND_AGENT_OUT_DIR || "artifacts/frontend-quality-agent",
    minScore: Number(process.env.FRONTEND_AGENT_MIN_SCORE || 82),
    screenshots: process.env.FRONTEND_AGENT_SCREENSHOTS || "failures",
    settleMs: Number(process.env.FRONTEND_AGENT_SETTLE_MS || 1800),
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const [key, inlineValue] = arg.split("=", 2);
    const next = inlineValue ?? argv[i + 1];
    const consume = inlineValue == null;
    if (key === "--base-url") { result.baseUrl = next; if (consume) i++; }
    else if (key === "--station-id") { result.stationId = next; if (consume) i++; }
    else if (key === "--scope") { result.scope = next; if (consume) i++; }
    else if (key === "--out-dir") { result.outDir = next; if (consume) i++; }
    else if (key === "--min-score") { result.minScore = Number(next); if (consume) i++; }
    else if (key === "--screenshots") { result.screenshots = next; if (consume) i++; }
    else if (key === "--settle-ms") { result.settleMs = Number(next); if (consume) i++; }
    else if (key === "--help" || key === "-h") result.help = true;
  }
  return result;
}

function usage() {
  return `Chargeurs.ch Frontend Quality Agent\n\nUsage:\n  node scripts/frontend-quality-agent.mjs [options]\n\nOptions:\n  --base-url URL       localhost, staging or an explicitly allowed host\n  --station-id ID      station fixture used for read-only routes\n  --scope smoke|full   route coverage\n  --out-dir PATH       JSON/Markdown/screenshots output\n  --min-score N        global quality gate (default 82)\n  --screenshots MODE   none|failures|all\n  --settle-ms N        wait after page load\n\nSafety: the agent never clicks, submits, pays, refunds or calls hardware mutations. Payment pages use an impossible synthetic UUID.\n`;
}

function validateBaseUrl(raw) {
  const url = new URL(raw);
  const allowed = new Set([
    "localhost",
    "127.0.0.1",
    "chargeurs-ch-staging.vercel.app",
    ...String(process.env.FRONTEND_AGENT_ALLOWED_HOSTS || "").split(",").map((item) => item.trim()).filter(Boolean),
  ]);
  const isLocal = ["localhost", "127.0.0.1"].includes(url.hostname);
  if (!allowed.has(url.hostname)) {
    throw new Error(`Hôte refusé par la politique de sécurité frontend: ${url.hostname}. Ajoutez-le explicitement à FRONTEND_AGENT_ALLOWED_HOSTS.`);
  }
  if (!isLocal && url.protocol !== "https:") throw new Error("Les audits distants exigent HTTPS.");
  return url;
}

function finding(severity, category, code, message, evidence = {}) {
  return { severity, category, code, message, evidence };
}

function scorePenalty(findings, category) {
  const penalties = { blocker: 45, high: 22, medium: 10, low: 4, info: 0 };
  return findings.filter((item) => item.category === category).reduce((sum, item) => sum + penalties[item.severity], 0);
}

function boundedScore(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function evaluateAudit(route, profile, raw) {
  const i = raw.inspection || {};
  const findings = [];
  const push = (...args) => findings.push(finding(...args));

  if (raw.fatalError) push("blocker", "reliability", "PAGE_AUDIT_FAILED", "La page n'a pas pu être auditée dans Chrome.", { error: raw.fatalError });
  if (String(i.url || "").startsWith("chrome-error://") || /is blocked|ERR_BLOCKED_BY_ADMINISTRATOR|site can.t be reached|page inaccessible/i.test(String(i.bodyTextSample || ""))) {
    push("blocker", "reliability", "BROWSER_ERROR_PAGE", "Chrome affiche une page d'erreur à la place de l'application.", { renderedUrl: i.url, sample: i.bodyTextSample });
  }
  if (raw.topDocumentStatus != null && raw.topDocumentStatus >= 400) push("blocker", "reliability", "DOCUMENT_HTTP_ERROR", `Le document principal répond HTTP ${raw.topDocumentStatus}.`);
  if (!i.bodyTextLength || i.bodyTextLength < 20) push("high", "reliability", "EMPTY_OR_NEAR_EMPTY_PAGE", "La page rend très peu de contenu visible après stabilisation.", { bodyTextLength: i.bodyTextLength || 0 });

  const runtimeExceptions = (raw.consoleErrors || []).filter((item) => item.type === "exception" || item.type === "error");
  if (runtimeExceptions.length) push("high", "reliability", "RUNTIME_ERRORS", `${runtimeExceptions.length} erreur(s) runtime/console détectée(s).`, { samples: runtimeExceptions.slice(0, 5) });
  const severeNetwork = (raw.networkErrors || []).filter((item) => item.status === 0 || item.status >= 500);
  if (severeNetwork.length) push("medium", "reliability", "NETWORK_FAILURES", `${severeNetwork.length} requête(s) échouée(s) ou serveur 5xx.`, { samples: severeNetwork.slice(0, 5) });
  if ((i.failedImages || []).length) push("medium", "reliability", "BROKEN_IMAGES", `${i.failedImages.length} image(s) visible(s) ne se chargent pas.`, { samples: i.failedImages.slice(0, 5) });

  if (!i.title?.trim()) push("medium", "accessibility", "MISSING_DOCUMENT_TITLE", "Le document n'a pas de titre exploitable.");
  if (!i.lang?.trim()) push("medium", "accessibility", "MISSING_HTML_LANG", "La langue du document n'est pas déclarée sur <html>.");
  if (i.h1Count === 0 && !route.id.includes("kiosk")) push("medium", "accessibility", "MISSING_H1", "Aucun titre H1 visible n'est présent.");
  if (i.h1Count > 1) push("low", "accessibility", "MULTIPLE_H1", `${i.h1Count} titres H1 visibles sont présents.`);
  if ((i.headingJumps || []).length) push("low", "accessibility", "HEADING_LEVEL_JUMP", "La hiérarchie de titres saute un ou plusieurs niveaux.", { samples: i.headingJumps.slice(0, 4) });
  if ((i.unlabeledControls || []).length) push("high", "accessibility", "UNLABELED_CONTROLS", `${i.unlabeledControls.length} contrôle(s) visible(s) n'ont pas de nom accessible détectable.`, { samples: i.unlabeledControls.slice(0, 6) });
  if ((i.imagesWithoutAlt || []).length) push("medium", "accessibility", "IMAGES_WITHOUT_ALT", `${i.imagesWithoutAlt.length} image(s) visible(s) n'ont pas d'attribut alt.`, { samples: i.imagesWithoutAlt.slice(0, 6) });
  if ((i.formFieldsWithoutLabel || []).length) push("high", "accessibility", "FORM_FIELDS_WITHOUT_LABEL", `${i.formFieldsWithoutLabel.length} champ(s) de formulaire n'ont ni label ni texte indicatif détectable.`, { samples: i.formFieldsWithoutLabel.slice(0, 6) });
  if ((i.duplicateIds || []).length) push("medium", "accessibility", "DUPLICATE_IDS", "Des identifiants HTML dupliqués peuvent casser les associations d'accessibilité.", { ids: i.duplicateIds });

  if (i.horizontalOverflow) push("high", "responsive", "HORIZONTAL_PAGE_OVERFLOW", `Le document déborde horizontalement (${i.documentWidth}px pour ${i.viewportWidth}px).`, { elements: (i.overflowElements || []).slice(0, 6) });
  if ((i.overflowElements || []).length && !i.horizontalOverflow) push("low", "responsive", "ELEMENT_OVERFLOW", `${i.overflowElements.length} élément(s) présentent un débordement interne ou hors viewport.`, { samples: i.overflowElements.slice(0, 5) });
  if ((i.smallTouchTargets || []).length) {
    const severity = i.smallTouchTargets.length >= 5 ? "medium" : "low";
    push(severity, "responsive", "SMALL_TOUCH_TARGETS", `${i.smallTouchTargets.length} cible(s) tactile(s) sont inférieures à ~44×44 px.`, { samples: i.smallTouchTargets.slice(0, 8) });
  }

  if ((i.longActionLabels || []).length) push("low", "clarity", "LONG_ACTION_LABELS", "Certaines actions sont trop longues pour être scannées rapidement.", { samples: i.longActionLabels.slice(0, 5) });
  if ((i.primaryActionCandidates || []).length === 0 && !route.id.startsWith("legal-")) push("medium", "clarity", "NO_CLEAR_ACTION", "Aucune action visible n'a été détectée sur un écran opérationnel.");
  if ((i.emptyLinks || []).length) push("low", "clarity", "EMPTY_LINKS", "Des liens visibles sont vides ou sans destination exploitable.", { samples: i.emptyLinks.slice(0, 5) });

  const body = String(i.bodyTextSample || "");
  if (route.expectCommercialClarity && !/CHF|Fr\.?\s?\d|\d[.,]\d{2}\s?CHF/i.test(body)) {
    push("medium", "trust", "PRICE_NOT_VISIBLE", "Aucun repère tarifaire CHF n'est visible dans la zone de texte inspectée sur un écran commercial.");
  }
  if (route.expectRecoveryAction) {
    const recovery = /(retour|revenir|réessayer|reessayer|support|accueil|scanner|nouvelle|location)/i.test(body);
    if (!recovery) push("medium", "trust", "ERROR_RECOVERY_UNCLEAR", "L'état synthétique d'erreur ne présente pas clairement de prochaine action de récupération.");
  }

  const perf = i.performance;
  if (perf) {
    if (perf.loadMs > 6_000) push("high", "performance", "VERY_SLOW_LOAD", `Événement load à ${perf.loadMs} ms.`);
    else if (perf.loadMs > 3_500) push("medium", "performance", "SLOW_LOAD", `Événement load à ${perf.loadMs} ms.`);
    else if (perf.loadMs > 2_200) push("low", "performance", "LOAD_CAN_IMPROVE", `Événement load à ${perf.loadMs} ms.`);
    if (perf.transferBytes > 5_000_000) push("medium", "performance", "HEAVY_TRANSFER", `Environ ${(perf.transferBytes / 1_000_000).toFixed(1)} MB transférés.`);
    else if (perf.transferBytes > 2_500_000) push("low", "performance", "TRANSFER_CAN_IMPROVE", `Environ ${(perf.transferBytes / 1_000_000).toFixed(1)} MB transférés.`);
    if (perf.resourceCount > 180) push("low", "performance", "HIGH_RESOURCE_COUNT", `${perf.resourceCount} ressources chargées.`);
  }

  const categoryScores = {};
  for (const category of Object.keys(scoringWeights)) categoryScores[category] = boundedScore(100 - scorePenalty(findings, category));
  const score = boundedScore(Object.entries(scoringWeights).reduce((sum, [category, weight]) => sum + categoryScores[category] * weight, 0));

  return { score, categoryScores, findings };
}

function severityCounts(findings) {
  return findings.reduce((acc, item) => {
    acc[item.severity] = (acc[item.severity] || 0) + 1;
    return acc;
  }, { blocker: 0, high: 0, medium: 0, low: 0, info: 0 });
}

function reportMarkdown(report) {
  const lines = [];
  lines.push("# Chargeurs.ch — Frontend Quality Agent");
  lines.push("");
  lines.push(`- Base: \`${report.baseUrl}\``);
  lines.push(`- Scope: **${report.scope}**`);
  lines.push(`- Score global: **${report.score}/100** (gate ${report.minScore})`);
  lines.push(`- Audits: **${report.audits.length}**`);
  lines.push(`- Findings: ${report.counts.blocker} blocker · ${report.counts.high} high · ${report.counts.medium} medium · ${report.counts.low} low`);
  lines.push("");
  lines.push("## Scores");
  lines.push("");
  for (const [category, score] of Object.entries(report.categoryScores)) lines.push(`- ${category}: **${score}/100**`);
  lines.push("");
  lines.push("## Priorités");
  lines.push("");

  const prioritized = report.findings
    .slice()
    .sort((a, b) => (SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity]) || a.route.localeCompare(b.route));
  if (!prioritized.length) lines.push("Aucun défaut détecté par les heuristiques v1.");
  for (const item of prioritized.slice(0, 80)) {
    lines.push(`- **${item.severity.toUpperCase()} · ${item.category} · ${item.code}** — ${item.route} (${item.profile}) — ${item.message}`);
  }

  lines.push("");
  lines.push("## Pages");
  lines.push("");
  for (const audit of report.audits) {
    lines.push(`- **${audit.score}/100** · ${audit.routeId} · ${audit.profile} · \`${audit.path}\``);
  }
  lines.push("");
  lines.push("## Garde-fous");
  lines.push("");
  lines.push("Audit strictement read-only : aucune action n'est cliquée, aucun formulaire n'est soumis, aucun paiement/location/remboursement ni aucune mutation matérielle ChargeNow n'est déclenché. Les pages de paiement utilisent un UUID synthétique nul.");
  return `${lines.join("\n")}\n`;
}

async function runStaticSourceAudit() {
  const findings = [];
  const push = (severity, category, code, message, evidence = {}) => findings.push({ severity, category, code, message, evidence, route: "__static__", path: "source", profile: "source" });

  const appSource = await fs.readFile("src/App.tsx", "utf8").catch(() => null);
  if (appSource) {
    const absoluteRoutes = [...appSource.matchAll(/<Route\s+path=["']([^"']+)["']/g)]
      .map((match) => match[1])
      .filter((routePath) => routePath.startsWith("/") && routePath !== "*" && !routePath.startsWith("/admin"));
    const uncovered = [...new Set(absoluteRoutes.filter((routePath) => !coveredAbsoluteRoutes.has(routePath)))];
    if (uncovered.length) {
      push("high", "reliability", "CUSTOMER_ROUTES_NOT_AUDITED", `${uncovered.length} route(s) client absolue(s) existent dans App.tsx sans couverture déclarée par l'agent.`, { routes: uncovered });
    }
  } else {
    push("low", "reliability", "APP_SOURCE_NOT_AVAILABLE", "App.tsx n'est pas disponible pour le contrôle statique de couverture.");
  }

  const i18nSource = await fs.readFile("src/i18n/i18n.tsx", "utf8").catch(() => null);
  if (i18nSource) {
    const block = (startMarker, endMarker) => {
      const start = i18nSource.indexOf(startMarker);
      if (start < 0) return "";
      const end = endMarker ? i18nSource.indexOf(endMarker, start + startMarker.length) : -1;
      return i18nSource.slice(start, end > start ? end : undefined);
    };
    const keys = (source) => new Set([...source.matchAll(/["']([^"']+)["']\s*:/g)].map((match) => match[1]));
    const frBlock = block("const fr: Dict", "const en: Dict");
    const enBlock = block("const en: Dict", "const de: Dict");
    const deBlock = block("const de: Dict", "const dictionaries");
    const frKeys = keys(frBlock);

    for (const [lang, languageBlock] of [["en", enBlock], ["de", deBlock]]) {
      if (!languageBlock) {
        push("high", "clarity", "LANGUAGE_DICTIONARY_MISSING", `Le dictionnaire ${lang.toUpperCase()} n'a pas été détecté.`);
        continue;
      }
      const explicit = keys(languageBlock);
      const fallbackToFrench = /\.\.\.fr\b/.test(languageBlock);
      const missing = [...frKeys].filter((key) => !explicit.has(key));
      if (fallbackToFrench && missing.length) {
        push(
          "high",
          "clarity",
          "LANGUAGE_FALLS_BACK_TO_FRENCH",
          `${missing.length} clé(s) FR ne sont pas explicitement traduites en ${lang.toUpperCase()} et héritent donc potentiellement du français.`,
          { language: lang, count: missing.length, samples: missing.slice(0, 30) },
        );
      }
    }
  } else {
    push("medium", "clarity", "I18N_SOURCE_NOT_AVAILABLE", "Le fichier i18n principal n'est pas disponible pour le contrôle FR/EN/DE.");
  }

  return findings;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  if (!Number.isFinite(options.minScore) || options.minScore < 0 || options.minScore > 100) throw new Error("--min-score doit être compris entre 0 et 100.");
  if (!["smoke", "full"].includes(options.scope)) throw new Error("--scope doit valoir smoke ou full.");
  if (!["none", "failures", "all"].includes(options.screenshots)) throw new Error("--screenshots doit valoir none, failures ou all.");

  const base = validateBaseUrl(options.baseUrl);
  await fs.rm(options.outDir, { recursive: true, force: true });
  await fs.mkdir(options.outDir, { recursive: true });

  const routes = buildRoutes({ stationId: options.stationId, scope: options.scope });
  const browser = await launchBrowser();
  const audits = [];

  try {
    for (const route of routes) {
      for (const profileName of route.profiles) {
        const profile = profiles[profileName];
        const url = new URL(route.path, base).href;
        process.stdout.write(`→ ${route.id.padEnd(26)} ${profileName.padEnd(7)} ${url}\n`);
        const raw = await auditPage({ browser, url, profile, settleMs: options.settleMs });
        const evaluated = evaluateAudit(route, profile, raw);
        const audit = {
          routeId: route.id,
          path: route.path,
          url,
          profile: profileName,
          critical: Boolean(route.critical),
          score: evaluated.score,
          categoryScores: evaluated.categoryScores,
          findings: evaluated.findings,
          inspection: raw.inspection,
          consoleErrors: raw.consoleErrors,
          networkErrors: raw.networkErrors,
          topDocumentStatus: raw.topDocumentStatus,
          fatalError: raw.fatalError || null,
        };
        audits.push(audit);

        const hasFailure = evaluated.findings.some((item) => ["blocker", "high"].includes(item.severity));
        if (options.screenshots === "all" || (options.screenshots === "failures" && hasFailure)) {
          const fileName = `${String(audits.length).padStart(2, "0")}-${route.id}-${profileName}.png`.replace(/[^a-zA-Z0-9_.-]/g, "-");
          await captureScreenshot(browser, raw.sessionId, path.join(options.outDir, "screenshots", fileName)).catch(() => {});
        }
        await closeAuditTarget(browser, raw.targetId);
      }
    }
  } finally {
    await browser.close();
  }

  const runtimeFindings = audits.flatMap((audit) => audit.findings.map((item) => ({ ...item, route: audit.routeId, path: audit.path, profile: audit.profile })));
  const staticFindings = await runStaticSourceAudit();
  const allFindings = [...runtimeFindings, ...staticFindings];
  const categoryScores = {};
  for (const category of Object.keys(scoringWeights)) {
    const runtimeAverage = audits.reduce((sum, audit) => sum + audit.categoryScores[category], 0) / Math.max(1, audits.length);
    categoryScores[category] = boundedScore(runtimeAverage - scorePenalty(staticFindings, category));
  }
  const score = boundedScore(Object.entries(scoringWeights).reduce((sum, [category, weight]) => sum + categoryScores[category] * weight, 0));
  const counts = severityCounts(allFindings);
  const criticalHigh = allFindings.some((item) => {
    const audit = audits.find((candidate) => candidate.routeId === item.route && candidate.profile === item.profile);
    return audit?.critical && ["blocker", "high"].includes(item.severity);
  });
  const passed = counts.blocker === 0 && !criticalHigh && score >= options.minScore;

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    baseUrl: base.href,
    stationId: options.stationId,
    scope: options.scope,
    minScore: options.minScore,
    score,
    passed,
    counts,
    categoryScores,
    audits,
    findings: allFindings,
    safety: {
      navigationOnly: true,
      clicks: false,
      formSubmissions: false,
      realPayments: false,
      realRentals: false,
      hardwareMutations: false,
      pricingMutations: false,
    },
  };

  const jsonPath = path.join(options.outDir, "report.json");
  const mdPath = path.join(options.outDir, "report.md");
  await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  await fs.writeFile(mdPath, reportMarkdown(report));

  console.log(`\nScore frontend: ${score}/100 — ${passed ? "PASS" : "FAIL"}`);
  console.log(`Rapport: ${mdPath}`);
  if (!passed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`Frontend Quality Agent fatal: ${error.stack || error.message}`);
  process.exitCode = 2;
});
