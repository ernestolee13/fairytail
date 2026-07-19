export const LEARNING_EVIDENCE_VERSION = 1;
export const LEARNING_PASS_SCORE = 6;
export const DEFAULT_RETRIEVAL_DELAY_MS = 20 * 60 * 1000;

export const LEARNING_STATES = Object.freeze([
  "unseen",
  "exposed",
  "explained_once",
  "retrieved_delayed",
  "applied_novel",
]);

const EVIDENCE_KEYS = [
  "evidence_version",
  "concept_id",
  "state",
  "events",
  "state_history",
  "next_retrieval_after",
];
const RUBRIC_KEYS = [
  "role_and_flow",
  "confusion_boundary",
  "analogy_limit",
  "safe_next_action",
  "fatal_misconception",
];
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/u;
const CONCEPT_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

/** @param {string} conceptId */
export function createLearningEvidence(conceptId) {
  conceptIdentifier(conceptId, "concept_id");
  return deepFreeze({
    evidence_version: LEARNING_EVIDENCE_VERSION,
    concept_id: conceptId,
    state: "unseen",
    events: [],
    state_history: ["unseen"],
    next_retrieval_after: null,
  });
}

/**
 * Store only a closed, evidence-oriented rubric. Raw teach-back prose never
 * crosses this reducer or enters the local event log.
 *
 * @param {unknown} value
 */
export function scoreTeachbackRubric(value) {
  const rubric = plainRecord(value, "teach-back rubric");
  exactKeys(rubric, RUBRIC_KEYS, "teach-back rubric");
  for (const key of RUBRIC_KEYS.slice(0, 4)) {
    if (!Number.isInteger(rubric[key]) || rubric[key] < 0 || rubric[key] > 2) {
      throw new TypeError(`teach-back rubric.${key} must be 0, 1, or 2`);
    }
  }
  if (typeof rubric.fatal_misconception !== "boolean") {
    throw new TypeError(
      "teach-back rubric.fatal_misconception must be boolean",
    );
  }
  const score = RUBRIC_KEYS.slice(0, 4).reduce(
    (total, key) => total + Number(rubric[key]),
    0,
  );
  return deepFreeze({
    score,
    fatal_misconception: rubric.fatal_misconception,
    passed: score >= LEARNING_PASS_SCORE && !rubric.fatal_misconception,
  });
}

/**
 * Apply one observed learning event. State is monotonic and intentionally has
 * no `mastered` value. Execution permission is outside this data structure.
 *
 * @param {unknown} evidenceValue
 * @param {unknown} eventValue
 * @param {{ retrievalDelayMs?: number }} [options]
 */
export function reduceLearningEvidence(
  evidenceValue,
  eventValue,
  options = {},
) {
  const evidence = validateLearningEvidence(evidenceValue);
  const event = validateLearningEvent(eventValue);
  const delay = options.retrievalDelayMs ?? DEFAULT_RETRIEVAL_DELAY_MS;
  if (!Number.isInteger(delay) || delay < 60_000 || delay > 7 * 86_400_000) {
    throw new TypeError(
      "retrievalDelayMs must be between one minute and seven days",
    );
  }
  const prior = evidence.events.at(-1);
  if (prior && Date.parse(event.at) < Date.parse(prior.at)) {
    throw new TypeError("learning events must be chronological");
  }

  let nextState = evidence.state;
  let nextRetrieval = evidence.next_retrieval_after;
  if (event.type === "exposed") {
    if (evidence.state === "unseen") nextState = "exposed";
  } else if (event.type === "teachback_scored") {
    requireAtLeastState(evidence.state, "exposed", event.type);
    if (evidence.state === "exposed" && qualifies(event)) {
      nextState = "explained_once";
      nextRetrieval = new Date(Date.parse(event.at) + delay).toISOString();
    }
  } else if (event.type === "retrieval_scored") {
    requireAtLeastState(evidence.state, "explained_once", event.type);
    if (evidence.state === "explained_once") {
      if (
        evidence.next_retrieval_after === null ||
        Date.parse(event.at) < Date.parse(evidence.next_retrieval_after)
      ) {
        throw new TypeError(
          "delayed retrieval evidence was recorded before it was due",
        );
      }
      if (qualifies(event)) {
        nextState = "retrieved_delayed";
        nextRetrieval = null;
      } else {
        nextRetrieval = new Date(Date.parse(event.at) + delay).toISOString();
      }
    }
  } else {
    requireAtLeastState(evidence.state, "retrieved_delayed", event.type);
    if (event.novel_context !== true) {
      throw new TypeError("novel application requires novel_context=true");
    }
    if (evidence.state === "retrieved_delayed" && qualifies(event)) {
      nextState = "applied_novel";
    }
  }

  const stateHistory = [...evidence.state_history];
  if (nextState !== evidence.state) stateHistory.push(nextState);
  const result = {
    evidence_version: LEARNING_EVIDENCE_VERSION,
    concept_id: evidence.concept_id,
    state: nextState,
    events: [...evidence.events, event],
    state_history: stateHistory,
    next_retrieval_after: nextRetrieval,
  };
  return validateLearningEvidence(result);
}

/** @param {unknown} value */
export function validateLearningEvidence(value) {
  const evidence = structuredClone(plainRecord(value, "learning evidence"));
  exactKeys(evidence, EVIDENCE_KEYS, "learning evidence");
  if (evidence.evidence_version !== LEARNING_EVIDENCE_VERSION) {
    throw new TypeError("unsupported learning evidence version");
  }
  conceptIdentifier(evidence.concept_id, "learning evidence.concept_id");
  if (!LEARNING_STATES.includes(evidence.state)) {
    throw new TypeError("learning evidence state is invalid");
  }
  if (!Array.isArray(evidence.events)) {
    throw new TypeError("learning evidence.events must be an array");
  }
  evidence.events = evidence.events.map(validateLearningEvent);
  for (let index = 1; index < evidence.events.length; index += 1) {
    if (
      Date.parse(evidence.events[index].at) <
      Date.parse(evidence.events[index - 1].at)
    ) {
      throw new TypeError("learning evidence events must be chronological");
    }
  }
  if (!Array.isArray(evidence.state_history)) {
    throw new TypeError("learning evidence.state_history must be an array");
  }
  const expectedHistory = LEARNING_STATES.slice(
    0,
    LEARNING_STATES.indexOf(evidence.state) + 1,
  );
  if (
    evidence.state_history.length !== expectedHistory.length ||
    evidence.state_history.some(
      (state, index) => state !== expectedHistory[index],
    )
  ) {
    throw new TypeError("learning evidence state_history must be monotonic");
  }
  if (evidence.next_retrieval_after !== null) {
    dateTime(
      evidence.next_retrieval_after,
      "learning evidence.next_retrieval_after",
    );
    if (evidence.state !== "explained_once") {
      throw new TypeError(
        "next_retrieval_after is valid only for explained_once",
      );
    }
  } else if (evidence.state === "explained_once") {
    throw new TypeError(
      "explained_once learning evidence requires next_retrieval_after",
    );
  }
  return deepFreeze(evidence);
}

/** @param {unknown} value */
export function validateLearningEvent(value) {
  const event = structuredClone(plainRecord(value, "learning event"));
  const scored = event.type !== "exposed";
  const novel = event.type === "novel_application_scored";
  const expected = ["type", "scenario_id", "at"];
  if (scored) expected.push("score", "fatal_misconception");
  if (novel) expected.push("novel_context");
  exactKeys(event, expected, "learning event");
  if (
    ![
      "exposed",
      "teachback_scored",
      "retrieval_scored",
      "novel_application_scored",
    ].includes(event.type)
  ) {
    throw new TypeError("learning event type is invalid");
  }
  identifier(event.scenario_id, "learning event.scenario_id");
  dateTime(event.at, "learning event.at");
  if (scored) {
    if (!Number.isInteger(event.score) || event.score < 0 || event.score > 8) {
      throw new TypeError(
        "learning event score must be an integer from 0 to 8",
      );
    }
    if (typeof event.fatal_misconception !== "boolean") {
      throw new TypeError("learning event fatal_misconception must be boolean");
    }
  }
  if (novel && event.novel_context !== true) {
    throw new TypeError("novel application event requires novel_context=true");
  }
  return deepFreeze(event);
}

/**
 * Assistance may shrink only after observed evidence. A later failed score
 * restores full teaching support. Safety content and checks never fade.
 *
 * @param {unknown} evidenceValue
 */
export function assistancePolicy(evidenceValue) {
  const evidence = validateLearningEvidence(evidenceValue);
  const latestScore = [...evidence.events]
    .reverse()
    .find((event) => event.type !== "exposed");
  const recovery =
    latestScore !== undefined &&
    (latestScore.score < LEARNING_PASS_SCORE ||
      latestScore.fatal_misconception === true);
  /** @type {Record<string, string>} */
  const detailByState = {
    unseen: "full",
    exposed: "full",
    explained_once: "guided",
    retrieved_delayed: "compact",
    applied_novel: "minimal",
  };
  /** @type {Record<string, string>} */
  const exampleByState = {
    unseen: "worked_example",
    exposed: "worked_example",
    explained_once: "guided_steps",
    retrieved_delayed: "hint_only",
    applied_novel: "on_request",
  };
  return deepFreeze({
    policy_version: 1,
    basis_state: evidence.state,
    recovery_support: recovery,
    explanation_detail: recovery ? "full" : detailByState[evidence.state],
    example_support: recovery
      ? "worked_example"
      : exampleByState[evidence.state],
    safety_detail: "full",
    safety_checks_fade: false,
  });
}

/** @param {unknown} evidenceValue @param {Date} [now] */
export function retrievalIsDue(evidenceValue, now = new Date()) {
  const evidence = validateLearningEvidence(evidenceValue);
  return (
    evidence.state === "explained_once" &&
    evidence.next_retrieval_after !== null &&
    now.getTime() >= Date.parse(evidence.next_retrieval_after)
  );
}

/** @param {Record<string, any>} event */
function qualifies(event) {
  return (
    event.score >= LEARNING_PASS_SCORE && event.fatal_misconception === false
  );
}

/** @param {string} actual @param {string} minimum @param {string} type */
function requireAtLeastState(actual, minimum, type) {
  if (LEARNING_STATES.indexOf(actual) < LEARNING_STATES.indexOf(minimum)) {
    throw new TypeError(`${type} requires learning state ${minimum} or later`);
  }
}

/** @param {unknown} value @param {string} label */
function conceptIdentifier(value, label) {
  if (typeof value !== "string" || !CONCEPT_PATTERN.test(value)) {
    throw new TypeError(`${label} must be a concept identifier`);
  }
}

/** @param {unknown} value @param {string} label */
function identifier(value, label) {
  if (typeof value !== "string" || !IDENTIFIER_PATTERN.test(value)) {
    throw new TypeError(`${label} must be a bounded identifier`);
  }
}

/** @param {unknown} value @param {string} label */
function dateTime(value, label) {
  if (
    typeof value !== "string" ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    throw new TypeError(`${label} must be a canonical ISO date-time`);
  }
}

/** @param {unknown} value @param {string} label */
function plainRecord(value, label) {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new TypeError(`${label} must be a plain object`);
  }
  return /** @type {Record<string, any>} */ (value);
}

/** @param {Record<string, any>} value @param {ReadonlyArray<string>} keys @param {string} label */
function exactKeys(value, keys, label) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new TypeError(
      `${label} must contain exactly: ${expected.join(", ")}`,
    );
  }
}

/** @template T @param {T} value @returns {Readonly<T>} */
function deepFreeze(value) {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
