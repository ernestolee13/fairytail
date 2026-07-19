import { stableStringify } from "../content/stable-json.mjs";
import { isLocallyResolvedCatalogResolution } from "./engine.mjs";
import { isLocallyValidatedPersonalizedResolution } from "./personalized.mjs";

export const RENDER_SECTION_KEYS = [
  "canonical_definition",
  "current_encounter",
  "analogy_or_neutral_fallback",
  "analogy_breakpoint",
  "target_side_effect_risk_rollback",
  "one_next_action_and_evidence",
  "diagnostic_or_teachback",
  "protocol_fact_and_fairytail_policy_labels",
];

/**
 * Canonical facts are copied directly from versioned content after analogy
 * selection. No mapping field can override this block.
 *
 * @param {Awaited<ReturnType<import("./engine.mjs").loadAnalogyRuntime>>} runtime
 * @param {string} scenarioId
 * @param {import("./engine.mjs").AnalogyResolution} resolution
 */
export function renderScenario(runtime, scenarioId, resolution) {
  const scenario = runtime.content.scenarios.find(
    (item) => item.scenario_id === scenarioId,
  );
  if (!scenario)
    throw new TypeError(`Unknown Fairytail scenario: ${scenarioId}`);
  const conceptIds = /** @type {string[]} */ (scenario.concept_ids);
  const cards = conceptIds.map((conceptId) => {
    const card = runtime.content.concepts.find((item) => item.id === conceptId);
    if (!card) throw new TypeError(`Unknown Fairytail concept: ${conceptId}`);
    return card;
  });
  const factSetHash = /** @type {string} */ (
    /** @type {Record<string, unknown>} */ (
      runtime.content.scenario_fact_hashes
    )[scenarioId]
  );
  const effectiveResolution = publishableResolution(
    runtime,
    scenarioId,
    resolution,
  );
  const analogy = analogySection(cards, effectiveResolution);
  const breakpoint = breakpointSection(effectiveResolution);

  const output = {
    canonical_definition: {
      content_version: runtime.content.content_version,
      canonical_fact_set_hash: factSetHash,
      concepts: cards.map((card) => ({
        concept_id: card.id,
        canonical_definition: card.canonical_definition,
        mechanism: structuredClone(card.mechanism),
        safety_boundary: structuredClone(card.safety_boundary),
      })),
    },
    current_encounter: {
      scenario_id: scenarioId,
      reason: scenario.encounter,
      fixed_criterion: scenario.fixed_criterion,
    },
    analogy_or_neutral_fallback: analogy,
    analogy_breakpoint: breakpoint,
    target_side_effect_risk_rollback: structuredClone(scenario.pre_action),
    one_next_action_and_evidence: {
      action: scenario.next_action,
      evidence: scenario.evidence,
    },
    diagnostic_or_teachback: {
      question: scenario.diagnostic_question,
    },
    protocol_fact_and_fairytail_policy_labels: structuredClone(
      scenario.policy_labels,
    ),
  };
  return deepFreeze(output);
}

/**
 * @param {Awaited<ReturnType<import("./engine.mjs").loadAnalogyRuntime>>} runtime
 * @param {string} scenarioId
 * @param {import("./engine.mjs").AnalogyResolution} resolution
 */
function publishableResolution(runtime, scenarioId, resolution) {
  if (resolution.kind !== "mapped") return resolution;
  if (resolution.source === "profile-adapter") {
    if (
      isLocallyValidatedPersonalizedResolution(resolution) &&
      /** @type {Record<string, unknown>} */ (resolution).scenario_id ===
        scenarioId
    ) {
      return resolution;
    }
    return {
      kind: /** @type {const} */ ("neutral"),
      reason: "untrusted-personalized-mapping",
      profile_projection_calls: resolution.profile_projection_calls,
      network_calls: /** @type {const} */ (0),
    };
  }
  const mapping = runtime.publication.mappings.find(
    (item) => item.mapping_id === resolution.mapping_id,
  );
  if (
    !isLocallyResolvedCatalogResolution(resolution) ||
    !mapping ||
    mapping.scenario_id !== scenarioId ||
    runtime.publication.mappingHashes[resolution.mapping_id] !==
      resolution.mapping_hash ||
    mapping.validation_status !== "validated"
  ) {
    return {
      kind: /** @type {const} */ ("neutral"),
      reason: "unpublishable-mapping",
      profile_projection_calls: resolution.profile_projection_calls,
      network_calls: /** @type {const} */ (0),
    };
  }
  const contract = runtime.publication.contracts.find(
    (item) => item.concept_id === mapping.concept_id,
  );
  const card = runtime.content.concepts.find(
    (item) => item.id === mapping.concept_id,
  );
  if (!contract || !card) {
    return {
      kind: /** @type {const} */ ("neutral"),
      reason: "unpublishable-mapping",
      profile_projection_calls: resolution.profile_projection_calls,
      network_calls: /** @type {const} */ (0),
    };
  }
  const roleMap = /** @type {Record<string, string>} */ (mapping.role_map);
  const relations = /** @type {Record<string, unknown>[]} */ (
    contract.required_relations
  ).map((relation) => ({
    relation_id: /** @type {string} */ (relation.relation_id),
    from_role: /** @type {string} */ (relation.from_role),
    from_target: roleMap[/** @type {string} */ (relation.from_role)],
    relation: /** @type {string} */ (relation.relation),
    to_role: /** @type {string} */ (relation.to_role),
    to_target: roleMap[/** @type {string} */ (relation.to_role)],
  }));
  return {
    kind: /** @type {const} */ ("mapped"),
    reason: /** @type {const} */ ("validated-catalog"),
    mapping_id: /** @type {string} */ (mapping.mapping_id),
    mapping_version: /** @type {number} */ (mapping.mapping_version),
    mapping_hash: /** @type {string} */ (
      runtime.publication.mappingHashes[resolution.mapping_id]
    ),
    profile_world_id: /** @type {string} */ (mapping.profile_world_id),
    analogy_concept_id: /** @type {string} */ (mapping.concept_id),
    analogy_label: /** @type {string} */ (mapping.analogy_label),
    role_map: structuredClone(roleMap),
    relations,
    non_mappings: structuredClone(
      /** @type {string[]} */ (mapping.non_mappings),
    ),
    breakpoint: /** @type {string} */ (card.analogy_breakpoint),
    neutral_fallback: /** @type {string} */ (card.neutral_example),
    controls: ["different", "no_analogy", "unfamiliar"],
    source: resolution.source,
    profile_projection_calls: resolution.profile_projection_calls,
    network_calls: /** @type {const} */ (0),
  };
}

/** @param {Record<string, unknown>[]} cards @param {import("./engine.mjs").AnalogyResolution} resolution */
function analogySection(cards, resolution) {
  const neutralExamples = cards.map((card) => ({
    concept_id: card.id,
    example: card.neutral_example,
  }));
  if (resolution.kind === "mapped") {
    return {
      kind: "mapped",
      mapping_id: resolution.mapping_id,
      analogy_concept_id: resolution.analogy_concept_id,
      profile_world_id: resolution.profile_world_id,
      label: resolution.analogy_label,
      role_map: structuredClone(resolution.role_map),
      preserved_relations: structuredClone(resolution.relations),
      neutral_comparison: neutralExamples,
      controls: [...resolution.controls],
    };
  }
  if (resolution.kind === "none") {
    return {
      kind: "none",
      reason: resolution.reason,
      neutral_comparison: [],
      controls: ["use_neutral_explanation"],
    };
  }
  return {
    kind: "neutral",
    reason: resolution.reason,
    neutral_comparison: neutralExamples,
    controls: ["no_analogy"],
  };
}

/** @param {import("./engine.mjs").AnalogyResolution} resolution */
function breakpointSection(resolution) {
  if (resolution.kind === "mapped") {
    return {
      kind: "mapped-limit",
      non_mappings: [...resolution.non_mappings],
      breakpoint: resolution.breakpoint,
    };
  }
  return {
    kind: "not-applicable",
    reason: "no-personalized-analogy-shown",
  };
}

/** @param {ReturnType<typeof renderScenario>} output */
export function stableRenderBytes(output) {
  return Buffer.from(stableStringify(output), "utf8");
}

/** @template T @param {T} value @returns {Readonly<T>} */
function deepFreeze(value) {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
