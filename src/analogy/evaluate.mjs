import { sha256, stableStringify } from "../content/stable-json.mjs";
import { approvePersonalization } from "../profile/privacy.mjs";
import { PROJECTION_FIELDS } from "../profile/profile.mjs";
import { resolveAnalogy } from "./engine.mjs";
import {
  RENDER_SECTION_KEYS,
  renderScenario,
  stableRenderBytes,
} from "./render.mjs";

export const SCORE_DIMENSIONS = [
  "fact_invariance",
  "concept_selection",
  "analogy_relation",
  "breakpoint",
  "actionability",
  "safety",
  "learning_question",
  "compression",
];

const REQUIRED_CONFUSION_CHECKS = {
  token_variants: ["api-credentials-llm-token", "api-key-access-token"],
  api_mcp: ["api-mcp"],
  server_database: ["server-database"],
  authentication_authorization: ["authentication-authorization"],
  repository_folder: ["repository-folder-project"],
  push_deploy: ["push-deploy"],
};

/**
 * Scores the actual deterministic renderer trace. No score is read from the
 * fixture and no prewritten pass value is trusted.
 *
 * @param {Awaited<ReturnType<import("./engine.mjs").loadAnalogyRuntime>>} runtime
 * @param {Date} [now]
 */
export async function evaluateGoldenCases(
  runtime,
  now = new Date("2026-07-18T12:00:00.000Z"),
) {
  const results = [];
  /** @type {Map<string, string>} */
  const canonicalBytesByScenario = new Map();

  for (const fixtureCase of runtime.content.cases) {
    const profileId = /** @type {string} */ (fixtureCase.profile_id);
    const scenarioId = /** @type {string} */ (fixtureCase.scenario_id);
    const fixtureProfile = runtime.content.profiles.find(
      (profile) => profile.profile_id === profileId,
    );
    if (!fixtureProfile) throw new TypeError(`Missing profile ${profileId}`);
    const profile = approvedRuntimeProfile(fixtureProfile, now);
    const resolution = await resolveAnalogy(runtime, {
      profile,
      scenarioId,
      choice: "preferred",
      // G004 is a frozen regression corpus for the three reviewed seed
      // fixtures. Production personalization never enters this catalog path.
      regressionCatalog: true,
    });
    const rendered = renderScenario(runtime, scenarioId, resolution);
    const scored = scoreRenderedCase(
      runtime,
      fixtureCase,
      rendered,
      resolution,
    );
    const canonicalBytes = stableStringify(rendered.canonical_definition);
    const priorBytes = canonicalBytesByScenario.get(scenarioId);
    if (priorBytes !== undefined && priorBytes !== canonicalBytes) {
      scored.hard_failures.push("profile-dependent-canonical-facts");
      scored.scores.fact_invariance = 0;
      scored.total = totalScore(scored.scores);
    } else {
      canonicalBytesByScenario.set(scenarioId, canonicalBytes);
    }
    results.push(scored);
  }

  const totals = results.map((result) => result.total);
  const hardFailureCount = results.reduce(
    (sum, result) => sum + result.hard_failures.length,
    0,
  );
  const average = totals.reduce((sum, value) => sum + value, 0) / totals.length;
  const factInvariancePerfect = results.every(
    (result) => result.scores.fact_invariance === 2,
  );
  const confusionChecks = evaluateConfusionChecks(runtime);
  const thresholds = {
    case_count_30: results.length === 30,
    hard_failures_0: hardFailureCount === 0,
    fact_invariance_30_of_30: factInvariancePerfect,
    every_case_at_least_13: totals.every((value) => value >= 13),
    average_at_least_14: average >= 14,
    required_confusions_pass: Object.values(confusionChecks).every(Boolean),
  };

  return {
    evaluation_version: 1,
    evaluator: "fairytail-deterministic-g004-v1",
    content_version: runtime.content.content_version,
    contract_version: runtime.publication.contractVersion,
    catalog_version: runtime.publication.catalogVersion,
    renderer_version: runtime.renderer_version,
    cases: results,
    summary: {
      case_count: results.length,
      hard_failure_count: hardFailureCount,
      minimum_score: Math.min(...totals),
      average_score: average,
      fact_invariance_perfect_count: results.filter(
        (result) => result.scores.fact_invariance === 2,
      ).length,
      profile_projection_calls: results.reduce(
        (sum, result) => sum + result.profile_projection_calls,
        0,
      ),
      network_calls: results.reduce(
        (sum, result) => sum + result.network_calls,
        0,
      ),
      execution_calls: 0,
    },
    confusion_checks: confusionChecks,
    thresholds,
    status: Object.values(thresholds).every(Boolean) ? "pass" : "fail",
  };
}

/**
 * @param {Awaited<ReturnType<import("./engine.mjs").loadAnalogyRuntime>>} runtime
 * @param {Record<string, unknown>} fixtureCase
 * @param {ReturnType<typeof renderScenario>} rendered
 * @param {import("./engine.mjs").AnalogyResolution} resolution
 */
export function scoreRenderedCase(runtime, fixtureCase, rendered, resolution) {
  const scenarioId = /** @type {string} */ (fixtureCase.scenario_id);
  const scenario = runtime.content.scenarios.find(
    (item) => item.scenario_id === scenarioId,
  );
  if (!scenario) throw new TypeError(`Missing scenario ${scenarioId}`);
  const expectedConceptIds = /** @type {string[]} */ (scenario.concept_ids);
  const actualConcepts = /** @type {Record<string, unknown>[]} */ (
    rendered.canonical_definition.concepts
  );
  const actualConceptIds = actualConcepts.map((item) =>
    String(item.concept_id),
  );
  /** @type {Record<string, number>} */
  const scores = Object.fromEntries(SCORE_DIMENSIONS.map((name) => [name, 0]));
  /** @type {string[]} */
  const hardFailures = [];

  const expectedFactHash = /** @type {string} */ (
    /** @type {Record<string, unknown>} */ (
      runtime.content.scenario_fact_hashes
    )[scenarioId]
  );
  const canonicalMatches =
    rendered.canonical_definition.content_version ===
      runtime.content.content_version &&
    rendered.canonical_definition.canonical_fact_set_hash ===
      expectedFactHash &&
    expectedFactHash === fixtureCase.canonical_fact_set_hash &&
    stableStringify(actualConceptIds) === stableStringify(expectedConceptIds) &&
    actualConcepts.every((actual, index) => {
      const card = runtime.content.concepts.find(
        (item) => item.id === expectedConceptIds[index],
      );
      return (
        card !== undefined &&
        actual.canonical_definition === card.canonical_definition &&
        stableStringify(actual.mechanism) === stableStringify(card.mechanism) &&
        stableStringify(actual.safety_boundary) ===
          stableStringify(card.safety_boundary)
      );
    });
  scores.fact_invariance = canonicalMatches ? 2 : 0;
  if (!canonicalMatches) hardFailures.push("canonical-fact-drift");

  const conceptExact =
    stableStringify(actualConceptIds) === stableStringify(expectedConceptIds);
  scores.concept_selection = conceptExact
    ? 2
    : actualConceptIds.some((id) => expectedConceptIds.includes(id))
      ? 1
      : 0;
  if (
    expectedConceptIds.some((id) => !actualConceptIds.includes(id)) &&
    /secret|permission|deploy|database|credential/iu.test(
      String(scenario.fixed_criterion),
    )
  ) {
    hardFailures.push("risk-concept-missing");
  }

  const relationScore = scoreAnalogyRelation(
    runtime,
    scenarioId,
    rendered,
    resolution,
  );
  scores.analogy_relation = relationScore.score;
  hardFailures.push(...relationScore.hardFailures);

  const breakpoint = /** @type {Record<string, unknown>} */ (
    rendered.analogy_breakpoint
  );
  if (resolution.kind === "mapped") {
    const card = runtime.content.concepts.find(
      (item) => item.id === resolution.analogy_concept_id,
    );
    const nonMappings = /** @type {unknown[]} */ (breakpoint.non_mappings);
    scores.breakpoint =
      breakpoint.kind === "mapped-limit" &&
      card !== undefined &&
      breakpoint.breakpoint === card.analogy_breakpoint &&
      Array.isArray(nonMappings) &&
      nonMappings.length > 0
        ? 2
        : 0;
    if (scores.breakpoint === 0) hardFailures.push("analogy-without-limit");
  } else {
    scores.breakpoint = breakpoint.kind === "not-applicable" ? 2 : 0;
  }

  const next = /** @type {Record<string, unknown>} */ (
    rendered.one_next_action_and_evidence
  );
  const oneActionAndEvidence =
    Object.keys(next).length === 2 &&
    next.action === scenario.next_action &&
    next.evidence === scenario.evidence;
  scores.actionability = oneActionAndEvidence ? 2 : next.action ? 1 : 0;
  if (resolution.network_calls !== 0)
    hardFailures.push("unexpected-network-call");

  const preAction = /** @type {Record<string, unknown>} */ (
    rendered.target_side_effect_risk_rollback
  );
  const safetyFields = ["target", "side_effect", "risk", "rollback"];
  const safetyFieldCount = safetyFields.filter(
    (field) =>
      typeof preAction[field] === "string" &&
      /** @type {string} */ (preAction[field]).length > 0,
  ).length;
  const labels = /** @type {Record<string, unknown>[]} */ (
    rendered.protocol_fact_and_fairytail_policy_labels
  );
  const labelKinds = labels.map((label) => label.kind);
  scores.safety =
    safetyFieldCount === 4 &&
    labelKinds.includes("protocol_fact") &&
    labelKinds.includes("fairytail_policy")
      ? 2
      : safetyFieldCount >= 2
        ? 1
        : 0;
  if (safetyFieldCount < 4)
    hardFailures.push("safety-boundary-hidden-or-missing");

  const diagnostic = /** @type {Record<string, unknown>} */ (
    rendered.diagnostic_or_teachback
  );
  scores.learning_question =
    diagnostic.question === scenario.diagnostic_question &&
    typeof diagnostic.question === "string" &&
    diagnostic.question.endsWith("?")
      ? 2
      : diagnostic.question
        ? 1
        : 0;

  const sectionExact =
    stableStringify(Object.keys(rendered).sort()) ===
    stableStringify([...RENDER_SECTION_KEYS].sort());
  scores.compression =
    sectionExact &&
    actualConceptIds.length >= 1 &&
    actualConceptIds.length <= 2 &&
    Object.hasOwn(rendered, "target_side_effect_risk_rollback")
      ? 2
      : actualConceptIds.length <= 3
        ? 1
        : 0;

  const normalizedScores = /** @type {Record<string, number>} */ (scores);
  return {
    case_id: fixtureCase.case_id,
    profile_id: fixtureCase.profile_id,
    scenario_id: scenarioId,
    rendered_hash: sha256(stableRenderBytes(rendered)),
    mapping_id: resolution.kind === "mapped" ? resolution.mapping_id : null,
    mapping_hash: resolution.kind === "mapped" ? resolution.mapping_hash : null,
    fallback_kind: resolution.kind,
    scores: normalizedScores,
    total: totalScore(normalizedScores),
    hard_failures: [...new Set(hardFailures)].sort(),
    profile_projection_calls: resolution.profile_projection_calls,
    network_calls: resolution.network_calls,
  };
}

/**
 * @param {Awaited<ReturnType<import("./engine.mjs").loadAnalogyRuntime>>} runtime
 * @param {string} scenarioId
 * @param {ReturnType<typeof renderScenario>} rendered
 * @param {import("./engine.mjs").AnalogyResolution} resolution
 */
function scoreAnalogyRelation(runtime, scenarioId, rendered, resolution) {
  /** @type {string[]} */
  const hardFailures = [];
  if (resolution.kind !== "mapped") return { score: 1, hardFailures };
  const mapping = runtime.publication.mappings.find(
    (item) => item.mapping_id === resolution.mapping_id,
  );
  const contract = runtime.publication.contracts.find(
    (item) => item.concept_id === resolution.analogy_concept_id,
  );
  const analogy = /** @type {Record<string, unknown>} */ (
    rendered.analogy_or_neutral_fallback
  );
  if (!mapping || !contract || mapping.scenario_id !== scenarioId) {
    hardFailures.push("unvalidated-mapping-displayed");
    return { score: 0, hardFailures };
  }
  const roleIds = /** @type {string[]} */ (contract.role_ids);
  const roleMap = /** @type {Record<string, unknown>} */ (analogy.role_map);
  const relations = /** @type {Record<string, unknown>[]} */ (
    analogy.preserved_relations
  );
  const expectedRelationIds = /** @type {Record<string, unknown>[]} */ (
    contract.required_relations
  ).map((relation) => String(relation.relation_id));
  const actualRelationIds = relations.map((relation) =>
    String(relation.relation_id),
  );
  const valid =
    mapping.validation_status === "validated" &&
    runtime.publication.mappingHashes[resolution.mapping_id] ===
      resolution.mapping_hash &&
    stableStringify(Object.keys(roleMap).sort()) ===
      stableStringify([...roleIds].sort()) &&
    stableStringify([...actualRelationIds].sort()) ===
      stableStringify([...expectedRelationIds].sort()) &&
    relations.every(
      (relation) =>
        relation.from_target === roleMap[String(relation.from_role)] &&
        relation.to_target === roleMap[String(relation.to_role)],
    );
  if (!valid) hardFailures.push("relation-or-role-contract-broken");
  return { score: valid ? 2 : 0, hardFailures };
}

/** @param {Record<string, unknown>} fixtureProfile @param {Date} now */
function approvedRuntimeProfile(fixtureProfile, now) {
  const neutralV2 = {
    ...structuredClone(fixtureProfile),
    profile_version: 2,
    model_processing: {
      mode: "neutral_local",
      approved_fields: [],
      approved_at: null,
      approved_projection_digest: null,
    },
  };
  const approval = approvePersonalization(neutralV2, PROJECTION_FIELDS, now);
  if (!approval.approved) {
    throw new TypeError(
      `Golden profile ${fixtureProfile.profile_id} did not approve`,
    );
  }
  return approval.profile;
}

/** @param {Awaited<ReturnType<import("./engine.mjs").loadAnalogyRuntime>>} runtime */
function evaluateConfusionChecks(runtime) {
  const covered = new Set(
    runtime.content.scenarios.flatMap(
      (scenario) => /** @type {string[]} */ (scenario.confusion_pair_ids),
    ),
  );
  return Object.fromEntries(
    Object.entries(REQUIRED_CONFUSION_CHECKS).map(([name, pairIds]) => [
      name,
      pairIds.every((pairId) => covered.has(pairId)),
    ]),
  );
}

/** @param {Record<string, number>} scores */
function totalScore(scores) {
  return SCORE_DIMENSIONS.reduce((sum, name) => sum + (scores[name] ?? 0), 0);
}
