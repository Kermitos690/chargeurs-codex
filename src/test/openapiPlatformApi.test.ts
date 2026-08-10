import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { load } from "js-yaml";

// Lightweight OpenAPI 3.1 validation: parses the YAML, checks core invariants
// and the frozen list of endpoints. A full spec validator runs in the manual
// staging workflow (redocly CLI).
describe("docs/openapi/chargeurs-api-v1.yaml", () => {
  const spec = load(readFileSync("docs/openapi/chargeurs-api-v1.yaml", "utf8")) as {
    openapi: string;
    info: { title: string; version: string };
    servers: Array<{ url: string; variables?: Record<string, unknown> }>;
    paths: Record<string, Record<string, unknown>>;
    components: {
      securitySchemes: Record<string, unknown>;
      schemas: Record<string, { additionalProperties?: boolean; properties?: Record<string, unknown> }>;
    };
  };

  it("declares OpenAPI 3.1", () => {
    expect(spec.openapi).toMatch(/^3\.1/);
  });
  it("has a parametrisable staging server", () => {
    expect(spec.servers[0].url).toMatch(/\{project\}\.supabase\.co/);
    expect(spec.servers[0].variables).toHaveProperty("project");
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
      "/v1/incidents",
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
  it("exposes an explicitly scoped and allowlisted incident representation", () => {
    const operation = spec.paths["/v1/incidents"].get as Record<string, unknown>;
    const incident = spec.components.schemas.Incident;
    expect(operation["x-required-scope"]).toBe("incidents:read");
    expect(incident.additionalProperties).toBe(false);
    expect(Object.keys(incident.properties ?? {}).sort()).toEqual([
      "created_at",
      "id",
      "resolved",
      "severity",
      "type",
      "updated_at",
    ]);
  });
});
