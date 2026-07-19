import {
  assistancePolicy,
  createLearningEvidence,
  validateLearningEvidence,
} from "../learning/evidence.mjs";

export const MVP_WORD_TARGET = 120;
export const MVP_NEW_CONCEPT_LIMIT = 2;

/**
 * Select only concepts already attached to the reviewed scenario. The learner
 * record changes disclosure, never the canonical fact or execution permission.
 *
 * @param {Awaited<ReturnType<import("../analogy/engine.mjs").loadAnalogyRuntime>>} runtime
 * @param {{ scenarioId: string, evidenceRecords?: unknown[], safetyConceptIds?: string[] }} input
 */
export function selectInterventionConcepts(runtime, input) {
  const scenario = runtime.content.scenarios.find(
    (item) => item.scenario_id === input.scenarioId,
  );
  if (!scenario) throw new TypeError("unknown Fairytail scenario");
  const scenarioConceptIds = /** @type {string[]} */ (scenario.concept_ids);
  const safetyConceptIds = input.safetyConceptIds ?? [];
  if (
    !Array.isArray(safetyConceptIds) ||
    safetyConceptIds.some((id) => !scenarioConceptIds.includes(id))
  ) {
    throw new TypeError("safety concept ids must belong to the scenario");
  }

  /** @type {Map<string, ReturnType<typeof validateLearningEvidence>>} */
  const evidenceByConcept = new Map();
  for (const value of input.evidenceRecords ?? []) {
    const evidence = validateLearningEvidence(value);
    if (evidenceByConcept.has(evidence.concept_id)) {
      throw new TypeError("duplicate learning evidence record");
    }
    evidenceByConcept.set(evidence.concept_id, evidence);
  }

  const candidates = scenarioConceptIds.map((conceptId) => {
    const evidence =
      evidenceByConcept.get(conceptId) ?? createLearningEvidence(conceptId);
    const support = assistancePolicy(evidence);
    const safetyRequired = safetyConceptIds.includes(conceptId);
    return {
      concept_id: conceptId,
      state: evidence.state,
      new_concept: evidence.state === "unseen",
      safety_required: safetyRequired,
      disclosure: disclosureMode(evidence.state, support, safetyRequired),
      assistance: support,
    };
  });

  const normal = candidates
    .filter((candidate) => candidate.disclosure !== "hidden")
    .slice(0, MVP_NEW_CONCEPT_LIMIT);
  const selectedIds = new Set(normal.map((candidate) => candidate.concept_id));
  const safetyOverrides = candidates.filter(
    (candidate) =>
      candidate.safety_required && !selectedIds.has(candidate.concept_id),
  );
  const selected = [...normal, ...safetyOverrides];
  const faded = candidates
    .filter(
      (candidate) =>
        !selected.some((item) => item.concept_id === candidate.concept_id),
    )
    .map((candidate) => candidate.concept_id);
  const newConceptCount = selected.filter((item) => item.new_concept).length;

  return deepFreeze({
    selection_version: 1,
    scenario_id: input.scenarioId,
    selected,
    faded_concept_ids: faded,
    hypothesis: {
      label: "mvp_hypothesis_not_validated_learning_outcome",
      target_words: MVP_WORD_TARGET,
      max_new_concepts: MVP_NEW_CONCEPT_LIMIT,
      observed_new_concepts: newConceptCount,
      safety_can_exceed_limits: true,
    },
  });
}

/**
 * @param {string} state
 * @param {ReturnType<typeof assistancePolicy>} support
 * @param {boolean} safetyRequired
 */
function disclosureMode(state, support, safetyRequired) {
  if (support.recovery_support) return "full";
  if (state === "unseen" || state === "exposed") return "full";
  if (state === "explained_once") return "guided";
  if (state === "retrieved_delayed") return "compact";
  return safetyRequired ? "safety_only" : "hidden";
}

/** @template T @param {T} value @returns {Readonly<T>} */
function deepFreeze(value) {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
