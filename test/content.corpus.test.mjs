import assert from "node:assert/strict";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { loadG002Bundle } from "../src/content/load.mjs";
import { validateG002Bundle } from "../src/content/validate.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

test("golden cases are the exact 3-profile by 10-scenario Cartesian product", async () => {
  const bundle = /** @type {any} */ (await loadG002Bundle(root));
  validateG002Bundle(bundle);
  const expected = ["P1", "P2", "P3"].flatMap((profileId) =>
    Array.from(
      { length: 10 },
      (_, index) => `${profileId}-S${String(index + 1).padStart(2, "0")}`,
    ),
  );

  assert.deepEqual(
    /** @type {any[]} */ (bundle.cases.cases)
      .map((item) => item.case_id)
      .sort(),
    expected.sort(),
  );
});

test("all 12 fixed confusion diagnostics are represented by the scenarios", async () => {
  const bundle = /** @type {any} */ (await loadG002Bundle(root));
  const pairs = /** @type {any[]} */ (bundle.confusionPairs.pairs);
  const scenarios = /** @type {any[]} */ (bundle.scenarios.scenarios);
  const pairById = new Map(pairs.map((pair) => [pair.pair_id, pair]));
  const covered = new Set();

  for (const scenario of scenarios) {
    const validQuestions = /** @type {string[]} */ (
      scenario.confusion_pair_ids
    ).map((pairId) => {
      covered.add(pairId);
      return pairById.get(pairId).diagnostic_question;
    });
    assert.ok(
      validQuestions.includes(scenario.diagnostic_question),
      scenario.scenario_id,
    );
  }

  assert.deepEqual([...covered].sort(), [...pairById.keys()].sort());
});

test("research analogy cells remain non-consumable candidates until G004", async () => {
  const bundle = /** @type {any} */ (await loadG002Bundle(root));

  for (const mapping of /** @type {any[]} */ (bundle.mappings.mappings)) {
    assert.equal(mapping.confidence, "unvalidated", mapping.mapping_id);
    assert.equal(mapping.user_status, "candidate", mapping.mapping_id);
    assert.equal(
      mapping.validation_status,
      "candidate_requires_validation",
      mapping.mapping_id,
    );
    assert.deepEqual(mapping.relations_preserved, [], mapping.mapping_id);
  }
  assert.equal(bundle.manifest.personalization_ready, false);
});

test("learning evidence reaches applied_novel without changing execution permission", async () => {
  const bundle = /** @type {any} */ (await loadG002Bundle(root));
  validateG002Bundle(bundle);
  const fixture = bundle.learning;

  assert.equal(fixture.learning_evidence.state, "applied_novel");
  assert.ok(!fixture.learning_evidence.state_history.includes("mastered"));
  assert.deepEqual(
    fixture.execution_permission_observation.before,
    fixture.execution_permission_observation.after,
  );
  assert.equal(
    Object.hasOwn(fixture.learning_evidence, "execution_permission"),
    false,
  );
});
