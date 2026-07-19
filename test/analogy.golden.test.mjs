import assert from "node:assert/strict";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  evaluateGoldenCases,
  scoreRenderedCase,
} from "../src/analogy/evaluate.mjs";
import { loadAnalogyRuntime, resolveAnalogy } from "../src/analogy/engine.mjs";
import { renderScenario } from "../src/analogy/render.mjs";
import { completeOnboarding } from "../src/profile/onboarding.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const now = new Date("2026-07-18T12:00:00.000Z");
const runtime = await loadAnalogyRuntime(root, now);

test("all 30 actual render traces meet G004 thresholds deterministically", async () => {
  const first = await evaluateGoldenCases(runtime, now);
  const repeated = await evaluateGoldenCases(runtime, now);

  assert.deepEqual(repeated, first);
  assert.equal(first.status, "pass");
  assert.deepEqual(first.summary, {
    case_count: 30,
    hard_failure_count: 0,
    minimum_score: 16,
    average_score: 16,
    fact_invariance_perfect_count: 30,
    profile_projection_calls: 30,
    network_calls: 0,
    execution_calls: 0,
  });
  assert.ok(Object.values(first.thresholds).every(Boolean));
  assert.ok(Object.values(first.confusion_checks).every(Boolean));
  assert.equal(new Set(first.cases.map((item) => item.case_id)).size, 30);
  assert.ok(first.cases.every((item) => item.total >= 13));
  assert.ok(first.cases.every((item) => item.hard_failures.length === 0));
  assert.ok(
    first.cases.every((item) => /^[a-f0-9]{64}$/u.test(item.rendered_hash)),
  );
});

test("golden fixtures remain unscored provenance and cannot declare their own pass", async () => {
  assert.ok(
    runtime.content.cases.every(
      (fixtureCase) =>
        fixtureCase.evaluation_status === "fixture_only_not_scored" &&
        !Object.hasOwn(fixtureCase, "score") &&
        !Object.hasOwn(fixtureCase, "pass"),
    ),
  );

  const fixtureCase = runtime.content.cases[0];
  const scenarioId = /** @type {string} */ (fixtureCase.scenario_id);
  const completed = completeOnboarding(
    {
      background_categories: ["healthcare"],
      familiar_labels: [],
      coding_actions: ["none"],
      presentation_preference: "analogy_first",
      safety_concerns: ["none"],
      language: "ko",
    },
    "approve",
    now,
  );
  const resolution = await resolveAnalogy(runtime, {
    profile: completed.profile,
    scenarioId,
    regressionCatalog: true,
  });
  const rendered = renderScenario(runtime, scenarioId, resolution);
  const claimedPass = scoreRenderedCase(
    runtime,
    {
      ...fixtureCase,
      evaluation_status: "pass",
      score: 16,
    },
    rendered,
    resolution,
  );
  assert.equal(claimedPass.total, 16);
  assert.deepEqual(claimedPass.hard_failures, []);

  const forgedFacts = structuredClone(rendered);
  forgedFacts.canonical_definition.concepts[0].canonical_definition +=
    " PRIVATE_FACT_DRIFT";
  const caught = scoreRenderedCase(
    runtime,
    {
      ...fixtureCase,
      evaluation_status: "pass",
      score: 16,
    },
    forgedFacts,
    resolution,
  );
  assert.equal(caught.scores.fact_invariance, 0);
  assert.ok(caught.hard_failures.includes("canonical-fact-drift"));
  assert.ok(caught.total < claimedPass.total);
});
