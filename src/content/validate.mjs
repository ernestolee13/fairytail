import {
  canonicalFactBytes,
  canonicalFactHash,
  canonicalFactSetBytes,
  canonicalFactSetHash,
} from "./stable-json.mjs";

const CONTENT_VERSION_PATTERN = /^[0-9]{4}\.[0-9]{2}\.[0-9]{2}\.[0-9]+$/u;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const FAMILY_IDS = Array.from(
  { length: 12 },
  (_, index) => `C${String(index + 1).padStart(2, "0")}`,
);
const PROFILE_IDS = ["P1", "P2", "P3"];
const SCENARIO_IDS = Array.from(
  { length: 10 },
  (_, index) => `S${String(index + 1).padStart(2, "0")}`,
);
const REQUIRED_SECTIONS = [
  "canonical_definition",
  "current_encounter",
  "analogy_or_neutral_fallback",
  "analogy_breakpoint",
  "target_side_effect_risk_rollback",
  "one_next_action_and_evidence",
  "diagnostic_or_teachback",
  "protocol_fact_and_fairytail_policy_labels",
];
const LEARNING_STATES = [
  "unseen",
  "exposed",
  "explained_once",
  "retrieved_delayed",
  "applied_novel",
];

export class ContentValidationError extends Error {
  /**
   * @param {string} path
   * @param {string} message
   */
  constructor(path, message) {
    super(`${path}: ${message}`);
    this.name = "ContentValidationError";
    this.path = path;
  }
}

/**
 * Validate every G002 artifact and its cross-file invariants. This explicit
 * validator mirrors the shipped JSON Schemas without adding a runtime package.
 *
 * @param {Record<string, unknown>} bundle
 */
export function validateG002Bundle(bundle) {
  const manifest = validateManifest(bundle.manifest);
  const manifestDate = dateString(manifest.verified_at, "manifest.verified_at");
  const conceptsRoot = validateConcepts(bundle.concepts, manifestDate);
  const conceptCards = /** @type {Record<string, unknown>[]} */ (
    conceptsRoot.cards
  );
  const conceptById = indexBy(conceptCards, "id", "concepts.cards");
  const confusionRoot = validateConfusionPairs(
    bundle.confusionPairs,
    conceptById,
  );
  const profilesRoot = validateProfiles(bundle.profiles);
  const profileRecords = /** @type {Record<string, unknown>[]} */ (
    profilesRoot.profiles
  );
  const profileById = indexBy(
    profileRecords,
    "profile_id",
    "profiles.profiles",
  );
  const scenariosRoot = validateScenarios(
    bundle.scenarios,
    conceptById,
    indexBy(
      /** @type {Record<string, unknown>[]} */ (confusionRoot.pairs),
      "pair_id",
      "confusionPairs.pairs",
    ),
  );
  const scenarioRecords = /** @type {Record<string, unknown>[]} */ (
    scenariosRoot.scenarios
  );
  const scenarioById = indexBy(
    scenarioRecords,
    "scenario_id",
    "scenarios.scenarios",
  );
  const mappingsRoot = validateMappings(
    bundle.mappings,
    conceptById,
    profileById,
  );
  validateLearningFixture(bundle.learning, conceptById);
  validateSchemas(bundle.schemas);

  const contentVersion = string(
    conceptsRoot.content_version,
    "concepts.content_version",
  );
  equal(
    contentVersion,
    manifest.content_version,
    "concepts.content_version",
    "must match manifest content_version",
  );
  equal(
    confusionRoot.content_version,
    contentVersion,
    "confusionPairs.content_version",
    "must match manifest content_version",
  );

  const canonicalHashes = Object.fromEntries(
    conceptCards.map((card) => [
      string(card.id, "concept.id"),
      canonicalFactHash(card),
    ]),
  );
  const scenarioFactHashes = Object.fromEntries(
    scenarioRecords.map((scenario) => {
      const scenarioId = string(scenario.scenario_id, "scenario.scenario_id");
      const cards = ids(scenario.concept_ids, `${scenarioId}.concept_ids`).map(
        (conceptId) => requiredMapValue(conceptById, conceptId, scenarioId),
      );
      return [scenarioId, canonicalFactSetHash(cards, contentVersion)];
    }),
  );

  compareHashMap(
    record(manifest.canonical_hashes, "manifest.canonical_hashes"),
    canonicalHashes,
    "manifest.canonical_hashes",
  );
  compareHashMap(
    record(manifest.scenario_fact_hashes, "manifest.scenario_fact_hashes"),
    scenarioFactHashes,
    "manifest.scenario_fact_hashes",
  );

  const casesRoot = validateCases(
    bundle.cases,
    profileById,
    scenarioById,
    indexBy(
      /** @type {Record<string, unknown>[]} */ (mappingsRoot.mappings),
      "mapping_id",
      "mappings.mappings",
    ),
    scenarioFactHashes,
  );

  const counts = {
    concepts: conceptCards.length,
    confusion_pairs: array(confusionRoot.pairs, "confusionPairs.pairs").length,
    profiles: profileRecords.length,
    scenarios: scenarioRecords.length,
    analogy_candidates: array(mappingsRoot.mappings, "mappings.mappings")
      .length,
    golden_cases: array(casesRoot.cases, "cases.cases").length,
  };
  const manifestCounts = record(manifest.counts, "manifest.counts");
  for (const [name, value] of Object.entries(counts)) {
    equal(
      manifestCounts[name],
      value,
      `manifest.counts.${name}`,
      "does not match validated data",
    );
  }

  const invarianceCases = validateCanonicalInvariance(
    /** @type {Record<string, unknown>[]} */ (casesRoot.cases),
    scenarioById,
    conceptById,
    contentVersion,
  );

  return {
    status: "pass",
    contentVersion,
    counts,
    canonicalHashes,
    scenarioFactHashes,
    canonicalInvarianceCases: invarianceCases,
    personalizationReady: false,
    networkCalls: 0,
    childProcessCalls: 0,
  };
}

/**
 * @param {unknown} value
 */
function validateManifest(value) {
  const item = record(value, "manifest");
  exactKeys(
    item,
    [
      "schema_version",
      "content_version",
      "verified_at",
      "canonical_hash_algorithm",
      "counts",
      "canonical_hashes",
      "scenario_fact_hashes",
      "personalization_ready",
    ],
    [],
    "manifest",
  );
  equal(item.schema_version, 1, "manifest.schema_version", "must be 1");
  pattern(
    string(item.content_version, "manifest.content_version"),
    CONTENT_VERSION_PATTERN,
    "manifest.content_version",
  );
  dateString(item.verified_at, "manifest.verified_at");
  equal(
    item.canonical_hash_algorithm,
    "sha256-stable-json-v1",
    "manifest.canonical_hash_algorithm",
    "is unsupported",
  );
  equal(
    item.personalization_ready,
    false,
    "manifest.personalization_ready",
    "must remain false until G004 validation passes",
  );
  const counts = record(item.counts, "manifest.counts");
  exactKeys(
    counts,
    [
      "concepts",
      "confusion_pairs",
      "profiles",
      "scenarios",
      "analogy_candidates",
      "golden_cases",
    ],
    [],
    "manifest.counts",
  );
  for (const [name, expected] of Object.entries({
    concepts: 12,
    confusion_pairs: 12,
    profiles: 3,
    scenarios: 10,
    analogy_candidates: 30,
    golden_cases: 30,
  })) {
    equal(
      counts[name],
      expected,
      `manifest.counts.${name}`,
      `must be ${expected}`,
    );
  }
  validateHashMap(item.canonical_hashes, 12, "manifest.canonical_hashes");
  validateHashMap(
    item.scenario_fact_hashes,
    10,
    "manifest.scenario_fact_hashes",
  );
  return item;
}

/**
 * @param {unknown} value
 * @param {string} manifestDate
 */
function validateConcepts(value, manifestDate) {
  const root = record(value, "concepts");
  exactKeys(
    root,
    ["schema_version", "content_version", "locale", "cards"],
    [],
    "concepts",
  );
  equal(root.schema_version, 1, "concepts.schema_version", "must be 1");
  pattern(
    string(root.content_version, "concepts.content_version"),
    CONTENT_VERSION_PATTERN,
    "concepts.content_version",
  );
  equal(root.locale, "en", "concepts.locale", "must be en for v1");
  const cards = array(root.cards, "concepts.cards").map((card, index) =>
    validateConceptCard(card, `concepts.cards[${index}]`, manifestDate),
  );
  equal(cards.length, 12, "concepts.cards", "must contain exactly 12 cards");
  exactSet(
    cards.map((card) => string(card.family_id, "card.family_id")),
    FAMILY_IDS,
    "concepts.cards.family_id",
  );
  unique(
    cards.map((card) => string(card.id, "card.id")),
    "concepts.cards.id",
  );
  root.cards = cards;
  return root;
}

/**
 * @param {unknown} value
 * @param {string} path
 * @param {string} manifestDate
 */
function validateConceptCard(value, path, manifestDate) {
  const card = record(value, path);
  exactKeys(
    card,
    [
      "schema_version",
      "card_version",
      "family_id",
      "id",
      "aliases",
      "scope",
      "spec_revision",
      "canonical_definition",
      "mechanism",
      "beginner_encounters",
      "misconceptions",
      "confused_with",
      "analogy_roles",
      "analogy_breakpoint",
      "neutral_example",
      "safety_boundary",
      "sources",
      "verified_at",
    ],
    [],
    path,
  );
  equal(card.schema_version, 1, `${path}.schema_version`, "must be 1");
  positiveInteger(card.card_version, `${path}.card_version`);
  pattern(
    string(card.family_id, `${path}.family_id`),
    /^C[0-9]{2}$/u,
    `${path}.family_id`,
  );
  pattern(string(card.id, `${path}.id`), SLUG_PATTERN, `${path}.id`);
  stringList(card.aliases, `${path}.aliases`, { uniqueValues: true });
  nonEmptyString(card.scope, `${path}.scope`);
  nonEmptyString(card.spec_revision, `${path}.spec_revision`);
  nonEmptyString(card.canonical_definition, `${path}.canonical_definition`);
  const mechanism = record(card.mechanism, `${path}.mechanism`);
  exactKeys(mechanism, ["actors", "flow"], [], `${path}.mechanism`);
  stringList(mechanism.actors, `${path}.mechanism.actors`, {
    minimum: 1,
    uniqueValues: true,
  });
  stringList(mechanism.flow, `${path}.mechanism.flow`, { minimum: 1 });
  stringList(card.beginner_encounters, `${path}.beginner_encounters`, {
    minimum: 1,
  });
  const misconceptions = array(card.misconceptions, `${path}.misconceptions`);
  minimum(misconceptions.length, 1, `${path}.misconceptions`);
  misconceptions.forEach((value, index) => {
    const misconception = record(value, `${path}.misconceptions[${index}]`);
    exactKeys(
      misconception,
      ["id", "explicit_refutation", "correct_model", "counterexample"],
      [],
      `${path}.misconceptions[${index}]`,
    );
    pattern(
      string(misconception.id, `${path}.misconceptions[${index}].id`),
      SLUG_PATTERN,
      `${path}.misconceptions[${index}].id`,
    );
    for (const field of [
      "explicit_refutation",
      "correct_model",
      "counterexample",
    ]) {
      nonEmptyString(
        misconception[field],
        `${path}.misconceptions[${index}].${field}`,
      );
    }
  });
  stringList(card.confused_with, `${path}.confused_with`, {
    minimum: 1,
    uniqueValues: true,
  });
  stringList(card.analogy_roles, `${path}.analogy_roles`, {
    minimum: 2,
    uniqueValues: true,
  });
  nonEmptyString(card.analogy_breakpoint, `${path}.analogy_breakpoint`);
  nonEmptyString(card.neutral_example, `${path}.neutral_example`);
  stringList(card.safety_boundary, `${path}.safety_boundary`, { minimum: 1 });
  const sources = array(card.sources, `${path}.sources`);
  minimum(sources.length, 2, `${path}.sources`);
  let tierACount = 0;
  /** @type {string[]} */
  const sourceUrls = [];
  sources.forEach((value, index) => {
    const sourcePath = `${path}.sources[${index}]`;
    const source = record(value, sourcePath);
    exactKeys(
      source,
      ["title", "url", "tier", "reviewed_at"],
      ["revision"],
      sourcePath,
    );
    nonEmptyString(source.title, `${sourcePath}.title`);
    const url = httpsUrl(source.url, `${sourcePath}.url`);
    sourceUrls.push(url);
    if (source.tier === "A") tierACount += 1;
    if (!["A", "B", "C"].includes(string(source.tier, `${sourcePath}.tier`))) {
      fail(`${sourcePath}.tier`, "must be A, B, or C");
    }
    nonEmptyString(source.revision, `${sourcePath}.revision`);
    const reviewedAt = dateString(
      source.reviewed_at,
      `${sourcePath}.reviewed_at`,
    );
    if (reviewedAt > manifestDate) {
      fail(`${sourcePath}.reviewed_at`, "cannot be after manifest verified_at");
    }
  });
  unique(sourceUrls, `${path}.sources.url`);
  minimum(tierACount, 1, `${path}.sources tier A count`);
  const verifiedAt = dateString(card.verified_at, `${path}.verified_at`);
  if (verifiedAt > manifestDate) {
    fail(`${path}.verified_at`, "cannot be after manifest verified_at");
  }
  if (card.family_id === "C09" && card.spec_revision !== "MCP 2025-11-25") {
    fail(`${path}.spec_revision`, "MCP must remain pinned to 2025-11-25");
  }
  canonicalFactBytes(card);
  return card;
}

/**
 * @param {unknown} value
 * @param {Map<string, Record<string, unknown>>} conceptById
 */
function validateConfusionPairs(value, conceptById) {
  const root = record(value, "confusionPairs");
  exactKeys(
    root,
    ["schema_version", "content_version", "pairs"],
    [],
    "confusionPairs",
  );
  equal(root.schema_version, 1, "confusionPairs.schema_version", "must be 1");
  pattern(
    string(root.content_version, "confusionPairs.content_version"),
    CONTENT_VERSION_PATTERN,
    "confusionPairs.content_version",
  );
  const pairs = array(root.pairs, "confusionPairs.pairs");
  equal(
    pairs.length,
    12,
    "confusionPairs.pairs",
    "must contain exactly 12 pairs",
  );
  const validated = pairs.map((value, index) => {
    const path = `confusionPairs.pairs[${index}]`;
    const pair = record(value, path);
    exactKeys(
      pair,
      [
        "schema_version",
        "pair_id",
        "concepts",
        "fixed_distinction",
        "diagnostic_question",
        "source_concept_ids",
      ],
      [],
      path,
    );
    equal(pair.schema_version, 1, `${path}.schema_version`, "must be 1");
    pattern(
      string(pair.pair_id, `${path}.pair_id`),
      SLUG_PATTERN,
      `${path}.pair_id`,
    );
    const members = stringList(pair.concepts, `${path}.concepts`, {
      minimum: 2,
      maximum: 3,
      uniqueValues: true,
    });
    minimum(members.length, 2, `${path}.concepts`);
    nonEmptyString(pair.fixed_distinction, `${path}.fixed_distinction`);
    const question = nonEmptyString(
      pair.diagnostic_question,
      `${path}.diagnostic_question`,
    );
    if (!question.endsWith("?")) {
      fail(`${path}.diagnostic_question`, "must be a relationship question");
    }
    for (const conceptId of ids(
      pair.source_concept_ids,
      `${path}.source_concept_ids`,
    )) {
      requiredMapValue(conceptById, conceptId, `${path}.source_concept_ids`);
    }
    return pair;
  });
  unique(
    validated.map((pair) => string(pair.pair_id, "pair.pair_id")),
    "confusionPairs.pairs.pair_id",
  );
  root.pairs = validated;
  return root;
}

/**
 * @param {unknown} value
 */
function validateProfiles(value) {
  const root = record(value, "profiles");
  exactKeys(root, ["schema_version", "profiles"], [], "profiles");
  equal(root.schema_version, 1, "profiles.schema_version", "must be 1");
  const profiles = array(root.profiles, "profiles.profiles");
  equal(
    profiles.length,
    3,
    "profiles.profiles",
    "must contain exactly 3 profiles",
  );
  const validated = profiles.map((value, index) => {
    const path = `profiles.profiles[${index}]`;
    const profile = record(value, path);
    exactKeys(
      profile,
      [
        "profile_version",
        "profile_id",
        "language",
        "familiar_worlds",
        "observed_experience",
        "presentation_preference",
        "safety_concerns",
        "no_analogy",
        "model_processing",
        "pii_redaction_enabled",
        "updated_at",
      ],
      [],
      path,
    );
    equal(profile.profile_version, 1, `${path}.profile_version`, "must be 1");
    pattern(
      string(profile.profile_id, `${path}.profile_id`),
      /^P[1-9][0-9]*$/u,
      `${path}.profile_id`,
    );
    if (!["ko", "en"].includes(string(profile.language, `${path}.language`))) {
      fail(`${path}.language`, "must be ko or en");
    }
    const worlds = array(profile.familiar_worlds, `${path}.familiar_worlds`);
    if (worlds.length > 5)
      fail(`${path}.familiar_worlds`, "must have at most 5 items");
    worlds.forEach((value, worldIndex) => {
      const worldPath = `${path}.familiar_worlds[${worldIndex}]`;
      const world = record(value, worldPath);
      exactKeys(world, ["id", "label"], [], worldPath);
      pattern(
        string(world.id, `${worldPath}.id`),
        SLUG_PATTERN,
        `${worldPath}.id`,
      );
      const label = nonEmptyString(world.label, `${worldPath}.label`);
      if (label.length > 40)
        fail(`${worldPath}.label`, "must have at most 40 characters");
    });
    stringList(profile.observed_experience, `${path}.observed_experience`, {
      uniqueValues: true,
    });
    if (
      !["analogy_first", "checklist", "try_first", "neutral"].includes(
        string(
          profile.presentation_preference,
          `${path}.presentation_preference`,
        ),
      )
    ) {
      fail(`${path}.presentation_preference`, "is unsupported");
    }
    stringList(profile.safety_concerns, `${path}.safety_concerns`, {
      uniqueValues: true,
    });
    boolean(profile.no_analogy, `${path}.no_analogy`);
    const processing = record(
      profile.model_processing,
      `${path}.model_processing`,
    );
    exactKeys(
      processing,
      ["mode", "approved_fields", "approved_at"],
      [],
      `${path}.model_processing`,
    );
    equal(
      processing.mode,
      "neutral_local",
      `${path}.model_processing.mode`,
      "golden G002 profiles must default to neutral_local",
    );
    equal(
      array(
        processing.approved_fields,
        `${path}.model_processing.approved_fields`,
      ).length,
      0,
      `${path}.model_processing.approved_fields`,
      "must be empty before G003 consent",
    );
    equal(
      processing.approved_at,
      null,
      `${path}.model_processing.approved_at`,
      "must be null before G003 consent",
    );
    equal(
      profile.pii_redaction_enabled,
      true,
      `${path}.pii_redaction_enabled`,
      "must remain true",
    );
    dateString(profile.updated_at, `${path}.updated_at`);
    return profile;
  });
  exactSet(
    validated.map((profile) =>
      string(profile.profile_id, "profile.profile_id"),
    ),
    PROFILE_IDS,
    "profiles.profiles.profile_id",
  );
  root.profiles = validated;
  return root;
}

/**
 * @param {unknown} value
 * @param {Map<string, Record<string, unknown>>} conceptById
 * @param {Map<string, Record<string, unknown>>} pairById
 */
function validateScenarios(value, conceptById, pairById) {
  const root = record(value, "scenarios");
  exactKeys(root, ["schema_version", "scenarios"], [], "scenarios");
  equal(root.schema_version, 1, "scenarios.schema_version", "must be 1");
  const scenarios = array(root.scenarios, "scenarios.scenarios");
  equal(
    scenarios.length,
    10,
    "scenarios.scenarios",
    "must contain exactly 10 scenarios",
  );
  const coveredPairs = new Set();
  const validated = scenarios.map((value, index) => {
    const path = `scenarios.scenarios[${index}]`;
    const scenario = record(value, path);
    exactKeys(
      scenario,
      [
        "scenario_version",
        "scenario_id",
        "title",
        "concept_ids",
        "confusion_pair_ids",
        "fixed_criterion",
        "encounter",
        "pre_action",
        "next_action",
        "evidence",
        "diagnostic_question",
        "policy_labels",
      ],
      [],
      path,
    );
    equal(
      scenario.scenario_version,
      1,
      `${path}.scenario_version`,
      "must be 1",
    );
    pattern(
      string(scenario.scenario_id, `${path}.scenario_id`),
      /^S[0-9]{2}$/u,
      `${path}.scenario_id`,
    );
    nonEmptyString(scenario.title, `${path}.title`);
    const conceptIds = ids(scenario.concept_ids, `${path}.concept_ids`, {
      minimum: 1,
      maximum: 2,
    });
    conceptIds.forEach((id) => requiredMapValue(conceptById, id, path));
    const pairIds = ids(
      scenario.confusion_pair_ids,
      `${path}.confusion_pair_ids`,
      { minimum: 1 },
    );
    const diagnosticQuestions = pairIds.map((id) => {
      coveredPairs.add(id);
      const pair = requiredMapValue(pairById, id, path);
      return string(
        pair.diagnostic_question,
        `${path}.${id}.diagnostic_question`,
      );
    });
    nonEmptyString(scenario.fixed_criterion, `${path}.fixed_criterion`);
    nonEmptyString(scenario.encounter, `${path}.encounter`);
    const preAction = record(scenario.pre_action, `${path}.pre_action`);
    exactKeys(
      preAction,
      ["target", "side_effect", "risk", "rollback"],
      [],
      `${path}.pre_action`,
    );
    for (const field of ["target", "side_effect", "risk", "rollback"]) {
      nonEmptyString(preAction[field], `${path}.pre_action.${field}`);
    }
    nonEmptyString(scenario.next_action, `${path}.next_action`);
    nonEmptyString(scenario.evidence, `${path}.evidence`);
    const question = nonEmptyString(
      scenario.diagnostic_question,
      `${path}.diagnostic_question`,
    );
    if (!diagnosticQuestions.includes(question)) {
      fail(
        `${path}.diagnostic_question`,
        "must exactly reference one declared confusion-pair diagnostic",
      );
    }
    const labels = array(scenario.policy_labels, `${path}.policy_labels`);
    minimum(labels.length, 1, `${path}.policy_labels`);
    labels.forEach((value, labelIndex) => {
      const labelPath = `${path}.policy_labels[${labelIndex}]`;
      const label = record(value, labelPath);
      exactKeys(label, ["kind", "text"], [], labelPath);
      if (
        !["protocol_fact", "fairytail_policy"].includes(
          string(label.kind, `${labelPath}.kind`),
        )
      ) {
        fail(`${labelPath}.kind`, "is unsupported");
      }
      nonEmptyString(label.text, `${labelPath}.text`);
    });
    return scenario;
  });
  exactSet(
    validated.map((scenario) =>
      string(scenario.scenario_id, "scenario.scenario_id"),
    ),
    SCENARIO_IDS,
    "scenarios.scenario_id",
  );
  exactSet(
    [...coveredPairs],
    [...pairById.keys()],
    "scenarios.confusion_pair_ids",
  );
  root.scenarios = validated;
  return root;
}

/**
 * @param {unknown} value
 * @param {Map<string, Record<string, unknown>>} conceptById
 * @param {Map<string, Record<string, unknown>>} profileById
 */
function validateMappings(value, conceptById, profileById) {
  const root = record(value, "mappings");
  exactKeys(root, ["schema_version", "mappings"], [], "mappings");
  equal(root.schema_version, 1, "mappings.schema_version", "must be 1");
  const mappings = array(root.mappings, "mappings.mappings");
  equal(
    mappings.length,
    30,
    "mappings.mappings",
    "must contain exactly 30 candidates",
  );
  const validated = mappings.map((value, index) => {
    const path = `mappings.mappings[${index}]`;
    const mapping = record(value, path);
    exactKeys(
      mapping,
      [
        "mapping_version",
        "mapping_id",
        "concept_id",
        "profile_id",
        "profile_world",
        "candidate_text",
        "role_map",
        "relations_preserved",
        "non_mappings",
        "breakpoint",
        "neutral_fallback",
        "confidence",
        "user_status",
        "validation_status",
        "verified_at",
      ],
      [],
      path,
    );
    equal(mapping.mapping_version, 1, `${path}.mapping_version`, "must be 1");
    pattern(
      string(mapping.mapping_id, `${path}.mapping_id`),
      /^P[1-9][0-9]*-S[0-9]{2}$/u,
      `${path}.mapping_id`,
    );
    const conceptId = string(mapping.concept_id, `${path}.concept_id`);
    const card = requiredMapValue(conceptById, conceptId, path);
    const profileId = string(mapping.profile_id, `${path}.profile_id`);
    const profile = requiredMapValue(profileById, profileId, path);
    const expectedPrefix = `${profileId}-`;
    if (
      !string(mapping.mapping_id, `${path}.mapping_id`).startsWith(
        expectedPrefix,
      )
    ) {
      fail(`${path}.mapping_id`, "must begin with profile_id");
    }
    const worldId = string(mapping.profile_world, `${path}.profile_world`);
    const worlds = array(
      profile.familiar_worlds,
      `${path}.profile.familiar_worlds`,
    ).map((value, worldIndex) =>
      string(
        record(value, `${path}.profile.familiar_worlds[${worldIndex}]`).id,
        `${path}.profile.familiar_worlds[${worldIndex}].id`,
      ),
    );
    if (!worlds.includes(worldId)) {
      fail(`${path}.profile_world`, "must reference a fixture profile world");
    }
    nonEmptyString(mapping.candidate_text, `${path}.candidate_text`);
    const roleMap = record(mapping.role_map, `${path}.role_map`);
    minimum(Object.keys(roleMap).length, 2, `${path}.role_map`);
    for (const [role, target] of Object.entries(roleMap)) {
      nonEmptyString(role, `${path}.role_map key`);
      nonEmptyString(target, `${path}.role_map.${role}`);
    }
    equal(
      array(mapping.relations_preserved, `${path}.relations_preserved`).length,
      0,
      `${path}.relations_preserved`,
      "must stay empty until G004 structural validation",
    );
    stringList(mapping.non_mappings, `${path}.non_mappings`, { minimum: 1 });
    equal(
      mapping.breakpoint,
      card.analogy_breakpoint,
      `${path}.breakpoint`,
      "must be copied byte-for-byte from the fixed concept card",
    );
    equal(
      mapping.neutral_fallback,
      card.neutral_example,
      `${path}.neutral_fallback`,
      "must be copied byte-for-byte from the bundled neutral example",
    );
    equal(
      mapping.confidence,
      "unvalidated",
      `${path}.confidence`,
      "must remain unvalidated in G002",
    );
    equal(
      mapping.user_status,
      "candidate",
      `${path}.user_status`,
      "must remain candidate in G002",
    );
    equal(
      mapping.validation_status,
      "candidate_requires_validation",
      `${path}.validation_status`,
      "cannot be consumed before G004",
    );
    dateString(mapping.verified_at, `${path}.verified_at`);
    return mapping;
  });
  const ids = validated.map((mapping) =>
    string(mapping.mapping_id, "mapping.mapping_id"),
  );
  exactSet(
    ids,
    PROFILE_IDS.flatMap((profileId) =>
      SCENARIO_IDS.map((scenarioId) => `${profileId}-${scenarioId}`),
    ),
    "mappings.mapping_id",
  );
  root.mappings = validated;
  return root;
}

/**
 * @param {unknown} value
 * @param {Map<string, Record<string, unknown>>} profileById
 * @param {Map<string, Record<string, unknown>>} scenarioById
 * @param {Map<string, Record<string, unknown>>} mappingById
 * @param {Record<string, string>} scenarioFactHashes
 */
function validateCases(
  value,
  profileById,
  scenarioById,
  mappingById,
  scenarioFactHashes,
) {
  const root = record(value, "cases");
  exactKeys(root, ["schema_version", "cases"], [], "cases");
  equal(root.schema_version, 1, "cases.schema_version", "must be 1");
  const cases = array(root.cases, "cases.cases");
  equal(cases.length, 30, "cases.cases", "must contain exactly 30 cases");
  const validated = cases.map((value, index) => {
    const path = `cases.cases[${index}]`;
    const item = record(value, path);
    exactKeys(
      item,
      [
        "case_version",
        "case_id",
        "profile_id",
        "scenario_id",
        "concept_ids",
        "canonical_fact_set_hash",
        "analogy_mapping_id",
        "required_output_sections",
        "evaluation_status",
      ],
      [],
      path,
    );
    equal(item.case_version, 1, `${path}.case_version`, "must be 1");
    const caseId = string(item.case_id, `${path}.case_id`);
    pattern(caseId, /^P[1-9][0-9]*-S[0-9]{2}$/u, `${path}.case_id`);
    const profileId = string(item.profile_id, `${path}.profile_id`);
    requiredMapValue(profileById, profileId, path);
    const scenarioId = string(item.scenario_id, `${path}.scenario_id`);
    const scenario = requiredMapValue(scenarioById, scenarioId, path);
    equal(
      caseId,
      `${profileId}-${scenarioId}`,
      `${path}.case_id`,
      "must equal profile_id-scenario_id",
    );
    const conceptIds = ids(item.concept_ids, `${path}.concept_ids`, {
      minimum: 1,
      maximum: 2,
    });
    deepEqual(
      conceptIds,
      ids(scenario.concept_ids, `${path}.scenario.concept_ids`),
      `${path}.concept_ids`,
      "must match the scenario without profile overrides",
    );
    const hash = string(
      item.canonical_fact_set_hash,
      `${path}.canonical_fact_set_hash`,
    );
    pattern(hash, HASH_PATTERN, `${path}.canonical_fact_set_hash`);
    equal(
      hash,
      scenarioFactHashes[scenarioId],
      `${path}.canonical_fact_set_hash`,
      "does not match fixed scenario facts",
    );
    const mappingId = string(
      item.analogy_mapping_id,
      `${path}.analogy_mapping_id`,
    );
    equal(
      mappingId,
      caseId,
      `${path}.analogy_mapping_id`,
      "must match case_id",
    );
    requiredMapValue(mappingById, mappingId, path);
    exactSet(
      stringList(
        item.required_output_sections,
        `${path}.required_output_sections`,
        {
          minimum: 8,
          maximum: 8,
          uniqueValues: true,
        },
      ),
      REQUIRED_SECTIONS,
      `${path}.required_output_sections`,
    );
    equal(
      item.evaluation_status,
      "fixture_only_not_scored",
      `${path}.evaluation_status`,
      "G002 must not fabricate rendered scores",
    );
    return item;
  });
  exactSet(
    validated.map((item) => string(item.case_id, "case.case_id")),
    PROFILE_IDS.flatMap((profileId) =>
      SCENARIO_IDS.map((scenarioId) => `${profileId}-${scenarioId}`),
    ),
    "cases.case_id",
  );
  root.cases = validated;
  return root;
}

/**
 * @param {unknown} value
 * @param {Map<string, Record<string, unknown>>} conceptById
 */
function validateLearningFixture(value, conceptById) {
  const root = record(value, "learning");
  exactKeys(
    root,
    [
      "schema_version",
      "fixture_id",
      "learning_evidence",
      "execution_permission_observation",
    ],
    [],
    "learning",
  );
  equal(root.schema_version, 1, "learning.schema_version", "must be 1");
  nonEmptyString(root.fixture_id, "learning.fixture_id");
  const evidence = record(root.learning_evidence, "learning.learning_evidence");
  exactKeys(
    evidence,
    [
      "evidence_version",
      "concept_id",
      "state",
      "events",
      "state_history",
      "next_retrieval_after",
    ],
    [],
    "learning.learning_evidence",
  );
  equal(
    evidence.evidence_version,
    1,
    "learning.learning_evidence.evidence_version",
    "must be 1",
  );
  requiredMapValue(
    conceptById,
    string(evidence.concept_id, "learning.learning_evidence.concept_id"),
    "learning.learning_evidence",
  );
  equal(
    evidence.state,
    "applied_novel",
    "learning.learning_evidence.state",
    "fixture must end at applied_novel",
  );
  exactSet(
    stringList(
      evidence.state_history,
      "learning.learning_evidence.state_history",
    ),
    LEARNING_STATES,
    "learning.learning_evidence.state_history",
    true,
  );
  const events = array(evidence.events, "learning.learning_evidence.events");
  const expectedTypes = [
    "exposed",
    "teachback_scored",
    "retrieval_scored",
    "novel_application_scored",
  ];
  equal(
    events.length,
    expectedTypes.length,
    "learning.learning_evidence.events",
    "has wrong length",
  );
  const times = events.map((value, index) => {
    const path = `learning.learning_evidence.events[${index}]`;
    const event = record(value, path);
    exactKeys(
      event,
      ["type", "scenario_id", "at"],
      ["score", "fatal_misconception", "novel_context"],
      path,
    );
    equal(event.type, expectedTypes[index], `${path}.type`, "is out of order");
    nonEmptyString(event.scenario_id, `${path}.scenario_id`);
    const at = dateTime(event.at, `${path}.at`);
    if (index > 0) {
      const score = integer(event.score, `${path}.score`);
      if (score < 6 || score > 8) fail(`${path}.score`, "must be from 6 to 8");
      equal(
        event.fatal_misconception,
        false,
        `${path}.fatal_misconception`,
        "must be false for a state advance",
      );
    }
    if (index === 3) {
      equal(event.novel_context, true, `${path}.novel_context`, "must be true");
    }
    return at;
  });
  if (times[2].getTime() - times[0].getTime() < 20 * 60 * 1000) {
    fail(
      "learning.learning_evidence.events[2].at",
      "delayed retrieval must be at least 20 minutes after exposure",
    );
  }
  equal(
    evidence.next_retrieval_after,
    null,
    "learning.learning_evidence.next_retrieval_after",
    "must be null after applied_novel in this fixture",
  );
  const permission = record(
    root.execution_permission_observation,
    "learning.execution_permission_observation",
  );
  exactKeys(
    permission,
    ["before", "after", "invariant"],
    [],
    "learning.execution_permission_observation",
  );
  deepEqual(
    permission.before,
    permission.after,
    "learning.execution_permission_observation.after",
    "learning progress must not change execution permission",
  );
  nonEmptyString(
    permission.invariant,
    "learning.execution_permission_observation.invariant",
  );
}

/**
 * @param {unknown} value
 */
function validateSchemas(value) {
  const schemas = record(value, "schemas");
  const expectedNames = [
    "concept-card.schema.json",
    "confusion-pair.schema.json",
    "profile.schema.json",
    "analogy-mapping.schema.json",
    "learning-evidence.schema.json",
    "scenario.schema.json",
    "golden-case.schema.json",
    "manifest.schema.json",
  ];
  exactSet(Object.keys(schemas), expectedNames, "schemas");
  for (const name of expectedNames) {
    const schema = record(schemas[name], `schemas.${name}`);
    equal(
      schema.$schema,
      "https://json-schema.org/draft/2020-12/schema",
      `schemas.${name}.$schema`,
      "must use Draft 2020-12",
    );
    equal(
      schema.additionalProperties,
      false,
      `schemas.${name}.additionalProperties`,
      "must reject unknown top-level fields",
    );
    nonEmptyString(schema.$id, `schemas.${name}.$id`);
    record(schema.properties, `schemas.${name}.properties`);
  }
}

/**
 * @param {Record<string, unknown>[]} cases
 * @param {Map<string, Record<string, unknown>>} scenarioById
 * @param {Map<string, Record<string, unknown>>} conceptById
 * @param {string} contentVersion
 */
function validateCanonicalInvariance(
  cases,
  scenarioById,
  conceptById,
  contentVersion,
) {
  const baseline = new Map();
  for (const item of cases) {
    const scenarioId = string(item.scenario_id, "case.scenario_id");
    const scenario = requiredMapValue(
      scenarioById,
      scenarioId,
      "case.scenario_id",
    );
    const cards = ids(scenario.concept_ids, `${scenarioId}.concept_ids`).map(
      (conceptId) => requiredMapValue(conceptById, conceptId, scenarioId),
    );
    const bytes = canonicalFactSetBytes(cards, contentVersion);
    const prior = baseline.get(scenarioId);
    if (prior && !prior.equals(bytes)) {
      fail(
        `cases.${item.case_id}`,
        "profile-dependent canonical fact bytes detected",
      );
    }
    baseline.set(scenarioId, bytes);
  }
  equal(baseline.size, 10, "cases", "must cover 10 scenario baselines");
  return cases.length;
}

/**
 * @param {unknown} value
 * @param {number} expectedCount
 * @param {string} path
 */
function validateHashMap(value, expectedCount, path) {
  const map = record(value, path);
  equal(
    Object.keys(map).length,
    expectedCount,
    path,
    `must have ${expectedCount} entries`,
  );
  for (const [key, hash] of Object.entries(map)) {
    nonEmptyString(key, `${path} key`);
    pattern(string(hash, `${path}.${key}`), HASH_PATTERN, `${path}.${key}`);
  }
}

/**
 * @param {Record<string, unknown>} expected
 * @param {Record<string, string>} actual
 * @param {string} path
 */
function compareHashMap(expected, actual, path) {
  exactSet(Object.keys(expected), Object.keys(actual), `${path} keys`);
  for (const [key, hash] of Object.entries(actual)) {
    equal(expected[key], hash, `${path}.${key}`, "hash mismatch");
  }
}

/**
 * @param {Record<string, unknown>[]} items
 * @param {string} field
 * @param {string} path
 */
function indexBy(items, field, path) {
  /** @type {Map<string, Record<string, unknown>>} */
  const map = new Map();
  items.forEach((item, index) => {
    const key = string(item[field], `${path}[${index}].${field}`);
    if (map.has(key))
      fail(`${path}[${index}].${field}`, `duplicate value ${key}`);
    map.set(key, item);
  });
  return map;
}

/**
 * @param {Map<string, Record<string, unknown>>} map
 * @param {string} key
 * @param {string} path
 */
function requiredMapValue(map, key, path) {
  const value = map.get(key);
  if (!value) fail(path, `unknown reference ${key}`);
  return value;
}

/**
 * @param {unknown} value
 * @param {string} path
 * @returns {Record<string, unknown>}
 */
function record(value, path) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(path, "must be an object");
  }
  return /** @type {Record<string, unknown>} */ (value);
}

/**
 * @param {unknown} value
 * @param {string} path
 * @returns {unknown[]}
 */
function array(value, path) {
  if (!Array.isArray(value)) fail(path, "must be an array");
  return value;
}

/**
 * @param {unknown} value
 * @param {string} path
 */
function string(value, path) {
  if (typeof value !== "string") fail(path, "must be a string");
  return value;
}

/**
 * @param {unknown} value
 * @param {string} path
 */
function nonEmptyString(value, path) {
  const result = string(value, path);
  if (result.trim().length === 0) fail(path, "must not be empty");
  return result;
}

/**
 * @param {unknown} value
 * @param {string} path
 */
function boolean(value, path) {
  if (typeof value !== "boolean") fail(path, "must be a boolean");
  return value;
}

/**
 * @param {unknown} value
 * @param {string} path
 */
function integer(value, path) {
  if (!Number.isInteger(value)) fail(path, "must be an integer");
  return /** @type {number} */ (value);
}

/**
 * @param {unknown} value
 * @param {string} path
 */
function positiveInteger(value, path) {
  const result = integer(value, path);
  if (result < 1) fail(path, "must be at least 1");
  return result;
}

/**
 * @param {unknown} value
 * @param {string} path
 * @param {{ minimum?: number, maximum?: number, uniqueValues?: boolean }} [options]
 */
function stringList(value, path, options = {}) {
  const list = array(value, path).map((item, index) =>
    nonEmptyString(item, `${path}[${index}]`),
  );
  if (options.minimum !== undefined && list.length < options.minimum) {
    fail(path, `must have at least ${options.minimum} items`);
  }
  if (options.maximum !== undefined && list.length > options.maximum) {
    fail(path, `must have at most ${options.maximum} items`);
  }
  if (options.uniqueValues) unique(list, path);
  return list;
}

/**
 * @param {unknown} value
 * @param {string} path
 * @param {{ minimum?: number, maximum?: number }} [options]
 */
function ids(value, path, options = {}) {
  const list = stringList(value, path, {
    minimum: options.minimum,
    maximum: options.maximum,
    uniqueValues: true,
  });
  list.forEach((id, index) => pattern(id, SLUG_PATTERN, `${path}[${index}]`));
  return list;
}

/**
 * @param {unknown} value
 * @param {string} path
 */
function dateString(value, path) {
  const text = string(value, path);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(text)) fail(path, "must be an ISO date");
  const parsed = new Date(`${text}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== text
  ) {
    fail(path, "must be a real calendar date");
  }
  return text;
}

/**
 * @param {unknown} value
 * @param {string} path
 */
function dateTime(value, path) {
  const text = string(value, path);
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== text) {
    fail(path, "must be an exact ISO date-time with milliseconds and Z");
  }
  return parsed;
}

/**
 * @param {unknown} value
 * @param {string} path
 */
function httpsUrl(value, path) {
  const text = string(value, path);
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    fail(path, "must be a valid URL");
  }
  if (parsed.protocol !== "https:") fail(path, "must use HTTPS");
  return parsed.href;
}

/**
 * @param {Record<string, unknown>} value
 * @param {string[]} required
 * @param {string[]} optional
 * @param {string} path
 */
function exactKeys(value, required, optional, path) {
  const allowed = new Set([...required, ...optional]);
  for (const key of required) {
    if (!Object.hasOwn(value, key)) fail(`${path}.${key}`, "is required");
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(`${path}.${key}`, "is not allowed");
  }
}

/**
 * @param {string[]} actual
 * @param {string[]} expected
 * @param {string} path
 * @param {boolean} [ordered]
 */
function exactSet(actual, expected, path, ordered = false) {
  unique(actual, path);
  if (ordered) {
    deepEqual(actual, expected, path, "has wrong order or values");
    return;
  }
  const left = [...actual].sort();
  const right = [...expected].sort();
  deepEqual(left, right, path, "has wrong values");
}

/**
 * @param {unknown[]} values
 * @param {string} path
 */
function unique(values, path) {
  if (new Set(values).size !== values.length)
    fail(path, "must contain unique values");
}

/**
 * @param {number} value
 * @param {number} expected
 * @param {string} path
 */
function minimum(value, expected, path) {
  if (value < expected) fail(path, `must be at least ${expected}`);
}

/**
 * @param {unknown} value
 * @param {RegExp} expression
 * @param {string} path
 */
function pattern(value, expression, path) {
  if (!expression.test(string(value, path)))
    fail(path, "has an invalid format");
}

/**
 * @param {unknown} actual
 * @param {unknown} expected
 * @param {string} path
 * @param {string} message
 */
function equal(actual, expected, path, message) {
  if (actual !== expected) fail(path, message);
}

/**
 * @param {unknown} actual
 * @param {unknown} expected
 * @param {string} path
 * @param {string} message
 */
function deepEqual(actual, expected, path, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail(path, message);
}

/**
 * @param {string} path
 * @param {string} message
 * @returns {never}
 */
function fail(path, message) {
  throw new ContentValidationError(path, message);
}
