import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const source = await Deno.readTextFile(new URL("../payment-portal/index.ts", import.meta.url));

Deno.test("legacy payment portal progress converges on the canonical live mobile tracker", () => {
  assert(source.includes("const canonicalProgressUrl"));
  assert(source.includes('req.method === "GET" && view === "progress"'));
  assert(source.includes("Location: canonicalProgressUrl(id, code, lang)"));
  assertEquals(source.indexOf('req.method === "GET" && view === "progress"') < source.indexOf('if (req.method === "POST")'), true);
});
