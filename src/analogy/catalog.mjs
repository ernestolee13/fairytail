import { join } from "node:path";

import { readJsonDocument } from "../content/load.mjs";
import { sha256, stableStringify } from "../content/stable-json.mjs";

const CONTENT_VERSION_PATTERN = /^[0-9]{4}\.[0-9]{2}\.[0-9]{2}\.[0-9]+$/u;
const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const MAPPING_ID_PATTERN = /^P[1-9][0-9]*-S[0-9]{2}-A[1-9][0-9]*$/u;
const CANDIDATE_ID_PATTERN = /^P[1-9][0-9]*-S[0-9]{2}$/u;
const CONTROL_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
export const UNSAFE_ANALOGY_CLAIM_PATTERN =
  /(자동(?:으로)?\s*(?:승인|허용|안전)|무제한\s*권한|항상\s*안전|보안을\s*보장|automatic(?:ally)?\s+(?:approval|permission|safe)|unlimited\s+permission|always\s+safe|guarantee(?:s|d)?\s+security)/iu;

export class AnalogyValidationError extends Error {
  /** @param {string} code @param {string} path */
  constructor(code, path) {
    super(`${path}: ${code}`);
    this.name = "AnalogyValidationError";
    this.code = code;
    this.path = path;
  }
}

/** @param {string} root */
export async function loadAnalogyAssets(root) {
  const [contracts, catalog, contractSchema, mappingSchema] = await Promise.all(
    [
      readJsonDocument(join(root, "content", "v1", "analogy-contracts.json")),
      readJsonDocument(
        join(root, "content", "v1", "validated-analogy-mappings.json"),
      ),
      readJsonDocument(
        join(root, "schemas", "v1", "analogy-contract.schema.json"),
      ),
      readJsonDocument(
        join(root, "schemas", "v1", "validated-analogy-mapping.schema.json"),
      ),
    ],
  );
  return { contracts, catalog, schemas: { contractSchema, mappingSchema } };
}

/**
 * Validate the separately published G004 catalog against the immutable G002
 * candidate provenance and canonical cards.
 *
 * @param {Record<string, unknown>} bundle
 * @param {Record<string, unknown>} assets
 * @param {Date} [now]
 */
export function validateAnalogyAssets(
  bundle,
  assets,
  now = new Date("2026-07-18T00:00:00.000Z"),
) {
  const manifest = record(bundle.manifest, "bundle.manifest");
  const conceptsRoot = record(bundle.concepts, "bundle.concepts");
  const cards = records(conceptsRoot.cards, "bundle.concepts.cards");
  const cardById = indexBy(cards, "id", "bundle.concepts.cards");
  const scenariosRoot = record(bundle.scenarios, "bundle.scenarios");
  const scenarios = records(
    scenariosRoot.scenarios,
    "bundle.scenarios.scenarios",
  );
  const scenarioById = indexBy(
    scenarios,
    "scenario_id",
    "bundle.scenarios.scenarios",
  );
  const profilesRoot = record(bundle.profiles, "bundle.profiles");
  const profiles = records(profilesRoot.profiles, "bundle.profiles.profiles");
  const profileById = indexBy(
    profiles,
    "profile_id",
    "bundle.profiles.profiles",
  );
  const candidatesRoot = record(bundle.mappings, "bundle.mappings");
  const candidates = records(
    candidatesRoot.mappings,
    "bundle.mappings.mappings",
  );
  const candidateById = indexBy(
    candidates,
    "mapping_id",
    "bundle.mappings.mappings",
  );

  const assetRoot = record(assets, "assets");
  exactKeys(assetRoot, ["contracts", "catalog", "schemas"], "assets");
  validateSchemas(record(assetRoot.schemas, "assets.schemas"));

  const contractsRoot = record(assetRoot.contracts, "contracts");
  exactKeys(
    contractsRoot,
    [
      "schema_version",
      "contract_version",
      "content_version",
      "reviewed_at",
      "contracts",
    ],
    "contracts",
  );
  equal(contractsRoot.schema_version, 1, "contracts.schema_version");
  equal(contractsRoot.contract_version, 1, "contracts.contract_version");
  const contentVersion = text(
    contractsRoot.content_version,
    "contracts.content_version",
  );
  pattern(contentVersion, CONTENT_VERSION_PATTERN, "contracts.content_version");
  equal(contentVersion, manifest.content_version, "contracts.content_version");
  date(contractsRoot.reviewed_at, "contracts.reviewed_at");
  const contracts = records(contractsRoot.contracts, "contracts.contracts");
  equal(contracts.length, 10, "contracts.contracts");
  const validatedContracts = contracts.map((contract, index) =>
    validateContract(
      contract,
      `contracts.contracts[${index}]`,
      cardById,
      record(manifest.canonical_hashes, "bundle.manifest.canonical_hashes"),
    ),
  );
  const contractByConcept = indexBy(
    validatedContracts,
    "concept_id",
    "contracts.contracts",
  );

  const catalog = record(assetRoot.catalog, "catalog");
  exactKeys(
    catalog,
    [
      "schema_version",
      "catalog_version",
      "content_version",
      "candidate_registry_hash",
      "mapping_catalog_hash",
      "selection_mode",
      "review",
      "worlds",
      "mappings",
    ],
    "catalog",
  );
  equal(catalog.schema_version, 1, "catalog.schema_version");
  const catalogVersion = text(
    catalog.catalog_version,
    "catalog.catalog_version",
  );
  pattern(catalogVersion, CONTENT_VERSION_PATTERN, "catalog.catalog_version");
  equal(catalog.content_version, contentVersion, "catalog.content_version");
  equal(
    catalog.selection_mode,
    "bundled-validated-selection-only",
    "catalog.selection_mode",
  );
  validateReview(catalog.review);

  const candidateRegistryHash = sha256(stableStringify(candidatesRoot));
  equal(
    catalog.candidate_registry_hash,
    candidateRegistryHash,
    "catalog.candidate_registry_hash",
  );
  pattern(
    text(catalog.mapping_catalog_hash, "catalog.mapping_catalog_hash"),
    HASH_PATTERN,
    "catalog.mapping_catalog_hash",
  );

  const worlds = validateWorlds(catalog.worlds, profileById);
  const worldByProfile = indexBy(worlds, "profile_id", "catalog.worlds");
  const mappings = records(catalog.mappings, "catalog.mappings");
  equal(mappings.length, 30, "catalog.mappings");
  const validatedMappings = mappings.map((mapping, index) =>
    validatePublishedMapping({
      mapping,
      path: `catalog.mappings[${index}]`,
      contractByConcept,
      cardById,
      candidateById,
      scenarioById,
      worldByProfile,
      now,
    }),
  );
  const mappingIds = validatedMappings.map((mapping) =>
    text(mapping.mapping_id, "mapping.mapping_id"),
  );
  unique(mappingIds, "catalog.mappings.mapping_id");
  const expectedMappingIds = profiles.flatMap((profile) => {
    const profileId = text(profile.profile_id, "profile.profile_id");
    return scenarios.map(
      (scenario) =>
        `${profileId}-${text(scenario.scenario_id, "scenario.scenario_id")}-A1`,
    );
  });
  exactSet(mappingIds, expectedMappingIds, "catalog.mappings.mapping_id");

  const mappingCatalogHash = sha256(
    stableStringify({
      catalog_version: catalogVersion,
      content_version: contentVersion,
      mappings: validatedMappings,
    }),
  );
  equal(
    catalog.mapping_catalog_hash,
    mappingCatalogHash,
    "catalog.mapping_catalog_hash",
  );

  const mappingHashes = Object.fromEntries(
    validatedMappings.map((mapping) => [
      text(mapping.mapping_id, "mapping.mapping_id"),
      publishedMappingHash(mapping),
    ]),
  );

  return {
    status: "pass",
    selectionMode: "bundled-validated-selection-only",
    contentVersion,
    contractVersion: 1,
    catalogVersion,
    candidateRegistryHash,
    mappingCatalogHash,
    mappingCount: validatedMappings.length,
    worldCount: worlds.length,
    contracts: validatedContracts,
    mappings: validatedMappings,
    worlds,
    mappingHashes,
  };
}

/** @param {Record<string, unknown>} mapping */
export function publishedMappingHash(mapping) {
  return sha256(stableStringify(mapping));
}

/** @param {Record<string, unknown>} card */
export function analogyRoleIds(card) {
  return list(card.analogy_roles, "card.analogy_roles").map((entry, index) => {
    const value = text(entry, `card.analogy_roles[${index}]`);
    const separator = value.indexOf("=");
    if (separator <= 0 || separator !== value.lastIndexOf("=")) {
      fail("invalid-role-declaration", `card.analogy_roles[${index}]`);
    }
    return value.slice(0, separator);
  });
}

/** @param {unknown} value @param {string} path @param {Map<string, Record<string, unknown>>} cardById @param {Record<string, unknown>} hashes @returns {Record<string, unknown>} */
function validateContract(value, path, cardById, hashes) {
  const contract = record(value, path);
  exactKeys(
    contract,
    [
      "contract_version",
      "concept_id",
      "canonical_fact_hash",
      "role_ids",
      "required_relations",
    ],
    path,
  );
  equal(contract.contract_version, 1, `${path}.contract_version`);
  const conceptId = text(contract.concept_id, `${path}.concept_id`);
  const card = required(cardById, conceptId, `${path}.concept_id`);
  const hash = text(
    contract.canonical_fact_hash,
    `${path}.canonical_fact_hash`,
  );
  pattern(hash, HASH_PATTERN, `${path}.canonical_fact_hash`);
  equal(hash, hashes[conceptId], `${path}.canonical_fact_hash`);
  const roleIds = strings(contract.role_ids, `${path}.role_ids`, 2);
  exactSet(roleIds, analogyRoleIds(card), `${path}.role_ids`);
  const relations = records(
    contract.required_relations,
    `${path}.required_relations`,
  );
  if (relations.length === 0)
    fail("empty-relations", `${path}.required_relations`);
  const relationIds = [];
  const usedRoles = new Set();
  for (const [index, relation] of relations.entries()) {
    const relationPath = `${path}.required_relations[${index}]`;
    exactKeys(
      relation,
      ["relation_id", "from_role", "relation", "to_role"],
      relationPath,
    );
    const relationId = text(
      relation.relation_id,
      `${relationPath}.relation_id`,
    );
    pattern(
      relationId,
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/u,
      `${relationPath}.relation_id`,
    );
    relationIds.push(relationId);
    const from = text(relation.from_role, `${relationPath}.from_role`);
    const to = text(relation.to_role, `${relationPath}.to_role`);
    if (!roleIds.includes(from) || !roleIds.includes(to) || from === to) {
      fail("invalid-relation-direction", relationPath);
    }
    safeText(relation.relation, `${relationPath}.relation`, 120);
    usedRoles.add(from);
    usedRoles.add(to);
  }
  unique(relationIds, `${path}.required_relations.relation_id`);
  exactSet([...usedRoles], roleIds, `${path}.required_relations.roles`);
  return contract;
}

/** @param {unknown} value */
function validateReview(value) {
  const review = record(value, "catalog.review");
  exactKeys(
    review,
    ["status", "basis", "reviewed_at", "evidence_id"],
    "catalog.review",
  );
  equal(review.status, "reviewed", "catalog.review.status");
  safeText(review.basis, "catalog.review.basis", 240);
  date(review.reviewed_at, "catalog.review.reviewed_at");
  safeText(review.evidence_id, "catalog.review.evidence_id", 80);
}

/** @param {unknown} value @param {Map<string, Record<string, unknown>>} profileById @returns {Record<string, unknown>[]} */
function validateWorlds(value, profileById) {
  const worlds = records(value, "catalog.worlds");
  equal(worlds.length, 3, "catalog.worlds");
  for (const [index, world] of worlds.entries()) {
    const path = `catalog.worlds[${index}]`;
    exactKeys(
      world,
      ["profile_id", "world_id", "label", "selection_aliases"],
      path,
    );
    const profileId = text(world.profile_id, `${path}.profile_id`);
    const profile = required(profileById, profileId, `${path}.profile_id`);
    const worldId = text(world.world_id, `${path}.world_id`);
    const profileWorlds = records(
      profile.familiar_worlds,
      `${path}.profile.familiar_worlds`,
    );
    const matchingWorld = profileWorlds.find(
      (item) => item.id === worldId && item.label === world.label,
    );
    if (!matchingWorld) fail("world-not-in-profile-fixture", path);
    const aliases = strings(
      world.selection_aliases,
      `${path}.selection_aliases`,
      1,
    );
    unique(aliases, `${path}.selection_aliases`);
    for (const [aliasIndex, alias] of aliases.entries()) {
      safeText(alias, `${path}.selection_aliases[${aliasIndex}]`, 40);
    }
    if (!aliases.includes(text(world.label, `${path}.label`))) {
      fail("world-label-not-selectable", `${path}.selection_aliases`);
    }
  }
  unique(
    worlds.map((world) => text(world.profile_id, "world.profile_id")),
    "catalog.worlds.profile_id",
  );
  return worlds;
}

/**
 * @param {{
 * mapping: Record<string, unknown>, path: string,
 * contractByConcept: Map<string, Record<string, unknown>>,
 * cardById: Map<string, Record<string, unknown>>,
 * candidateById: Map<string, Record<string, unknown>>,
 * scenarioById: Map<string, Record<string, unknown>>,
 * worldByProfile: Map<string, Record<string, unknown>>,
 * now: Date
 * }} input
 */
export function validatePublishedMapping(input) {
  const { mapping, path } = input;
  exactKeys(
    mapping,
    [
      "mapping_version",
      "mapping_id",
      "candidate_source_id",
      "scenario_id",
      "concept_id",
      "profile_id",
      "profile_world_id",
      "analogy_label",
      "role_map",
      "relation_ids",
      "non_mappings",
      "breakpoint_ref",
      "neutral_fallback_ref",
      "validation_status",
      "confidence",
      "reviewed_at",
      "expires_at",
    ],
    path,
  );
  equal(mapping.mapping_version, 1, `${path}.mapping_version`);
  const mappingId = text(mapping.mapping_id, `${path}.mapping_id`);
  pattern(mappingId, MAPPING_ID_PATTERN, `${path}.mapping_id`);
  const candidateId = text(
    mapping.candidate_source_id,
    `${path}.candidate_source_id`,
  );
  pattern(candidateId, CANDIDATE_ID_PATTERN, `${path}.candidate_source_id`);
  const candidate = required(
    input.candidateById,
    candidateId,
    `${path}.candidate_source_id`,
  );
  const scenarioId = text(mapping.scenario_id, `${path}.scenario_id`);
  const scenario = required(
    input.scenarioById,
    scenarioId,
    `${path}.scenario_id`,
  );
  const conceptId = text(mapping.concept_id, `${path}.concept_id`);
  const contract = required(
    input.contractByConcept,
    conceptId,
    `${path}.concept_id`,
  );
  required(input.cardById, conceptId, `${path}.concept_id`);
  const profileId = text(mapping.profile_id, `${path}.profile_id`);
  const world = required(input.worldByProfile, profileId, `${path}.profile_id`);
  equal(mapping.profile_world_id, world.world_id, `${path}.profile_world_id`);
  equal(candidate.profile_id, profileId, `${path}.candidate_source_id`);
  equal(candidate.concept_id, conceptId, `${path}.candidate_source_id`);
  equal(
    candidateId,
    `${profileId}-${scenarioId}`,
    `${path}.candidate_source_id`,
  );
  equal(mappingId, `${candidateId}-A1`, `${path}.mapping_id`);
  const scenarioConceptIds = strings(
    scenario.concept_ids,
    `${path}.scenario.concept_ids`,
    1,
  );
  if (!scenarioConceptIds.includes(conceptId)) {
    fail("mapping-concept-not-in-scenario", `${path}.concept_id`);
  }
  safeText(mapping.analogy_label, `${path}.analogy_label`, 120);

  const roleMap = record(mapping.role_map, `${path}.role_map`);
  const expectedRoles = strings(
    contract.role_ids,
    `${path}.contract.role_ids`,
    2,
  );
  exactSet(Object.keys(roleMap), expectedRoles, `${path}.role_map`);
  const targets = Object.entries(roleMap).map(([role, target]) =>
    safeText(target, `${path}.role_map.${role}`, 80),
  );
  unique(targets, `${path}.role_map targets`);
  if (targets.some((target) => UNSAFE_ANALOGY_CLAIM_PATTERN.test(target))) {
    fail("invented-safety-or-permission-claim", `${path}.role_map`);
  }

  const relationIds = strings(mapping.relation_ids, `${path}.relation_ids`, 1);
  const expectedRelationIds = records(
    contract.required_relations,
    `${path}.contract.required_relations`,
  ).map((relation) =>
    text(relation.relation_id, `${path}.contract.relation_id`),
  );
  exactSet(relationIds, expectedRelationIds, `${path}.relation_ids`);
  const nonMappings = strings(mapping.non_mappings, `${path}.non_mappings`, 1);
  for (const [index, nonMapping] of nonMappings.entries()) {
    safeText(nonMapping, `${path}.non_mappings[${index}]`, 240, 12);
    if (
      /(구조 검증되지 않아|표시할 수 없음|not structurally validated|cannot be (?:shown|displayed))/iu.test(
        nonMapping,
      )
    ) {
      fail(
        "candidate-placeholder-not-publishable",
        `${path}.non_mappings[${index}]`,
      );
    }
  }
  equal(
    mapping.breakpoint_ref,
    `concepts/${conceptId}#analogy_breakpoint`,
    `${path}.breakpoint_ref`,
  );
  equal(
    mapping.neutral_fallback_ref,
    `concepts/${conceptId}#neutral_example`,
    `${path}.neutral_fallback_ref`,
  );
  equal(mapping.validation_status, "validated", `${path}.validation_status`);
  if (
    !["medium", "high"].includes(text(mapping.confidence, `${path}.confidence`))
  ) {
    fail("invalid-confidence", `${path}.confidence`);
  }
  const reviewedAt = date(mapping.reviewed_at, `${path}.reviewed_at`);
  const expiresAt = date(mapping.expires_at, `${path}.expires_at`);
  if (expiresAt <= reviewedAt)
    fail("mapping-expiry-not-after-review", `${path}.expires_at`);
  if (input.now.toISOString().slice(0, 10) > expiresAt) {
    fail("mapping-expired", `${path}.expires_at`);
  }
  return mapping;
}

/** @param {Record<string, unknown>} schemas */
function validateSchemas(schemas) {
  exactKeys(schemas, ["contractSchema", "mappingSchema"], "assets.schemas");
  for (const [name, value] of Object.entries(schemas)) {
    const schema = record(value, `assets.schemas.${name}`);
    equal(
      schema.$schema,
      "https://json-schema.org/draft/2020-12/schema",
      `assets.schemas.${name}.$schema`,
    );
    equal(schema.additionalProperties, false, `assets.schemas.${name}`);
  }
}

/** @param {unknown} value @param {string} path @returns {Record<string, unknown>} */
function record(value, path) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail("expected-object", path);
  }
  return /** @type {Record<string, unknown>} */ (value);
}

/** @param {unknown} value @param {string} path @returns {unknown[]} */
function list(value, path) {
  if (!Array.isArray(value)) fail("expected-array", path);
  return value;
}

/** @param {unknown} value @param {string} path @returns {Record<string, unknown>[]} */
function records(value, path) {
  return list(value, path).map((item, index) =>
    record(item, `${path}[${index}]`),
  );
}

/** @param {unknown} value @param {string} path @returns {string} */
function text(value, path) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value !== value.normalize("NFC")
  ) {
    fail("expected-non-empty-nfc-string", path);
  }
  return value;
}

/** @param {unknown} value @param {string} path @param {number} maximum @param {number} [minimum] @returns {string} */
function safeText(value, path, maximum, minimum = 1) {
  const result = text(value, path);
  if (
    result.length < minimum ||
    result.length > maximum ||
    CONTROL_PATTERN.test(result)
  ) {
    fail("unsafe-or-out-of-bounds-text", path);
  }
  return result;
}

/** @param {unknown} value @param {string} path @param {number} minimum @returns {string[]} */
function strings(value, path, minimum) {
  const values = list(value, path).map((item, index) =>
    text(item, `${path}[${index}]`),
  );
  if (values.length < minimum) fail("too-few-items", path);
  unique(values, path);
  return values;
}

/** @param {Record<string, unknown>} value @param {string[]} expected @param {string} path */
function exactKeys(value, expected, path) {
  exactSet(Object.keys(value), expected, `${path} keys`);
}

/** @param {unknown} actual @param {unknown} expected @param {string} path */
function equal(actual, expected, path) {
  if (actual !== expected) fail("unexpected-value", path);
}

/** @param {string} value @param {RegExp} regex @param {string} path */
function pattern(value, regex, path) {
  if (!regex.test(value)) fail("pattern-mismatch", path);
}

/** @param {unknown} value @param {string} path @returns {string} */
function date(value, path) {
  const result = text(value, path);
  if (
    !/^\d{4}-\d{2}-\d{2}$/u.test(result) ||
    Number.isNaN(Date.parse(`${result}T00:00:00.000Z`))
  ) {
    fail("invalid-date", path);
  }
  return result;
}

/** @param {string[]} values @param {string} path */
function unique(values, path) {
  if (new Set(values).size !== values.length) fail("duplicate-value", path);
}

/** @param {string[]} actual @param {string[]} expected @param {string} path */
function exactSet(actual, expected, path) {
  const left = [...actual].sort();
  const right = [...expected].sort();
  if (stableStringify(left) !== stableStringify(right)) {
    fail("set-mismatch", path);
  }
}

/** @param {Record<string, unknown>[]} values @param {string} key @param {string} path @returns {Map<string, Record<string, unknown>>} */
function indexBy(values, key, path) {
  /** @type {Map<string, Record<string, unknown>>} */
  const result = new Map();
  for (const [index, value] of values.entries()) {
    const id = text(value[key], `${path}[${index}].${key}`);
    if (result.has(id)) fail("duplicate-id", `${path}[${index}].${key}`);
    result.set(id, value);
  }
  return result;
}

/** @param {Map<string, Record<string, unknown>>} map @param {string} key @param {string} path @returns {Record<string, unknown>} */
function required(map, key, path) {
  const value = map.get(key);
  if (!value) fail("unknown-reference", path);
  return value;
}

/** @param {string} code @param {string} path @returns {never} */
function fail(code, path) {
  throw new AnalogyValidationError(code, path);
}
