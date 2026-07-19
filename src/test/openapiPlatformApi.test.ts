import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { load } from "js-yaml";

// Lightweight OpenAPI 3.1 validation: parses the YAML, checks core invariants
// and the frozen list of endpoints. A full spec validator runs in the manual
// staging workflow (redocly CLI).
describe("openapi/platform-api-v1.yaml", () => {
  const spec = load(readFileSync("openapi/platform-api-v1.yaml", "utf8")) as {
    openapi: string;
    info: { title: string; version: string };
    servers: Array<{ url: string; variables?: Record<string, unknown> }>;
    paths: Record<string, Record<string, unknown>>;
    components: { securitySchemes: Record<string, unknown> };
  };

  it("declares OpenAPI 3.1", () => {
    expect(spec.openapi).toMatch(/^3\.1/);
  });
  it("has a parametrisable staging server", () => {
    expect(spec.servers[0].url).toMatch(/\{baseUrl\}/);
  });
  it("exposes only the frozen v1 read-only endpoints", () => {
    const expected = [
      "/v1/health",
      "/v1/health/details",
      "/v1/me",
      "/v1/stations",
      "/v1/stations/{stationId}",
      "/v1/stations/{stationId}/availability",
      "/v1/stations/{stationId}/inventory",
      "/v1/pricing/quote",
      "/v1/rentals/{rentalId}",
      "/v1/rentals/{rentalId}/events",
    ].sort();
    expect(Object.keys(spec.paths).sort()).toEqual(expected);
  });
  it("only /v1/pricing/quote uses POST — every other path is GET-only", () => {
    for (const [p, methods] of Object.entries(spec.paths)) {
      const verbs = Object.keys(methods).filter((k) => ["get", "post", "put", "delete", "patch"].includes(k));
      if (p === "/v1/pricing/quote") {
        expect(verbs).toEqual(["post"]);
      } else {
        expect(verbs).toEqual(["get"]);
      }
    }
  });
  it("defines a bearer security scheme", () => {
    expect(spec.components.securitySchemes.bearerAuth).toBeTruthy();
  });
});
