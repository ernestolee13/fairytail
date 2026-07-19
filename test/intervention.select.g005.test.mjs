import assert from "node:assert/strict";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { loadAnalogyRuntime } from "../src/analogy/engine.mjs";
import {
  createLearningEvidence,
  reduceLearningEvidence,
} from "../src/learning/evidence.mjs";
import { selectInterventionConcepts } from "../src/intervention/select.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const runtime = await loadAnalogyRuntime(
  root,
  new Date("2026-07-18T12:00:00.000Z"),
);

test("selection stays inside the reviewed scenario and limits new concepts", () => {
  const selection = selectInterventionConcepts(runtime, {
    scenarioId: "S02",
    evidenceRecords: [],
  });
  assert.deepEqual(
    selection.selected.map((item) => item.concept_id),
    ["process-server", "local-remote-cloud-deploy"],
  );
  assert.equal(
    selection.selected.every((item) => item.disclosure === "full"),
    true,
  );
  assert.equal(selection.hypothesis.observed_new_concepts, 2);
  assert.equal(selection.hypothesis.max_new_concepts, 2);
  assert.equal(
    selection.hypothesis.label,
    "mvp_hypothesis_not_validated_learning_outcome",
  );
});

test("evidence fades teaching detail while safety can override hiding", () => {
  const learned = appliedNovel("process-server");
  const normal = selectInterventionConcepts(runtime, {
    scenarioId: "S02",
    evidenceRecords: [learned],
  });
  assert.deepEqual(
    normal.selected.map((item) => item.concept_id),
    ["local-remote-cloud-deploy"],
  );
  assert.deepEqual(normal.faded_concept_ids, ["process-server"]);

  const withSafety = selectInterventionConcepts(runtime, {
    scenarioId: "S02",
    evidenceRecords: [learned],
    safetyConceptIds: ["process-server"],
  });
  const safety = withSafety.selected.find(
    (item) => item.concept_id === "process-server",
  );
  assert.ok(safety);
  assert.equal(safety.disclosure, "safety_only");
  assert.equal(safety.assistance.safety_detail, "full");
  assert.equal(safety.assistance.safety_checks_fade, false);
});

test("failed evidence restores full explanation without changing permissions", () => {
  let evidence = retrievedDelayed("process-server");
  evidence = reduceLearningEvidence(evidence, {
    type: "novel_application_scored",
    scenario_id: "new-server-context",
    at: "2026-07-18T00:22:00.000Z",
    score: 3,
    fatal_misconception: true,
    novel_context: true,
  });
  const selection = selectInterventionConcepts(runtime, {
    scenarioId: "S02",
    evidenceRecords: [evidence],
  });
  const concept = selection.selected.find(
    (item) => item.concept_id === "process-server",
  );
  assert.ok(concept);
  assert.equal(concept.disclosure, "full");
  assert.equal(concept.assistance.recovery_support, true);
  assert.equal(Object.hasOwn(concept, "execution_permission"), false);
});

/** @param {string} conceptId */
function retrievedDelayed(conceptId) {
  let evidence = reduceLearningEvidence(createLearningEvidence(conceptId), {
    type: "exposed",
    scenario_id: "S02",
    at: "2026-07-18T00:00:00.000Z",
  });
  evidence = reduceLearningEvidence(evidence, {
    type: "teachback_scored",
    scenario_id: "S02",
    at: "2026-07-18T00:01:00.000Z",
    score: 8,
    fatal_misconception: false,
  });
  return reduceLearningEvidence(evidence, {
    type: "retrieval_scored",
    scenario_id: "S02",
    at: "2026-07-18T00:21:00.000Z",
    score: 8,
    fatal_misconception: false,
  });
}

/** @param {string} conceptId */
function appliedNovel(conceptId) {
  return reduceLearningEvidence(retrievedDelayed(conceptId), {
    type: "novel_application_scored",
    scenario_id: "new-server-context",
    at: "2026-07-18T00:22:00.000Z",
    score: 8,
    fatal_misconception: false,
    novel_context: true,
  });
}
