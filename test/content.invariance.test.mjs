import assert from "node:assert/strict";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { loadG002Bundle } from "../src/content/load.mjs";
import {
  canonicalFactSetBytes,
  stableStringify,
} from "../src/content/stable-json.mjs";
import {
  ContentValidationError,
  validateG002Bundle,
} from "../src/content/validate.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

test("stable JSON sorts object keys, preserves arrays, and rejects non-NFC strings", () => {
  assert.equal(
    stableStringify({ z: [3, 2, 1], a: { y: true, b: null } }),
    '{"a":{"b":null,"y":true},"z":[3,2,1]}',
  );
  assert.throws(() => stableStringify("가"), /Non-NFC string/u);
});

test("P1, P2, and P3 reference byte-identical canonical facts in all 30 cases", async () => {
  const bundle = /** @type {any} */ (await loadG002Bundle(root));
  validateG002Bundle(bundle);
  const conceptCards = /** @type {any[]} */ (bundle.concepts.cards);
  const scenarioRecords = /** @type {any[]} */ (bundle.scenarios.scenarios);
  const caseRecords = /** @type {any[]} */ (bundle.cases.cases);
  const cards = new Map(conceptCards.map((card) => [card.id, card]));
  const scenarios = new Map(
    scenarioRecords.map((scenario) => [scenario.scenario_id, scenario]),
  );
  const baselines = new Map();

  for (const item of caseRecords) {
    const scenario = scenarios.get(item.scenario_id);
    assert.ok(scenario);
    const bytes = canonicalFactSetBytes(
      /** @type {string[]} */ (scenario.concept_ids).map((id) => cards.get(id)),
      bundle.manifest.content_version,
    );
    const prior = baselines.get(item.scenario_id);
    if (prior) assert.deepEqual(bytes, prior, item.case_id);
    baselines.set(item.scenario_id, bytes);
  }

  assert.equal(baselines.size, 10);
  assert.equal(caseRecords.length, 30);
});

test("canonical mutations fail until the manifest hash and content version are reviewed", async () => {
  const bundle = /** @type {any} */ (await loadG002Bundle(root));
  const mutated = structuredClone(bundle);
  mutated.concepts.cards[0].canonical_definition += " 변경";

  assert.throws(
    () => validateG002Bundle(mutated),
    (error) =>
      error instanceof ContentValidationError &&
      error.path.includes("manifest.canonical_hashes"),
  );
});

test("profile cases contain references only, never canonical overrides", async () => {
  const bundle = /** @type {any} */ (await loadG002Bundle(root));
  const forbidden = new Set([
    "canonical_definition",
    "mechanism",
    "misconceptions",
    "analogy_breakpoint",
    "safety_boundary",
  ]);

  for (const item of /** @type {any[]} */ (bundle.cases.cases)) {
    assert.deepEqual(
      Object.keys(item).filter((key) => forbidden.has(key)),
      [],
      item.case_id,
    );
  }
});
