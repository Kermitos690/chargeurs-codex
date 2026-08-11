import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function commandExists(command) {
  const probe = spawnSync(process.platform === "win32" ? "where" : "which", [command], { stdio: "ignore" });
  return probe.status === 0;
}

function findChrome() {
  const explicit = process.env.CHROME_BIN || process.env.GOOGLE_CHROME_BIN;
  if (explicit) return explicit;

  const candidates = process.platform === "darwin"
    ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium"]
    : process.platform === "win32"
      ? [
          "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
          "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
        ]
      : ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"];

  for (const candidate of candidates) {
    if (candidate.includes(path.sep)) return candidate;
    if (commandExists(candidate)) return candidate;
  }

  throw new Error("Chrome/Chromium introuvable. Définissez CHROME_BIN pour exécuter l'agent frontend.");
}

async function getFreePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close(() => (port ? resolve(port) : reject(new Error("Impossible d'allouer un port CDP"))));
    });
  });
}

async function pollJson(url, timeoutMs = 10_000) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
    } catch (error) {
      lastError = error;
    }
    await delay(120);
  }
  throw new Error(`Chrome CDP indisponible après ${timeoutMs} ms: ${lastError?.message || url}`);
}

class CdpClient {
  constructor(webSocketUrl) {
    this.url = webSocketUrl;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Set();
  }

  async connect() {
    this.ws = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timeout connexion CDP")), 5_000);
      this.ws.addEventListener("open", () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
      this.ws.addEventListener("error", (event) => {
        clearTimeout(timer);
        reject(new Error(`Erreur WebSocket CDP: ${event?.message || "inconnue"}`));
      }, { once: true });
    });

    this.ws.addEventListener("message", (event) => {
      let message;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }

      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject, timer } = this.pending.get(message.id);
        this.pending.delete(message.id);
        clearTimeout(timer);
        if (message.error) reject(new Error(`${message.error.message} (${message.error.code})`));
        else resolve(message.result || {});
        return;
      }

      if (message.method) {
        for (const listener of this.listeners) listener(message);
      }
    });
  }

  send(method, params = {}, sessionId, timeoutMs = 10_000) {
    const id = this.nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timeout CDP ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify(payload));
    });
  }

  onEvent(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async close() {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.close();
  }
}

export async function launchBrowser() {
  const chrome = findChrome();
  const port = await getFreePort();
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "chargeurs-frontend-agent-"));
  const args = [
    "--headless=new",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--no-first-run",
    "--no-default-browser-check",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    "--window-size=1440,1920",
    "about:blank",
  ];
  if (process.platform === "linux") args.unshift("--no-sandbox");

  const child = spawn(chrome, args, { stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    if (stderr.length < 8_000) stderr += String(chunk);
  });

  try {
    const version = await pollJson(`http://127.0.0.1:${port}/json/version`);
    const client = new CdpClient(version.webSocketDebuggerUrl);
    await client.connect();

    return {
      client,
      async close() {
        await client.close().catch(() => {});
        child.kill("SIGTERM");
        await Promise.race([
          new Promise((resolve) => child.once("exit", resolve)),
          delay(1_000).then(() => child.kill("SIGKILL")),
        ]).catch(() => {});
        await fs.rm(userDataDir, { recursive: true, force: true }).catch(() => {});
      },
    };
  } catch (error) {
    child.kill("SIGKILL");
    await fs.rm(userDataDir, { recursive: true, force: true }).catch(() => {});
    throw new Error(`${error.message}\nChrome stderr: ${stderr.slice(-2_000)}`);
  }
}

function makeInspectionExpression(profile) {
  return `(() => {
    const visible = (el) => {
      if (!el || !(el instanceof Element)) return false;
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity || 1) > 0 && rect.width > 0 && rect.height > 0;
    };
    const textOf = (el) => (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
    const labelOf = (el) => {
      const aria = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.getAttribute('title');
      if (aria && aria.trim()) return aria.trim();
      const text = textOf(el);
      if (text) return text;
      if (el.id) {
        const label = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
        if (label && textOf(label)) return textOf(label);
      }
      const parentLabel = el.closest('label');
      return parentLabel ? textOf(parentLabel) : '';
    };

    const bodyText = (document.body?.innerText || '').replace(/\\s+/g, ' ').trim();
    const interactive = [...document.querySelectorAll('button, a[href], input, select, textarea, [role="button"], [tabindex]')]
      .filter(visible)
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return {
          tag: el.tagName.toLowerCase(),
          label: labelOf(el).slice(0, 180),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          display: style.display,
          href: el instanceof HTMLAnchorElement ? el.getAttribute('href') : null,
          disabled: 'disabled' in el ? Boolean(el.disabled) : false,
        };
      });

    const unlabeledControls = [...document.querySelectorAll('button, input, select, textarea, [role="button"]')]
      .filter(visible)
      .filter((el) => !labelOf(el))
      .slice(0, 30)
      .map((el) => el.outerHTML.slice(0, 240));

    const imagesWithoutAlt = [...document.querySelectorAll('img')]
      .filter(visible)
      .filter((el) => !el.hasAttribute('alt'))
      .slice(0, 30)
      .map((el) => el.getAttribute('src') || '<inline>');

    const formFieldsWithoutLabel = [...document.querySelectorAll('input:not([type="hidden"]), select, textarea')]
      .filter(visible)
      .filter((el) => !labelOf(el) && !el.getAttribute('placeholder'))
      .slice(0, 30)
      .map((el) => ({ tag: el.tagName.toLowerCase(), name: el.getAttribute('name'), type: el.getAttribute('type') }));

    const ids = [...document.querySelectorAll('[id]')].map((el) => el.id).filter(Boolean);
    const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))].slice(0, 30);

    const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')]
      .filter(visible)
      .map((el) => ({ level: Number(el.tagName.slice(1)), text: textOf(el).slice(0, 160) }));
    const headingJumps = [];
    for (let i = 1; i < headings.length; i++) {
      if (headings[i].level - headings[i - 1].level > 1) headingJumps.push([headings[i - 1], headings[i]]);
    }

    const overflowElements = [...document.querySelectorAll('main *, body > *')]
      .filter(visible)
      .filter((el) => {
        const rect = el.getBoundingClientRect();
        return rect.right > innerWidth + 3 || rect.left < -3 || (el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 8);
      })
      .slice(0, 30)
      .map((el) => ({ tag: el.tagName.toLowerCase(), text: textOf(el).slice(0, 120), className: String(el.className || '').slice(0, 160) }));

    const smallTouchTargets = ${JSON.stringify(Boolean(profile.touch))}
      ? interactive
          .filter((item) => !item.disabled)
          .filter((item) => item.tag !== 'a' || item.display !== 'inline')
          .filter((item) => item.width < 44 || item.height < 44)
          .slice(0, 40)
      : [];

    const longActionLabels = interactive
      .filter((item) => ['button', 'a'].includes(item.tag) && item.label.length > 52)
      .slice(0, 20);

    const emptyLinks = interactive
      .filter((item) => item.tag === 'a' && (!item.href || item.href === '#') && !item.label)
      .slice(0, 20);

    const buttons = [...document.querySelectorAll('button, a[href], [role="button"]')]
      .filter(visible)
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return {
          label: labelOf(el).slice(0, 140),
          area: Math.round(rect.width * rect.height),
          fontWeight: Number.parseInt(style.fontWeight, 10) || 400,
          background: style.backgroundColor,
        };
      })
      .filter((item) => item.label)
      .sort((a, b) => b.area - a.area);

    const nav = performance.getEntriesByType('navigation')[0];
    const resources = performance.getEntriesByType('resource');
    const transferBytes = resources.reduce((sum, item) => sum + (item.transferSize || 0), 0);
    const failedImages = [...document.images].filter((img) => img.complete && img.naturalWidth === 0).map((img) => img.src).slice(0, 20);

    return {
      url: location.href,
      title: document.title,
      lang: document.documentElement.lang || '',
      bodyTextLength: bodyText.length,
      bodyTextSample: bodyText.slice(0, 1200),
      h1Count: headings.filter((item) => item.level === 1).length,
      headings,
      headingJumps,
      mainCount: document.querySelectorAll('main').length,
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 3,
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: innerWidth,
      overflowElements,
      unlabeledControls,
      imagesWithoutAlt,
      formFieldsWithoutLabel,
      duplicateIds,
      smallTouchTargets,
      longActionLabels,
      emptyLinks,
      primaryActionCandidates: buttons.slice(0, 5),
      failedImages,
      performance: nav ? {
        domContentLoadedMs: Math.round(nav.domContentLoadedEventEnd),
        loadMs: Math.round(nav.loadEventEnd),
        responseMs: Math.round(nav.responseEnd),
        transferBytes,
        resourceCount: resources.length,
      } : null,
    };
  })()`;
}

export async function auditPage({ browser, url, profile, settleMs = 1_800 }) {
  const { client } = browser;
  const target = await client.send("Target.createTarget", { url: "about:blank" });
  const attached = await client.send("Target.attachToTarget", { targetId: target.targetId, flatten: true });
  const sessionId = attached.sessionId;
  const consoleErrors = [];
  const networkErrors = [];
  let topDocumentStatus = null;

  const stopListening = client.onEvent((message) => {
    if (message.sessionId !== sessionId) return;
    if (message.method === "Runtime.exceptionThrown") {
      const details = message.params?.exceptionDetails;
      consoleErrors.push({
        type: "exception",
        text: details?.exception?.description || details?.text || "Runtime exception",
      });
    }
    if (message.method === "Log.entryAdded" && ["error", "warning"].includes(message.params?.entry?.level)) {
      consoleErrors.push({ type: message.params.entry.level, text: message.params.entry.text });
    }
    if (message.method === "Network.responseReceived") {
      const response = message.params?.response;
      if (message.params?.type === "Document" && response?.url === url) topDocumentStatus = response.status;
      if (response?.status >= 400) networkErrors.push({ status: response.status, url: response.url, type: message.params?.type });
    }
    if (message.method === "Network.loadingFailed") {
      const errorText = message.params?.errorText || "Network loading failed";
      if (!/ERR_ABORTED|canceled/i.test(errorText)) networkErrors.push({ status: 0, url: message.params?.requestId, type: errorText });
    }
  });

  try {
    await Promise.all([
      client.send("Page.enable", {}, sessionId),
      client.send("Runtime.enable", {}, sessionId),
      client.send("Network.enable", {}, sessionId),
      client.send("Log.enable", {}, sessionId),
    ]);
    await client.send("Emulation.setDeviceMetricsOverride", {
      width: profile.width,
      height: profile.height,
      deviceScaleFactor: profile.deviceScaleFactor,
      mobile: profile.mobile,
      screenWidth: profile.width,
      screenHeight: profile.height,
    }, sessionId);
    await client.send("Emulation.setTouchEmulationEnabled", { enabled: Boolean(profile.touch), maxTouchPoints: profile.touch ? 5 : 1 }, sessionId);

    const loaded = new Promise((resolve) => {
      const off = client.onEvent((message) => {
        if (message.sessionId === sessionId && message.method === "Page.loadEventFired") {
          off();
          resolve();
        }
      });
      setTimeout(() => {
        off();
        resolve();
      }, 10_000).unref?.();
    });

    await client.send("Page.navigate", { url }, sessionId, 15_000);
    await loaded;
    await delay(settleMs);

    const result = await client.send("Runtime.evaluate", {
      expression: makeInspectionExpression(profile),
      returnByValue: true,
      awaitPromise: true,
    }, sessionId);
    const inspection = result.result?.value || {};

    return {
      inspection,
      consoleErrors: consoleErrors.slice(0, 50),
      networkErrors: networkErrors.slice(0, 80),
      topDocumentStatus,
      sessionId,
      targetId: target.targetId,
    };
  } catch (error) {
    return {
      inspection: {},
      consoleErrors,
      networkErrors,
      topDocumentStatus,
      sessionId,
      targetId: target.targetId,
      fatalError: error.message,
    };
  } finally {
    stopListening();
  }
}

export async function captureScreenshot(browser, sessionId, filePath) {
  const result = await browser.client.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }, sessionId, 15_000);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, Buffer.from(result.data, "base64"));
}

export async function closeAuditTarget(browser, targetId) {
  if (!targetId) return;
  await browser.client.send("Target.closeTarget", { targetId }).catch(() => {});
}
