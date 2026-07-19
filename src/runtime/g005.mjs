import { resolve as resolvePath } from "node:path";

import { loadAnalogyRuntimeSafe, resolveAnalogy } from "../analogy/engine.mjs";
import { renderScenarioForLocale } from "../locale/present.mjs";
import {
  assistancePolicy,
  scoreTeachbackRubric,
} from "../learning/evidence.mjs";
import {
  appendLearningEvent,
  dueLearningEvidence,
  loadLearningEvidenceStore,
} from "../learning/store.mjs";
import { loadProfile } from "../profile/store.mjs";
import {
  renderInterventionSurface,
  validateSurfaceInput,
} from "../intervention/render.mjs";
import { selectInterventionConcepts } from "../intervention/select.mjs";

export const G005_RUNTIME_SCHEMA_VERSION = 1;

const OPTIONS_KEYS = ["pluginRoot", "dataDir", "input"];
const OBSERVATION_KEYS = [
  "schema_version",
  "observation",
  "concept_id",
  "scenario_id",
  "at",
  "novel_context",
  "rubric",
];
const CONCEPT_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const SCENARIO_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/u;
const NOVEL_CONTEXT_PATTERN = /^ctx-[a-f0-9]{16}$/u;

/**
 * Render and locally record first exposure for a before/error/finish surface.
 * This boundary performs no model, network, tool, or action execution.
 *
 * @param {unknown} value
 * @param {Date} [now]
 */
export async function prepareG005Surface(value, now = new Date()) {
  const options = validateOptions(value);
  const input = validateSurfaceInput(options.input);
  const [safeRuntime, profile, learning] = await Promise.all([
    loadAnalogyRuntimeSafe(options.pluginRoot),
    loadProfile(options.dataDir),
    loadLearningEvidenceStore(options.dataDir),
  ]);
  const runtime = safeRuntime.runtime;
  const resolution = await resolveAnalogy(runtime, {
    profile: profile.profile,
    scenarioId: input.scenario_id,
    dataDir: options.dataDir,
  });
  const localized = renderScenarioForLocale(
    runtime,
    input.scenario_id,
    resolution,
    input.requested_locale,
  );
  const selection = selectInterventionConcepts(runtime, {
    scenarioId: input.scenario_id,
    evidenceRecords: learning.records,
  });
  const card = renderInterventionSurface(
    runtime,
    localized,
    selection,
    input,
    now,
  );

  let recordedExposures = 0;
  let persistenceStatus = "ok";
  if (learning.reason === "invalid-store") {
    persistenceStatus = "invalid-store-not-modified";
  } else {
    for (const concept of selection.selected) {
      if (concept.state !== "unseen") continue;
      try {
        await appendLearningEvent(options.dataDir, {
          concept_id: concept.concept_id,
          event: {
            type: "exposed",
            scenario_id: input.scenario_id,
            at: now.toISOString(),
          },
        });
        recordedExposures += 1;
      } catch {
        persistenceStatus = "write-failed";
        break;
      }
    }
  }

  return deepFreeze({
    schema_version: G005_RUNTIME_SCHEMA_VERSION,
    status: "ready",
    card,
    learning: {
      persistence: persistenceStatus,
      exposures_recorded: recordedExposures,
      execution_permission_changed: false,
    },
    effects: {
      network_calls: resolution.network_calls,
      model_calls: 0,
      action_execution_calls: 0,
    },
  });
}

/**
 * Store a scored observation without storing the learner's raw words.
 *
 * @param {unknown} value
 */
export async function recordG005Observation(value, now = new Date()) {
  const options = validateOptions(value);
  const input = validateObservationInput(options.input);
  const safeRuntime = await loadAnalogyRuntimeSafe(options.pluginRoot);
  const concepts = safeRuntime.runtime.content.concepts;
  if (!concepts.some((concept) => concept.id === input.concept_id)) {
    throw new TypeError("learning observation concept is not published");
  }
  const scenario = safeRuntime.runtime.content.scenarios.find(
    (candidate) => candidate.scenario_id === input.scenario_id,
  );
  if (
    input.observation !== "novel_application" &&
    (!scenario ||
      !(
        /** @type {string[]} */ (scenario.concept_ids).includes(
          input.concept_id,
        )
      ))
  ) {
    throw new TypeError(
      "learning observation concept must belong to the reviewed scenario",
    );
  }
  if (Date.parse(input.at) > now.getTime()) {
    throw new TypeError("learning observation cannot be dated in the future");
  }
  if (input.observation === "novel_application") {
    const learning = await loadLearningEvidenceStore(options.dataDir);
    if (learning.reason === "invalid-store") {
      throw new TypeError(
        "Fairytail learning store is invalid and was not modified",
      );
    }
    const prior = learning.records.find(
      (record) => record.concept_id === input.concept_id,
    );
    const priorEvents = /** @type {Record<string, any>[]} */ (
      prior?.events ?? []
    );
    const priorScenarioIds = new Set(
      priorEvents.map((event) => event.scenario_id),
    );
    if (
      !prior ||
      !new Set(["retrieved_delayed", "applied_novel"]).has(prior.state)
    ) {
      throw new TypeError(
        "novel application requires prior delayed retrieval evidence",
      );
    }
    if (priorScenarioIds.has(input.scenario_id)) {
      throw new TypeError(
        "novel application requires a different bounded context identifier",
      );
    }
  }
  const score = scoreTeachbackRubric(input.rubric);
  const eventType =
    input.observation === "teachback"
      ? "teachback_scored"
      : input.observation === "retrieval"
        ? "retrieval_scored"
        : "novel_application_scored";
  const event = {
    type: eventType,
    scenario_id: input.scenario_id,
    at: input.at,
    score: score.score,
    fatal_misconception: score.fatal_misconception,
    ...(input.observation === "novel_application"
      ? { novel_context: input.novel_context }
      : {}),
  };
  const stored = await appendLearningEvent(options.dataDir, {
    concept_id: input.concept_id,
    event,
  });
  const support = assistancePolicy(stored.record);
  return deepFreeze({
    schema_version: G005_RUNTIME_SCHEMA_VERSION,
    status: "recorded",
    concept_id: input.concept_id,
    observation: input.observation,
    score: score.score,
    passed: score.passed,
    fatal_misconception: score.fatal_misconception,
    learning_state: stored.record.state,
    next_retrieval_after: stored.record.next_retrieval_after,
    assistance: support,
    execution_permission_changed: false,
    raw_response_stored: false,
  });
}

/**
 * Return due prompts only. A due prompt never blocks work and contains no raw
 * learning history.
 *
 * @param {{ pluginRoot: string, dataDir: string, requestedLocale?: unknown }} value
 * @param {Date} [now]
 */
export async function reviewDueG005(value, now = new Date()) {
  const input = plainRecord(value, "G005 review options");
  exactKeys(
    input,
    ["pluginRoot", "dataDir", "requestedLocale"],
    "G005 review options",
  );
  const pluginRoot = localPath(input.pluginRoot, "pluginRoot");
  const dataDir = localPath(input.dataDir, "dataDir");
  const requestedLocale = input.requestedLocale;
  if (
    requestedLocale !== null &&
    requestedLocale !== undefined &&
    (typeof requestedLocale !== "string" || requestedLocale.length > 35)
  ) {
    throw new TypeError("requestedLocale is invalid");
  }
  const [safeRuntime, due] = await Promise.all([
    loadAnalogyRuntimeSafe(pluginRoot),
    dueLearningEvidence(dataDir, now),
  ]);
  const runtime = safeRuntime.runtime;
  /** @type {Record<string, any>[]} */
  const prompts = [];
  for (const evidence of due.slice(0, 3)) {
    const events = /** @type {Record<string, any>[]} */ (evidence.events);
    const scenarioId = [...events]
      .reverse()
      .find((event) => /^S\d{2}$/u.test(event.scenario_id))?.scenario_id;
    if (!scenarioId) continue;
    const rendered = renderScenarioForLocale(
      runtime,
      scenarioId,
      {
        kind: "neutral",
        reason: "retrieval-review",
        profile_projection_calls: 0,
        network_calls: 0,
      },
      requestedLocale,
    );
    prompts.push({
      concept_id: evidence.concept_id,
      scenario_id: scenarioId,
      due_at: evidence.next_retrieval_after,
      question: /** @type {Record<string, any>} */ (rendered.content)
        .diagnostic_or_teachback.question,
      skippable: true,
      blocks_work: false,
    });
  }
  return deepFreeze({
    schema_version: G005_RUNTIME_SCHEMA_VERSION,
    status: "ready",
    due_count: due.length,
    returned_count: prompts.length,
    prompts,
    raw_history_included: false,
  });
}

/** @param {string} pluginRoot */
export async function listG005Scenarios(pluginRoot) {
  const safeRuntime = await loadAnalogyRuntimeSafe(
    localPath(pluginRoot, "pluginRoot"),
  );
  return deepFreeze({
    schema_version: G005_RUNTIME_SCHEMA_VERSION,
    scenarios: safeRuntime.runtime.content.scenarios.map((scenario) => ({
      scenario_id: scenario.scenario_id,
      title: scenario.title,
      encounter: scenario.encounter,
      concept_ids: [.../** @type {string[]} */ (scenario.concept_ids)],
    })),
  });
}

/** @param {unknown} value */
function validateOptions(value) {
  const options = plainRecord(value, "G005 runtime options");
  exactKeys(options, OPTIONS_KEYS, "G005 runtime options");
  return {
    pluginRoot: localPath(options.pluginRoot, "pluginRoot"),
    dataDir: localPath(options.dataDir, "dataDir"),
    input: options.input,
  };
}

/** @param {unknown} value */
function validateObservationInput(value) {
  const input = structuredClone(plainRecord(value, "G005 observation input"));
  exactKeys(input, OBSERVATION_KEYS, "G005 observation input");
  if (input.schema_version !== G005_RUNTIME_SCHEMA_VERSION) {
    throw new TypeError("unsupported G005 observation schema version");
  }
  if (
    !new Set(["teachback", "retrieval", "novel_application"]).has(
      input.observation,
    )
  ) {
    throw new TypeError("G005 observation type is invalid");
  }
  if (typeof input.novel_context !== "boolean") {
    throw new TypeError("G005 observation novel_context must be boolean");
  }
  if ((input.observation === "novel_application") !== input.novel_context) {
    throw new TypeError(
      "novel_context is true only for observed novel application",
    );
  }
  if (
    input.observation === "novel_application" &&
    !NOVEL_CONTEXT_PATTERN.test(input.scenario_id)
  ) {
    throw new TypeError("novel application requires an opaque ctx identifier");
  }
  if (
    typeof input.concept_id !== "string" ||
    !CONCEPT_PATTERN.test(input.concept_id)
  ) {
    throw new TypeError("G005 observation concept_id is invalid");
  }
  if (
    typeof input.scenario_id !== "string" ||
    !SCENARIO_PATTERN.test(input.scenario_id)
  ) {
    throw new TypeError("G005 observation scenario_id is invalid");
  }
  if (
    typeof input.at !== "string" ||
    !Number.isFinite(Date.parse(input.at)) ||
    new Date(input.at).toISOString() !== input.at
  ) {
    throw new TypeError(
      "G005 observation at must be a canonical ISO date-time",
    );
  }
  scoreTeachbackRubric(input.rubric);
  return deepFreeze(input);
}

/** @param {unknown} value @param {string} label */
function localPath(value, label) {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.length === 0 ||
    value.includes("\0") ||
    /^[A-Za-z][A-Za-z\d+.-]*:/u.test(value)
  ) {
    throw new TypeError(`${label} must be a local filesystem path`);
  }
  return resolvePath(value);
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
