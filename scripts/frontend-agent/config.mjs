export const DEFAULT_BASE_URL = "https://chargeurs-ch-staging.vercel.app";
export const DEFAULT_STATION_ID = "DTA21269";
export const SYNTHETIC_SESSION_ID = "00000000-0000-0000-0000-000000000000";

export const profiles = {
  mobile: {
    name: "mobile",
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true,
    touch: true,
  },
  desktop: {
    name: "desktop",
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
    touch: false,
  },
  kiosk: {
    name: "kiosk",
    width: 1080,
    height: 1920,
    deviceScaleFactor: 1,
    mobile: false,
    touch: true,
  },
};

const commercialExpectations = {
  expectCommercialClarity: true,
  expectedTerms: ["CHF"],
};

export function buildRoutes({ stationId = DEFAULT_STATION_ID, scope = "full" } = {}) {
  const all = [
    { id: "home", path: "/", profiles: ["mobile", "desktop"], critical: true, ...commercialExpectations },
    { id: "city-lausanne", path: "/powerbank/lausanne", profiles: ["mobile", "desktop"], ...commercialExpectations },
    { id: "partners", path: "/partenaires", profiles: ["mobile", "desktop"] },
    { id: "support", path: "/support", profiles: ["mobile", "desktop"], critical: true },
    { id: "public-station", path: `/bornes/${stationId}`, profiles: ["mobile", "desktop"], critical: true, ...commercialExpectations },
    { id: "legal-conditions", path: "/legal/conditions", profiles: ["mobile"] },
    { id: "legal-privacy", path: "/legal/confidentialite", profiles: ["mobile"] },
    { id: "legal-notice", path: "/legal/mentions-legales", profiles: ["mobile"] },
    { id: "kiosk-pairing", path: "/kiosk", profiles: ["kiosk"], critical: true },
    { id: "kiosk-station", path: `/kiosk/${stationId}`, profiles: ["kiosk"], critical: true, ...commercialExpectations },
    { id: "account-login", path: "/compte/login", profiles: ["mobile", "desktop"], critical: true },
    { id: "account-reset", path: "/compte/reset-password", profiles: ["mobile"] },
    { id: "account-home-unauth", path: "/compte", profiles: ["mobile"] },
    { id: "account-rentals-unauth", path: "/compte/locations", profiles: ["mobile"] },
    { id: "account-payments-unauth", path: "/compte/paiements", profiles: ["mobile"] },
    { id: "account-pass-unauth", path: "/compte/pass", profiles: ["mobile"] },
    { id: "account-support-unauth", path: "/compte/support", profiles: ["mobile"] },
    { id: "account-profile-unauth", path: "/compte/profil", profiles: ["mobile"] },
    { id: "account-connect-invalid", path: "/compte/connect/frontend-agent-invalid-token", profiles: ["mobile"], expectRecoveryAction: true },
    { id: "account-scanner-unauth", path: "/compte/scanner", profiles: ["mobile"] },
    { id: "kiosk-station-alias", path: `/kiosk/station/${stationId}`, profiles: ["kiosk"], ...commercialExpectations },
    { id: "not-found", path: "/frontend-agent-not-found", profiles: ["mobile"], expectRecoveryAction: true },
    {
      id: "payment-invalid",
      path: `/pay/${SYNTHETIC_SESSION_ID}`,
      profiles: ["mobile"],
      syntheticOnly: true,
      expectRecoveryAction: true,
    },
    {
      id: "payment-choice-invalid",
      path: `/pay/${SYNTHETIC_SESSION_ID}/choose`,
      profiles: ["mobile"],
      syntheticOnly: true,
      expectRecoveryAction: true,
    },
    {
      id: "payment-progress-invalid",
      path: `/pay/${SYNTHETIC_SESSION_ID}/progress`,
      profiles: ["mobile"],
      syntheticOnly: true,
      expectRecoveryAction: true,
    },
    {
      id: "payment-success-invalid",
      path: `/pay/${SYNTHETIC_SESSION_ID}/success`,
      profiles: ["mobile"],
      syntheticOnly: true,
      expectRecoveryAction: true,
    },
    {
      id: "payment-cancel-invalid",
      path: `/pay/${SYNTHETIC_SESSION_ID}/cancel`,
      profiles: ["mobile"],
      syntheticOnly: true,
      expectRecoveryAction: true,
    },
  ];

  if (scope === "smoke") {
    const ids = new Set(["home", "support", "public-station", "kiosk-station", "account-login", "payment-invalid"]);
    return all.filter((route) => ids.has(route.id));
  }

  return all;
}

export const coveredAbsoluteRoutes = new Set([
  "/",
  "/powerbank/:citySlug",
  "/partenaires",
  "/support",
  "/bornes/:stationId",
  "/legal/:kind",
  "/kiosk",
  "/kiosk/:stationId",
  "/kiosk/station/:stationId",
  "/pay/:rentalSessionId/choose",
  "/pay/:rentalSessionId/progress",
  "/pay/:rentalSessionId",
  "/pay/:rentalSessionId/success",
  "/pay/:rentalSessionId/cancel",
  "/compte/login",
  "/compte/reset-password",
  "/compte/connect/:token",
  "/compte/scanner",
  "/compte",
]);

export const scoringWeights = {
  reliability: 0.26,
  accessibility: 0.2,
  responsive: 0.17,
  clarity: 0.17,
  performance: 0.1,
  trust: 0.1,
};
