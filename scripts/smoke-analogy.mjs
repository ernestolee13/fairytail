#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { evaluateGoldenCases } from "../src/analogy/evaluate.mjs";
import { loadAnalogyRuntime, resolveAnalogy } from "../src/analogy/engine.mjs";
import { renderScenario, stableRenderBytes } from "../src/analogy/render.mjs";
import { completeOnboarding } from "../src/profile/onboarding.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dataDir = await mkdtemp(join(tmpdir(), "fairytail-analogy-smoke-"));
const now = new Date("2026-07-18T12:00:00.000Z");

try {
  const runtime = await loadAnalogyRuntime(root, now);
  const profile = completeOnboarding(
    {
      background_categories: ["healthcare"],
      familiar_labels: [],
      coding_actions: ["none"],
      presentation_preference: "analogy_first",
      safety_concerns: ["privacy"],
      language: "ko",
    },
    "approve",
    now,
  ).profile;
  const first = await resolveAnalogy(runtime, {
    profile,
    scenarioId: "S04",
    dataDir,
    regressionCatalog: true,
  });
  assert.equal(first.kind, "mapped");
  if (first.kind !== "mapped") throw new Error("Expected mapped analogy");
  assert.equal(first.source, "catalog");
  const firstBytes = stableRenderBytes(renderScenario(runtime, "S04", first));

  const repeated = await resolveAnalogy(runtime, {
    profile,
    scenarioId: "S04",
    dataDir,
    regressionCatalog: true,
  });
  assert.equal(repeated.kind, "mapped");
  if (repeated.kind !== "mapped") throw new Error("Expected cached analogy");
  assert.equal(repeated.source, "cache");
  assert.deepEqual(
    stableRenderBytes(renderScenario(runtime, "S04", repeated)),
    firstBytes,
  );

  const different = await resolveAnalogy(runtime, {
    profile,
    scenarioId: "S04",
    dataDir,
    choice: "different",
    priorMappingId: first.mapping_id,
    regressionCatalog: true,
  });
  assert.equal(different.kind, "neutral");
  assert.equal(different.reason, "no-validated-alternative");

  const none = await resolveAnalogy(runtime, {
    profile,
    scenarioId: "S04",
    dataDir,
    choice: "no_analogy",
    regressionCatalog: true,
  });
  assert.equal(none.kind, "none");
  assert.equal(none.profile_projection_calls, 0);

  const evaluation = await evaluateGoldenCases(runtime, now);
  assert.equal(evaluation.status, "pass");
  process.stdout.write(
    `${JSON.stringify(
      {
        status: "pass",
        firstSource: first.source,
        repeatedSource: repeated.source,
        sameWorldAlternativeAvailable: false,
        noAnalogyCalls: none.profile_projection_calls,
        golden: evaluation.summary,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  await rm(dataDir, { recursive: true, force: true });
}
