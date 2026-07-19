import { parseJsonDocument } from "../content/load.mjs";
import { sha256, stableStringify } from "../content/stable-json.mjs";
import {
  constructApprovedProjection,
  projectionDigest,
  TRANSMISSION_DESTINATION,
  TRANSMISSION_PURPOSE,
} from "../profile/privacy.mjs";
import { sensitiveReason } from "../profile/sanitize.mjs";
import {
  deletePrivateStoreFile,
  readPrivateStoreFile,
  replacePrivateStoreFile,
} from "../private-store.mjs";
export const PERSONALIZATION_REQUEST_VERSION = 2;
export const PERSONALIZED_MAPPING_FILE = "personalized-analogy-mappings.json";
export const PERSONALIZED_MAPPING_STORE_VERSION = 2;
export const MAX_PERSONALIZED_MAPPING_BYTES = 64 * 1024;
export const MAX_PERSONALIZED_MAPPINGS = 32;

// The reviewed teaching focus for each multi-concept encounter. This is
// canonical scenario configuration, not a user taxonomy: the nouns still come
// only from the user's approved local profile.
/** @type {Readonly<Record<string, string>>} */
export const PERSONALIZATION_CONCEPT_BY_SCENARIO = Object.freeze({
  S01: "package-dependency",
  S02: "process-server",
  S03: "environment-variable-config",
  S04: "api-request-response",
  S05: "credential-api-key-access-token",
  S06: "database-table-query",
  S07: "mcp-tool-resource",
  S08: "permission-authentication-authorization",
  S09: "file-path-project-repository",
  S10: "local-remote-cloud-deploy",
});

const REQUEST_FIELDS = [
  "schema_version",
  "request_id",
  "destination",
  "purpose",
  "canonical_fact_set_hash",
  "scenario_id",
  "concept_id",
  "language",
  "presentation_preference",
  "familiar_contexts",
  "projection_digest",
  "approval_instance_digest",
  "role_ids",
  "required_relations",
];
const CANDIDATE_FIELDS = [
  "schema_version",
  "request_id",
  "source_context",
  "analogy_label",
  "role_bindings",
];
const STORE_FIELDS = ["schema_version", "entries"];
const ENTRY_FIELDS = ["request_id", "candidate"];
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const SAFE_PRESENTATION_CHARACTERS = /^[\p{L}\p{M}\p{N}\s·,.:/'"&()+-]+$/u;
const ROLE_PAIR_SEPARATOR = " + ";
const LOCALLY_VALIDATED_RESOLUTIONS = new WeakSet();

/** @typedef {{ relation_id: string, from_role: string, relation: string, to_role: string }} PersonalizationRelation */
/** @typedef {{ schema_version: 2, request_id: string, destination: string, purpose: string, canonical_fact_set_hash: string, scenario_id: string, concept_id: string, language: "en" | "ko", presentation_preference: "analogy_first" | "try_first" | "checklist" | "neutral", familiar_contexts: string[], projection_digest: string, approval_instance_digest: string, role_ids: string[], required_relations: PersonalizationRelation[] }} PersonalizationRequest */
/** @typedef {{ schema_version: 2, request_id: string, source_context: string, analogy_label: string, role_bindings: Record<string, string> }} PersonalizationCandidate */
/** @typedef {{ request_id: string, candidate: PersonalizationCandidate }} PersonalizationStoreEntry */
/** @typedef {{ schema_version: 2, entries: PersonalizationStoreEntry[] }} PersonalizationStore */

/**
 * Create the only user-profile-shaped packet a host-managed analogy mapper may
 * see. It contains the consent-bound projection plus role/relation slots, but
 * no canonical definition, safety decision, code, command, permission, raw
 * profile, experience, concern, identifier, or history.
 *
 * @param {Awaited<ReturnType<import("./engine.mjs").loadAnalogyRuntime>>} runtime
 * @param {unknown} profile
 * @param {string} scenarioId
 * @returns {{ status: "ready", request: Readonly<PersonalizationRequest> } | { status: "fallback", reason: string }}
 */
export function createPersonalizationRequest(runtime, profile, scenarioId) {
  const constructed = constructApprovedProjection(profile);
  if (constructed.status !== "ready") return constructed;
  const scenario = runtime.content.scenarios.find(
    (item) => item.scenario_id === scenarioId,
  );
  if (!scenario) return { status: "fallback", reason: "unknown-scenario" };
  const conceptIds = /** @type {string[]} */ (scenario.concept_ids);
  const teachingConcept = PERSONALIZATION_CONCEPT_BY_SCENARIO[scenarioId];
  if (!teachingConcept || !conceptIds.includes(teachingConcept)) {
    return { status: "fallback", reason: "analogy-contract-unavailable" };
  }
  const contract = runtime.publication.contracts.find(
    (item) => item.concept_id === teachingConcept,
  );
  if (!contract) {
    return { status: "fallback", reason: "analogy-contract-unavailable" };
  }
  const projection = constructed.projection;
  const familiarContexts = (projection.familiar_worlds ?? []).map((world) =>
    safeText(world.label, "familiar context", 40),
  );
  if (familiarContexts.length === 0) {
    return { status: "fallback", reason: "no-approved-familiar-context" };
  }
  if (
    new Set(familiarContexts.map(canonicalApprovedLabel)).size !==
    familiarContexts.length
  ) {
    return { status: "fallback", reason: "duplicate-familiar-context" };
  }
  const conceptId = String(contract.concept_id);
  const factSetHash = String(
    /** @type {Record<string, unknown>} */ (
      runtime.content.scenario_fact_hashes
    )[scenarioId],
  );
  const roleIds = textList(contract.role_ids, "role_ids", 2, 32, 80);
  const requiredRelations = relationList(contract.required_relations, roleIds);
  const withoutId = {
    schema_version: PERSONALIZATION_REQUEST_VERSION,
    destination: TRANSMISSION_DESTINATION,
    purpose: TRANSMISSION_PURPOSE,
    canonical_fact_set_hash: factSetHash,
    scenario_id: scenarioId,
    concept_id: conceptId,
    language: projection.language ?? "en",
    presentation_preference:
      projection.presentation_preference ?? "analogy_first",
    familiar_contexts: familiarContexts,
    role_ids: roleIds,
    required_relations: requiredRelations,
    projection_digest: projectionDigest(projection),
    approval_instance_digest: constructed.approval_instance_digest,
  };
  const requestId = `FTR-${sha256(stableStringify(withoutId)).slice(0, 32)}`;
  /** @type {PersonalizationRequest} */
  const request = {
    schema_version: PERSONALIZATION_REQUEST_VERSION,
    request_id: requestId,
    destination: withoutId.destination,
    purpose: withoutId.purpose,
    canonical_fact_set_hash: withoutId.canonical_fact_set_hash,
    scenario_id: withoutId.scenario_id,
    concept_id: withoutId.concept_id,
    language: withoutId.language,
    presentation_preference: withoutId.presentation_preference,
    familiar_contexts: withoutId.familiar_contexts,
    projection_digest: withoutId.projection_digest,
    approval_instance_digest: withoutId.approval_instance_digest,
    role_ids: withoutId.role_ids,
    required_relations: withoutId.required_relations,
  };
  return { status: "ready", request: deepFreeze(request) };
}

/**
 * Validate a model-authored role-slot binding and mint a locally trusted
 * resolution. Relations, breakpoint, canonical fact hash, and neutral fallback
 * are derived from reviewed local content rather than accepted from the model.
 *
 * @param {Awaited<ReturnType<import("./engine.mjs").loadAnalogyRuntime>>} runtime
 * @param {unknown} requestValue
 * @param {unknown} candidateValue
 */
export function validatePersonalizedCandidate(
  runtime,
  requestValue,
  candidateValue,
) {
  const request = validateRequest(runtime, requestValue);
  const candidate = record(candidateValue, "$candidate");
  exactKeys(candidate, CANDIDATE_FIELDS, "$candidate");
  equal(
    candidate.schema_version,
    PERSONALIZATION_REQUEST_VERSION,
    "$candidate.schema_version",
  );
  equal(candidate.request_id, request.request_id, "$candidate.request_id");
  const sourceContext = safeText(
    candidate.source_context,
    "$candidate.source_context",
    40,
  );
  if (!request.familiar_contexts.includes(sourceContext)) {
    fail("source-context-not-approved", "$candidate.source_context");
  }
  const analogyLabel = safeText(
    candidate.analogy_label,
    "$candidate.analogy_label",
    40,
  );
  if (analogyLabel !== sourceContext) {
    fail("analogy-label-not-approved", "$candidate.analogy_label");
  }
  const bindingsValue = record(
    candidate.role_bindings,
    "$candidate.role_bindings",
  );
  exactKeys(bindingsValue, request.role_ids, "$candidate.role_bindings");
  /** @type {Record<string, string>} */
  const roleMap = {};
  for (const roleId of request.role_ids) {
    roleMap[roleId] = safeCandidateRoleTarget(
      bindingsValue[roleId],
      request.familiar_contexts,
      `$candidate.role_bindings.${roleId}`,
    );
  }
  if (
    new Set(
      Object.values(roleMap).map((value) =>
        canonicalRoleTarget(value, request.familiar_contexts),
      ),
    ).size !== request.role_ids.length
  ) {
    fail("duplicate-role-target", "$candidate.role_bindings");
  }

  const card = runtime.content.concepts.find(
    (item) => item.id === request.concept_id,
  );
  if (!card) fail("concept-card-unavailable", "$request.concept_id");
  const relations = request.required_relations.map((relation) => ({
    relation_id: relation.relation_id,
    from_role: relation.from_role,
    from_target: roleMap[relation.from_role],
    relation: relation.relation,
    to_role: relation.to_role,
    to_target: roleMap[relation.to_role],
  }));
  const mappingPayload = {
    request_id: request.request_id,
    scenario_id: request.scenario_id,
    concept_id: request.concept_id,
    source_context: sourceContext,
    analogy_label: analogyLabel,
    role_map: roleMap,
    relation_ids: relations.map((relation) => relation.relation_id),
  };
  const mappingHash = sha256(stableStringify(mappingPayload));
  const resolution = deepFreeze({
    kind: /** @type {const} */ ("mapped"),
    reason: /** @type {const} */ ("validated-profile-binding"),
    mapping_id: `U-${request.request_id.slice(4, 16)}-${mappingHash.slice(0, 12)}`,
    mapping_version: 1,
    mapping_hash: mappingHash,
    request_id: request.request_id,
    scenario_id: request.scenario_id,
    profile_world_id: `user-authored-${request.request_id.slice(4, 16)}`,
    analogy_concept_id: request.concept_id,
    analogy_label: analogyLabel,
    role_map: roleMap,
    relations,
    non_mappings: [String(card.analogy_breakpoint)],
    breakpoint: String(card.analogy_breakpoint),
    neutral_fallback: String(card.neutral_example),
    controls: ["different", "no_analogy", "unfamiliar"],
    source: /** @type {const} */ ("profile-adapter"),
    profile_projection_calls: /** @type {const} */ (1),
    network_calls: /** @type {const} */ (0),
  });
  LOCALLY_VALIDATED_RESOLUTIONS.add(resolution);
  return resolution;
}

/** @param {unknown} value */
export function isLocallyValidatedPersonalizedResolution(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    LOCALLY_VALIDATED_RESOLUTIONS.has(value)
  );
}

/**
 * @param {string} dataDir
 * @param {Awaited<ReturnType<import("./engine.mjs").loadAnalogyRuntime>>} runtime
 * @param {unknown} requestValue
 * @param {unknown} candidateValue
 */
export async function savePersonalizedCandidate(
  dataDir,
  runtime,
  requestValue,
  candidateValue,
) {
  const request = validateRequest(runtime, requestValue);
  const resolution = validatePersonalizedCandidate(
    runtime,
    request,
    candidateValue,
  );
  const candidate = normalizedCandidate(candidateValue);
  const store = await loadStore(dataDir);
  const entries = store.entries.filter(
    (entry) => entry.request_id !== request.request_id,
  );
  entries.push({ request_id: request.request_id, candidate });
  const bounded = entries.slice(-MAX_PERSONALIZED_MAPPINGS);
  await writeStore(dataDir, {
    schema_version: PERSONALIZED_MAPPING_STORE_VERSION,
    entries: bounded,
  });
  return resolution;
}

/**
 * @param {string | undefined} dataDir
 * @param {Awaited<ReturnType<import("./engine.mjs").loadAnalogyRuntime>>} runtime
 * @param {unknown} requestValue
 */
export async function loadPersonalizedResolution(
  dataDir,
  runtime,
  requestValue,
) {
  if (!dataDir) return null;
  try {
    const request = validateRequest(runtime, requestValue);
    const store = await loadStore(dataDir);
    const entry = store.entries.find(
      (candidate) => candidate.request_id === request.request_id,
    );
    return entry
      ? validatePersonalizedCandidate(runtime, request, entry.candidate)
      : null;
  } catch {
    return null;
  }
}

/** @param {string | undefined} dataDir @param {string} requestId */
export async function rejectPersonalizedCandidate(dataDir, requestId) {
  if (!dataDir) return false;
  const store = await loadStore(dataDir);
  const entries = store.entries.filter(
    (entry) => entry.request_id !== requestId,
  );
  if (entries.length === store.entries.length) return false;
  await writeStore(dataDir, {
    schema_version: PERSONALIZED_MAPPING_STORE_VERSION,
    entries,
  });
  return true;
}

/** @param {string | undefined} dataDir */
export async function clearPersonalizedMappings(dataDir) {
  if (!dataDir) return { ok: true, deleted: false };
  try {
    const deleted = await deletePrivateStoreFile(
      dataDir,
      PERSONALIZED_MAPPING_FILE,
      "Fairytail personalized analogy store",
    );
    return { ok: true, deleted };
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return { ok: true, deleted: false };
    }
    throw error;
  }
}

/** @param {Awaited<ReturnType<import("./engine.mjs").loadAnalogyRuntime>>} runtime @param {unknown} value @returns {Readonly<PersonalizationRequest>} */
function validateRequest(runtime, value) {
  const request = record(value, "$request");
  exactKeys(request, REQUEST_FIELDS, "$request");
  equal(
    request.schema_version,
    PERSONALIZATION_REQUEST_VERSION,
    "$request.schema_version",
  );
  const requestId = safeFixedText(
    request.request_id,
    "$request.request_id",
    /^FTR-[a-f0-9]{32}$/u,
  );
  equal(request.destination, TRANSMISSION_DESTINATION, "$request.destination");
  equal(request.purpose, TRANSMISSION_PURPOSE, "$request.purpose");
  const factHash = safeFixedText(
    request.canonical_fact_set_hash,
    "$request.canonical_fact_set_hash",
    /^[a-f0-9]{64}$/u,
  );
  const scenarioId = safeFixedText(
    request.scenario_id,
    "$request.scenario_id",
    /^S[0-9]{2}$/u,
  );
  const conceptId = safeFixedText(
    request.concept_id,
    "$request.concept_id",
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/u,
  );
  const language = request.language;
  if (language !== "en" && language !== "ko") {
    fail("unsupported-language", "$request.language");
  }
  const presentation = request.presentation_preference;
  if (
    !["analogy_first", "try_first", "checklist", "neutral"].includes(
      String(presentation),
    )
  ) {
    fail("unsupported-presentation", "$request.presentation_preference");
  }
  const familiarContexts = textList(
    request.familiar_contexts,
    "$request.familiar_contexts",
    1,
    5,
    40,
  );
  const approvedProjectionDigest = safeFixedText(
    request.projection_digest,
    "$request.projection_digest",
    /^[a-f0-9]{64}$/u,
  );
  const approvalInstanceDigest = safeFixedText(
    request.approval_instance_digest,
    "$request.approval_instance_digest",
    /^[a-f0-9]{64}$/u,
  );
  const roleIds = textList(request.role_ids, "$request.role_ids", 2, 32, 80);
  const requiredRelations = relationList(request.required_relations, roleIds);
  const scenario = runtime.content.scenarios.find(
    (item) => item.scenario_id === scenarioId,
  );
  const contract = runtime.publication.contracts.find(
    (item) => item.concept_id === conceptId,
  );
  if (
    !scenario ||
    !(/** @type {string[]} */ (scenario.concept_ids).includes(conceptId)) ||
    !contract ||
    JSON.stringify(contract.role_ids) !== JSON.stringify(roleIds) ||
    JSON.stringify(contract.required_relations) !==
      JSON.stringify(requiredRelations) ||
    String(
      /** @type {Record<string, unknown>} */ (
        runtime.content.scenario_fact_hashes
      )[scenarioId],
    ) !== factHash
  ) {
    fail("request-contract-drift", "$request");
  }
  const expectedRequestId = `FTR-${sha256(
    stableStringify({
      schema_version: PERSONALIZATION_REQUEST_VERSION,
      destination: TRANSMISSION_DESTINATION,
      purpose: TRANSMISSION_PURPOSE,
      canonical_fact_set_hash: factHash,
      scenario_id: scenarioId,
      concept_id: conceptId,
      language,
      presentation_preference: presentation,
      familiar_contexts: familiarContexts,
      role_ids: roleIds,
      required_relations: requiredRelations,
      projection_digest: approvedProjectionDigest,
      approval_instance_digest: approvalInstanceDigest,
    }),
  ).slice(0, 32)}`;
  if (requestId !== expectedRequestId) {
    fail("request-id-mismatch", "$request.request_id");
  }
  return deepFreeze({
    schema_version: PERSONALIZATION_REQUEST_VERSION,
    request_id: requestId,
    destination: TRANSMISSION_DESTINATION,
    purpose: TRANSMISSION_PURPOSE,
    canonical_fact_set_hash: factHash,
    scenario_id: scenarioId,
    concept_id: conceptId,
    language: /** @type {"en" | "ko"} */ (language),
    presentation_preference:
      /** @type {PersonalizationRequest["presentation_preference"]} */ (
        presentation
      ),
    familiar_contexts: familiarContexts,
    projection_digest: approvedProjectionDigest,
    approval_instance_digest: approvalInstanceDigest,
    role_ids: roleIds,
    required_relations: requiredRelations,
  });
}

/** @param {unknown} value @returns {PersonalizationCandidate} */
function normalizedCandidate(value) {
  const candidate = record(value, "$candidate");
  exactKeys(candidate, CANDIDATE_FIELDS, "$candidate");
  equal(
    candidate.schema_version,
    PERSONALIZATION_REQUEST_VERSION,
    "$candidate.schema_version",
  );
  const bindings = record(candidate.role_bindings, "$candidate.role_bindings");
  return {
    schema_version: PERSONALIZATION_REQUEST_VERSION,
    request_id: String(candidate.request_id),
    source_context: String(candidate.source_context),
    analogy_label: String(candidate.analogy_label),
    role_bindings: Object.fromEntries(
      Object.entries(bindings).map(([key, item]) => [key, String(item)]),
    ),
  };
}

/** @param {string} dataDir @returns {Promise<PersonalizationStore>} */
async function loadStore(dataDir) {
  try {
    const bytes = await readPrivateStoreFile(
      dataDir,
      PERSONALIZED_MAPPING_FILE,
      MAX_PERSONALIZED_MAPPING_BYTES,
      "Fairytail personalized analogy store",
    );
    return validateStore(
      parseJsonDocument(bytes, "Fairytail personalized analogy store"),
    );
  } catch (error) {
    if (
      (isNodeError(error) && error.code === "ENOENT") ||
      error instanceof TypeError ||
      error instanceof SyntaxError
    ) {
      return {
        schema_version: PERSONALIZED_MAPPING_STORE_VERSION,
        entries: [],
      };
    }
    throw error;
  }
}

/** @param {string} dataDir @param {unknown} value */
async function writeStore(dataDir, value) {
  const store = validateStore(value);
  await replacePrivateStoreFile(
    dataDir,
    PERSONALIZED_MAPPING_FILE,
    `${JSON.stringify(store, null, 2)}\n`,
    MAX_PERSONALIZED_MAPPING_BYTES,
    "Fairytail personalized analogy store",
  );
}

/** @param {unknown} value @returns {PersonalizationStore} */
function validateStore(value) {
  const store = record(value, "$store");
  exactKeys(store, STORE_FIELDS, "$store");
  equal(
    store.schema_version,
    PERSONALIZED_MAPPING_STORE_VERSION,
    "$store.schema_version",
  );
  if (
    !Array.isArray(store.entries) ||
    store.entries.length > MAX_PERSONALIZED_MAPPINGS
  ) {
    fail("invalid-entries", "$store.entries");
  }
  const entries = store.entries.map((value, index) => {
    const entry = record(value, `$store.entries[${index}]`);
    exactKeys(entry, ENTRY_FIELDS, `$store.entries[${index}]`);
    const requestId = safeFixedText(
      entry.request_id,
      `$store.entries[${index}].request_id`,
      /^FTR-[a-f0-9]{32}$/u,
    );
    const candidate = normalizedCandidate(entry.candidate);
    if (candidate.request_id !== requestId) {
      fail("entry-request-mismatch", `$store.entries[${index}]`);
    }
    return { request_id: requestId, candidate };
  });
  if (
    new Set(entries.map((entry) => entry.request_id)).size !== entries.length
  ) {
    fail("duplicate-request", "$store.entries");
  }
  return { schema_version: PERSONALIZED_MAPPING_STORE_VERSION, entries };
}

/**
 * The mapper is a selector, not a prose author. A role target must copy one
 * approved user label exactly, or join two distinct approved labels with the
 * one literal local separator. No model-authored adjective, verb, scope, fact,
 * or safety claim can therefore enter the rendered analogy.
 *
 * @param {unknown} value
 * @param {string[]} approvedLabels
 * @param {string} path
 * @returns {string}
 */
function safeCandidateRoleTarget(value, approvedLabels, path) {
  const normalized = safeText(value, path, 83);
  if (approvedLabels.includes(normalized)) return normalized;
  const parts = normalized.split(ROLE_PAIR_SEPARATOR);
  if (
    parts.length !== 2 ||
    parts.some((part) => !approvedLabels.includes(part)) ||
    canonicalApprovedLabel(parts[0]) === canonicalApprovedLabel(parts[1])
  ) {
    fail("role-target-not-approved", path);
  }
  return normalized;
}

/** @param {string} value @param {string[]} approvedLabels */
function canonicalRoleTarget(value, approvedLabels) {
  if (approvedLabels.includes(value)) return canonicalApprovedLabel(value);
  return value
    .split(ROLE_PAIR_SEPARATOR)
    .map(canonicalApprovedLabel)
    .sort()
    .join("\0");
}

/** @param {string} value */
function canonicalApprovedLabel(value) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[\s·,.:/'"&()+-]+/gu, "");
}

/** @param {unknown} value @param {string} path @param {number} maximum @returns {string} */
function safeText(value, path, maximum) {
  if (typeof value !== "string" || value !== value.normalize("NFC")) {
    fail("invalid-text", path);
  }
  const normalized = value.trim().replace(/\s+/gu, " ");
  if (
    normalized.length === 0 ||
    [...normalized].length > maximum ||
    sensitiveReason(normalized) ||
    !SAFE_PRESENTATION_CHARACTERS.test(normalized)
  ) {
    fail("unsafe-text", path);
  }
  return normalized;
}

/** @param {unknown} value @param {string} path @param {RegExp} pattern @returns {string} */
function safeFixedText(value, path, pattern) {
  if (typeof value !== "string" || !pattern.test(value)) {
    fail("invalid-fixed-text", path);
  }
  return value;
}

/** @param {unknown} value @param {string} path @param {number} minimum @param {number} maximum @param {number} maximumLength @returns {string[]} */
function textList(value, path, minimum, maximum, maximumLength) {
  if (
    !Array.isArray(value) ||
    value.length < minimum ||
    value.length > maximum
  ) {
    fail("invalid-list", path);
  }
  const result = value.map((item, index) =>
    safeText(item, `${path}[${index}]`, maximumLength),
  );
  if (new Set(result).size !== result.length) fail("duplicate-list", path);
  return result;
}

/** @param {unknown} value @param {string[]} roleIds @returns {PersonalizationRelation[]} */
function relationList(value, roleIds) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 64) {
    fail("invalid-relations", "$request.required_relations");
  }
  const roleSet = new Set(roleIds);
  return value.map((item, index) => {
    const path = `$request.required_relations[${index}]`;
    const relation = record(item, path);
    exactKeys(
      relation,
      ["relation_id", "from_role", "relation", "to_role"],
      path,
    );
    const relationId = safeFixedText(
      relation.relation_id,
      `${path}.relation_id`,
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/u,
    );
    const fromRole = safeText(relation.from_role, `${path}.from_role`, 80);
    const relationText = safeText(relation.relation, `${path}.relation`, 160);
    const toRole = safeText(relation.to_role, `${path}.to_role`, 80);
    if (!roleSet.has(fromRole) || !roleSet.has(toRole)) {
      fail("relation-role-mismatch", path);
    }
    return {
      relation_id: relationId,
      from_role: fromRole,
      relation: relationText,
      to_role: toRole,
    };
  });
}

/** @param {unknown} value @param {string} path */
function record(value, path) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail("not-an-object", path);
  }
  const result = /** @type {Record<string, any>} */ (value);
  if (Object.keys(result).some((key) => FORBIDDEN_KEYS.has(key))) {
    fail("forbidden-key", path);
  }
  return result;
}

/** @param {Record<string, any>} value @param {string[]} expected @param {string} path */
function exactKeys(value, expected, path) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (
    actual.length !== wanted.length ||
    actual.some((key, index) => key !== wanted[index])
  ) {
    fail("unexpected-keys", path);
  }
}

/** @param {unknown} actual @param {unknown} expected @param {string} path */
function equal(actual, expected, path) {
  if (actual !== expected) fail("unexpected-value", path);
}

/** @param {string} code @param {string} path @returns {never} */
function fail(code, path) {
  throw new TypeError(
    `Invalid Fairytail personalized analogy: ${code} at ${path}`,
  );
}

/** @template T @param {T} value @returns {Readonly<T>} */
function deepFreeze(value) {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/** @param {unknown} error */
function isNodeError(error) {
  return error instanceof Error && "code" in error;
}
