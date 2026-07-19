import assert from "node:assert/strict";
import test from "node:test";

import {
  assistancePolicy,
  createLearningEvidence,
  reduceLearningEvidence,
  retrievalIsDue,
  scoreTeachbackRubric,
  validateLearningEvidence,
  validateLearningEvent,
} from "../src/learning/evidence.mjs";

const conceptId = "api-request-response";
const passRubric = {
  role_and_flow: 2,
  confusion_boundary: 2,
  analogy_limit: 1,
  safe_next_action: 1,
  fatal_misconception: false,
};

test("learning evidence advances through the exact monotonic evidence states", () => {
  /** @type {Record<string, any>} */
  let evidence = createLearningEvidence(conceptId);
  assert.deepEqual(evidence.state_history, ["unseen"]);

  evidence = reduceLearningEvidence(
    evidence,
    exposed("2026-07-18T00:00:00.000Z"),
  );
  assert.equal(evidence.state, "exposed");

  evidence = reduceLearningEvidence(
    evidence,
    scored("teachback_scored", "2026-07-18T00:05:00.000Z", 7),
  );
  assert.equal(evidence.state, "explained_once");
  assert.equal(evidence.next_retrieval_after, "2026-07-18T00:25:00.000Z");
  assert.equal(
    retrievalIsDue(evidence, new Date("2026-07-18T00:24:59.999Z")),
    false,
  );
  assert.equal(
    retrievalIsDue(evidence, new Date("2026-07-18T00:25:00.000Z")),
    true,
  );

  assert.throws(
    () =>
      reduceLearningEvidence(
        evidence,
        scored("retrieval_scored", "2026-07-18T00:24:59.999Z", 8),
      ),
    /before it was due/u,
  );
  evidence = reduceLearningEvidence(
    evidence,
    scored("retrieval_scored", "2026-07-18T00:25:00.000Z", 7),
  );
  assert.equal(evidence.state, "retrieved_delayed");

  evidence = reduceLearningEvidence(evidence, {
    ...scored(
      "novel_application_scored",
      "2026-07-19T00:00:00.000Z",
      7,
      "weather-api-novel-01",
    ),
    novel_context: true,
  });
  assert.equal(evidence.state, "applied_novel");
  assert.deepEqual(evidence.state_history, [
    "unseen",
    "exposed",
    "explained_once",
    "retrieved_delayed",
    "applied_novel",
  ]);
  assert.equal(JSON.stringify(evidence).includes("mastered"), false);
  assert.equal(Object.isFrozen(evidence), true);

  evidence = reduceLearningEvidence(
    evidence,
    scored("teachback_scored", "2026-07-19T00:01:00.000Z", 2),
  );
  assert.equal(evidence.state, "applied_novel");
  assert.equal(assistancePolicy(evidence).recovery_support, true);
  assert.equal(assistancePolicy(evidence).explanation_detail, "full");
  assert.equal(assistancePolicy(evidence).safety_checks_fade, false);
});

test("assistance fades only after evidence and failed evidence restores support", () => {
  /** @type {Record<string, any>} */
  let evidence = reduceLearningEvidence(
    createLearningEvidence(conceptId),
    exposed("2026-07-18T00:00:00.000Z"),
  );
  evidence = reduceLearningEvidence(
    evidence,
    scored("teachback_scored", "2026-07-18T00:01:00.000Z", 5),
  );
  assert.equal(evidence.state, "exposed");
  assert.deepEqual(assistancePolicy(evidence), {
    policy_version: 1,
    basis_state: "exposed",
    recovery_support: true,
    explanation_detail: "full",
    example_support: "worked_example",
    safety_detail: "full",
    safety_checks_fade: false,
  });

  evidence = reduceLearningEvidence(
    evidence,
    scored("teachback_scored", "2026-07-18T00:02:00.000Z", 8),
  );
  assert.equal(assistancePolicy(evidence).explanation_detail, "guided");
  evidence = reduceLearningEvidence(
    evidence,
    scored("retrieval_scored", "2026-07-18T00:22:00.000Z", 8),
  );
  evidence = reduceLearningEvidence(evidence, {
    ...scored(
      "novel_application_scored",
      "2026-07-18T00:23:00.000Z",
      4,
      "novel-context-01",
    ),
    novel_context: true,
  });
  assert.equal(evidence.state, "retrieved_delayed");
  assert.equal(assistancePolicy(evidence).recovery_support, true);
  assert.equal(assistancePolicy(evidence).explanation_detail, "full");
  assert.equal(assistancePolicy(evidence).safety_checks_fade, false);
});

test("closed rubrics and events cannot represent raw learner prose", () => {
  assert.deepEqual(scoreTeachbackRubric(passRubric), {
    score: 6,
    fatal_misconception: false,
    passed: true,
  });
  assert.throws(
    () =>
      scoreTeachbackRubric({ ...passRubric, raw_response: "PRIVATE_CANARY" }),
    /exactly/u,
  );
  assert.throws(
    () =>
      validateLearningEvent({
        ...exposed("2026-07-18T00:00:00.000Z"),
        raw: "x",
      }),
    /exactly/u,
  );
  assert.throws(
    () =>
      reduceLearningEvidence(
        createLearningEvidence(conceptId),
        scored("teachback_scored", "2026-07-18T00:00:00.000Z", 8),
      ),
    /requires learning state exposed/u,
  );
  assert.throws(
    () =>
      validateLearningEvidence({
        evidence_version: 1,
        concept_id: conceptId,
        state: "explained_once",
        events: [],
        state_history: ["unseen", "exposed", "explained_once"],
        next_retrieval_after: null,
      }),
    /requires next_retrieval_after/u,
  );
});

/** @param {string} at */
function exposed(at) {
  return { type: "exposed", scenario_id: "S04", at };
}

/** @param {string} type @param {string} at @param {number} score @param {string} [scenarioId] */
function scored(type, at, score, scenarioId = "S04") {
  return {
    type,
    scenario_id: scenarioId,
    at,
    score,
    fatal_misconception: false,
  };
}
