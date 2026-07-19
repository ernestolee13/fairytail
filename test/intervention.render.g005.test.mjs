import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { loadAnalogyRuntime } from "../src/analogy/engine.mjs";
import {
  assessFreshVerification,
  renderInterventionSurface,
  validateSurfaceInput,
} from "../src/intervention/render.mjs";
import { selectInterventionConcepts } from "../src/intervention/select.mjs";
import { renderScenarioForLocale } from "../src/locale/present.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const now = new Date("2026-07-18T12:00:00.000Z");
const runtime = await loadAnalogyRuntime(root, now);
const neutral = {
  kind: "neutral",
  reason: "test-neutral",
  profile_projection_calls: 0,
  network_calls: 0,
};

test("before shows actor, exact target, expected change, risk, evidence, and rollback", () => {
  const card = render("S02", {
    schema_version: 1,
    surface: "before",
    interaction_id: "before-s02",
    scenario_id: "S02",
    requested_locale: "en",
    started_at: "2026-07-18T11:59:00.000Z",
    action: {
      actor: "shell_process",
      target: "the reviewed local preview process",
      expected_change: "a local preview becomes reachable",
    },
  });
  const core = /** @type {Record<string, any>} */ (card.core);
  assert.equal(core.action.actor, "shell_process");
  assert.equal(core.action.target, "the reviewed local preview process");
  assert.equal(
    core.action.expected_change,
    "a local preview becomes reachable",
  );
  assert.equal(typeof core.safety.risk, "string");
  assert.equal(typeof core.safety.rollback, "string");
  assert.equal(typeof core.expected_evidence, "string");
  assert.equal(core.worked_example.steps.length, 3);
  assert.equal(card.mvp_hypothesis.target_words, 120);
  assert.equal(card.mvp_hypothesis.max_new_concepts, 2);
  assert.equal(card.mvp_hypothesis.label.includes("hypothesis"), true);
});

test("ten error fixtures stabilize first and bind one cause to one observed evidence item", async () => {
  const fixtures = JSON.parse(
    await readFile(join(root, "fixtures", "g005", "error-cases.json"), "utf8"),
  );
  assert.equal(fixtures.cases.length, 10);
  for (const fixture of fixtures.cases) {
    const card = render(fixture.input.scenario_id, fixture.input);
    const core = /** @type {Record<string, any>} */ (card.core);
    assert.equal(card.surface, "error", fixture.case_id);
    assert.equal(typeof core.stabilization, "string", fixture.case_id);
    assert.equal(
      core.one_evidenced_cause.based_on_evidence_id,
      core.observed_evidence.evidence_id,
      fixture.case_id,
    );
    assert.equal(typeof core.one_safe_action, "string", fixture.case_id);
    assert.equal(core.safety.rollback, core.stabilization, fixture.case_id);
  }
});

test("finish never looks successful without fresh interaction-bound passing evidence", () => {
  const base = {
    schema_version: 1,
    surface: "finish",
    interaction_id: "finish-s04",
    scenario_id: "S04",
    requested_locale: "en",
    started_at: "2026-07-18T11:30:00.000Z",
    claim: { summary: "The requested local change is complete." },
  };
  const missing = render("S04", { ...base, verification: null });
  const missingCore = /** @type {Record<string, any>} */ (missing.core);
  assert.equal(missingCore.completion.status, "verification_required");
  assert.equal(missingCore.completion.reason, "missing-verification");
  assert.match(missingCore.headline, /required/u);

  const cases = [
    {
      status: "failed",
      interaction_id: "finish-s04",
      observed_at: "2026-07-18T11:40:00.000Z",
      reason: "verification-failed",
    },
    {
      status: "passed",
      interaction_id: "other-interaction",
      observed_at: "2026-07-18T11:40:00.000Z",
      reason: "interaction-mismatch",
    },
    {
      status: "passed",
      interaction_id: "finish-s04",
      observed_at: "2026-07-18T11:29:59.999Z",
      reason: "predates-interaction",
    },
    {
      status: "passed",
      interaction_id: "finish-s04",
      observed_at: "2026-07-18T12:00:00.001Z",
      reason: "future-evidence",
    },
  ];
  for (const item of cases) {
    const card = render("S04", {
      ...base,
      verification: verification(item),
    });
    const core = /** @type {Record<string, any>} */ (card.core);
    assert.equal(core.completion.status, "verification_required");
    assert.equal(core.completion.reason, item.reason);
    assert.match(core.headline, /required/u);
  }

  const verified = render("S04", {
    ...base,
    verification: verification({
      status: "passed",
      interaction_id: "finish-s04",
      observed_at: "2026-07-18T11:40:00.000Z",
    }),
  });
  const verifiedCore = /** @type {Record<string, any>} */ (verified.core);
  assert.equal(verifiedCore.completion.status, "verified_complete");
  assert.equal(verifiedCore.completion.reason, "fresh-passed-evidence");
  assert.equal(verifiedCore.safety.checks_fade, false);
  assert.equal(JSON.stringify(verified).includes("mastered"), false);
});

test("surface inputs are closed, bounded, and reject private paths or unbound causes", () => {
  const valid = {
    schema_version: 1,
    surface: "error",
    interaction_id: "error-boundary",
    scenario_id: "S04",
    requested_locale: "en",
    started_at: "2026-07-18T11:00:00.000Z",
    failure: {
      evidence_id: "evidence-one",
      observed_at: "2026-07-18T11:01:00.000Z",
      summary: "The read check did not pass.",
      interrupted: false,
    },
    cause: {
      statement: "The observed response status indicates a request mismatch.",
      confidence: "medium",
      based_on_evidence_id: "evidence-one",
    },
  };
  assert.throws(
    () => validateSurfaceInput({ ...valid, raw_error: "PRIVATE_CANARY" }),
    /exactly/u,
  );
  assert.throws(
    () =>
      validateSurfaceInput({
        ...valid,
        failure: { ...valid.failure, summary: "Failed at /Users/private/work" },
      }),
    /non-sensitive/u,
  );
  assert.throws(
    () =>
      validateSurfaceInput({
        ...valid,
        failure: { ...valid.failure, summary: "const leaked = true" },
      }),
    /non-sensitive/u,
  );
  assert.throws(
    () =>
      validateSurfaceInput({
        ...valid,
        cause: { ...valid.cause, based_on_evidence_id: "evidence-two" },
      }),
    /must cite/u,
  );
  assert.throws(
    () => assessFreshVerification(validateSurfaceInput(valid), now),
    /only to finish/u,
  );
});

/** @param {string} scenarioId @param {Record<string, any>} input */
function render(scenarioId, input) {
  const localized = renderScenarioForLocale(
    runtime,
    scenarioId,
    /** @type {any} */ (neutral),
    input.requested_locale,
  );
  const selection = selectInterventionConcepts(runtime, {
    scenarioId,
    evidenceRecords: [],
  });
  return renderInterventionSurface(runtime, localized, selection, input, now);
}

/** @param {Record<string, any>} overrides */
function verification(overrides) {
  return {
    evidence_version: 1,
    evidence_id: "finish-evidence",
    interaction_id: overrides.interaction_id,
    check_id: "focused-check",
    kind: "test",
    status: overrides.status,
    summary: "The focused check completed after the change.",
    observed_at: overrides.observed_at,
  };
}
