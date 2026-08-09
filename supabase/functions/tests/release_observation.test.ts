import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { classifyReleaseDelta, releaseBaselineReady, type SafeReleaseSnapshot } from "../_shared/releaseObservation.ts";

const base = (emptySlots: number[] = []): SafeReleaseSnapshot => ({
  cabinet_id: "DTA21269",
  observed_at: new Date().toISOString(),
  slots: [1, 2, 3, 4].map((slot) => ({
    slot_num: slot,
    battery_id: emptySlots.includes(slot) ? null : `BAT-${slot}`,
    battery_present: emptySlots.includes(slot) ? false : true,
    confidence: "high",
    conflicts: [],
  })),
});

Deno.test("all four explicit compartments form a safe hardware baseline", () => {
  assertEquals(releaseBaselineReady(base()), true);
  assertEquals(releaseBaselineReady(base([4])), true);
});

Deno.test("one ambiguous compartment blocks the hardware baseline", () => {
  const snapshot = base();
  snapshot.slots[2].confidence = "low";
  assertEquals(releaseBaselineReady(snapshot), false);
  snapshot.slots[2].confidence = "high";
  snapshot.slots[2].conflicts = ["battery_id"];
  assertEquals(releaseBaselineReady(snapshot), false);
});

Deno.test("one selected compartment becoming empty is one physical release", () => {
  const result = classifyReleaseDelta(base(), base([1]), 1);
  assertEquals(result.result, "single_release");
  assertEquals(result.released_slot_nums, [1]);
  assertEquals(result.released_battery_ids, ["BAT-1"]);
});

Deno.test("two compartments becoming empty after one command is a multi release", () => {
  const result = classifyReleaseDelta(base(), base([1, 3]), 1);
  assertEquals(result.result, "multi_release");
  assertEquals(result.released_slot_nums, [1, 3]);
  assertEquals(result.selected_slot_released, true);
});

Deno.test("a different compartment opening is an unexpected release", () => {
  const result = classifyReleaseDelta(base(), base([2]), 1);
  assertEquals(result.result, "unexpected_release");
  assertEquals(result.released_slot_nums, [2]);
});

Deno.test("missing or low-confidence data never invents a release", () => {
  const post = base();
  post.slots[0].battery_present = false;
  post.slots[0].battery_id = null;
  post.slots[0].confidence = "low";
  post.slots[0].conflicts = ["battery_present"];
  const result = classifyReleaseDelta(base(), post, 1);
  assertEquals(result.result, "pending");
});
