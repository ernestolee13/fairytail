import assert from "node:assert/strict";
import test from "node:test";

import { HEADLINE_ARMS } from "../src/benchmark/contracts.mjs";
import { balancedArmOrders } from "../src/benchmark/suite.mjs";
import { assertPublishableSuiteStructure } from "../src/benchmark/verify.mjs";

test("seeded arm order is reproducible, permuted, and position-balanced", () => {
  const left = balancedArmOrders(6, "g010-suite-test");
  const right = balancedArmOrders(6, "g010-suite-test");
  assert.deepEqual(left, right);
  for (const order of left) {
    assert.deepEqual([...order.arms].sort(), [...HEADLINE_ARMS].sort());
  }
  for (let position = 0; position < HEADLINE_ARMS.length; position += 1) {
    const counts = Object.fromEntries(HEADLINE_ARMS.map((arm) => [arm, 0]));
    for (const order of left) counts[order.arms[position]] += 1;
    assert.deepEqual([...new Set(Object.values(counts))], [2]);
  }
});

test("repetition and publication guards reject undersized or missing diagnostics", () => {
  assert.throws(() => balancedArmOrders(0, "seed"), /at least 1/u);
  assert.throws(
    () =>
      assertPublishableSuiteStructure({
        benchmark_id: "g010",
        kind: "live-headline-suite",
        synthetic: false,
        publishable: false,
        lanes: ["build", "render"],
        repetitions: 4,
        runs: [],
      }),
    /top-level contract/u,
  );
});
