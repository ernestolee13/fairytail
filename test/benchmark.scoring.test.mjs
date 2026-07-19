import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  runScorerSelftests,
  scoreExplanationPair,
  scoreExplanationPacket,
} from "../src/benchmark/scoring.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const benchmarkRoot = resolve(root, "benchmarks", "g010");

test("good/bad correctness, safety, and explanation references self-validate", async () => {
  const result = await runScorerSelftests(benchmarkRoot);
  assert.equal(result.status, "pass");
  assert.ok(Object.values(result.assertions).every(Boolean));
});

test("explanation metric is explicitly structural and never claims human comprehension", async () => {
  const explanationRoot = resolve(benchmarkRoot, "fixtures", "explanation");
  const [english, korean] = await Promise.all(
    ["good-en.json", "good-ko.json"].map(async (name) =>
      JSON.parse(await readFile(resolve(explanationRoot, name), "utf8")),
    ),
  );
  const score = scoreExplanationPair(english, korean, {
    canonicalFactHash:
      "5e9a7d2d58f2676a42e4fa1c5bc7d30c75041b27a4ccf1d2256e46feadf87158",
    conceptIds: ["path-traversal", "trust-boundary"],
    privacyCanary: "PRIVATE_PROFILE_CANARY",
  });
  assert.match(score.label, /not human comprehension/u);
  assert.equal(score.hard_gate_passed.value, true);
  assert.equal(score.score.value, score.maximum.value);
});

test("missing model output fails the explanation gate without crashing the harness", () => {
  const score = scoreExplanationPacket(undefined, {
    canonicalFactHash: "a".repeat(64),
    conceptIds: ["path-traversal"],
    privacyCanary: "PRIVATE_PROFILE_CANARY",
  });

  assert.equal(score.dimensions.bounded_fields, false);
  assert.equal(score.dimensions.privacy_canary_absent, true);
  assert.ok(score.hard_failures.includes("unbounded-or-missing-fields"));
});
