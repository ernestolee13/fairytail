import { join } from "node:path";

import { readJsonDocument } from "../content/load.mjs";
import { sha256, stableStringify } from "../content/stable-json.mjs";
import { SOURCE_LOCALE, SUPPORTED_LOCALES } from "./locale.mjs";

const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const INVARIANT_KEYS = new Set([
  "concept_id",
  "scenario_id",
  "mapping_id",
  "profile_id",
  "world_id",
  "relation_id",
  "kind",
]);

export class PresentationCatalogError extends Error {
  /** @param {string} code @param {string} path */
  constructor(code, path) {
    super(`${path}: ${code}`);
    this.name = "PresentationCatalogError";
    this.code = code;
    this.path = path;
  }
}

/**
 * Load the reviewed Korean presentation catalog. English is implicit because
 * the canonical runtime itself is the English source of truth.
 *
 * @param {string} root
 * @param {Awaited<ReturnType<import("../analogy/engine.mjs").loadAnalogyRuntime>> | Record<string, any>} runtime
 */
export async function loadPresentationCatalogs(root, runtime) {
  const [catalogValue, schemaValue] = await Promise.all([
    readJsonDocument(
      join(root, "content", "locales", "ko", "presentation.json"),
    ),
    readJsonDocument(
      join(root, "schemas", "v1", "presentation-catalog.schema.json"),
    ),
  ]);
  const schema = record(schemaValue, "$schema");
  equal(
    schema.$schema,
    "https://json-schema.org/draft/2020-12/schema",
    "$schema.$schema",
  );
  equal(schema.additionalProperties, false, "$schema.additionalProperties");
  const validated = validatePresentationCatalog(runtime, catalogValue);
  return deepFreeze({
    source_locale: SOURCE_LOCALE,
    supported_locales: [...SUPPORTED_LOCALES],
    catalogs: { ko: validated.catalog },
    catalog_hashes: { ko: validated.catalogHash },
    unavailable_locale_reasons: {},
  });
}

/** @param {string} reason */
export function englishOnlyLocalization(reason) {
  return deepFreeze({
    source_locale: SOURCE_LOCALE,
    supported_locales: [SOURCE_LOCALE],
    catalogs: {},
    catalog_hashes: {},
    unavailable_locale_reasons: { ko: reason },
  });
}

/**
 * @param {Record<string, any>} runtime
 * @param {unknown} value
 */
export function validatePresentationCatalog(runtime, value) {
  const catalog = record(value, "$catalog");
  exactKeys(
    catalog,
    [
      "schema_version",
      "catalog_version",
      "source_locale",
      "locale",
      "source_content_version",
      "review",
      "worlds",
      "concepts",
      "scenarios",
      "contracts",
      "mappings",
    ],
    "$catalog",
  );
  equal(catalog.schema_version, 1, "$catalog.schema_version");
  safeText(catalog.catalog_version, "$catalog.catalog_version", 40);
  equal(catalog.source_locale, SOURCE_LOCALE, "$catalog.source_locale");
  equal(catalog.locale, "ko", "$catalog.locale");
  equal(
    catalog.source_content_version,
    runtime.content.content_version,
    "$catalog.source_content_version",
  );
  validateReview(catalog.review);

  const source = presentationSource(runtime);
  validateTranslatedCollection(source.worlds, catalog.worlds, "world_id");
  validateTranslatedCollection(source.concepts, catalog.concepts, "concept_id");
  validateTranslatedCollection(
    source.scenarios,
    catalog.scenarios,
    "scenario_id",
  );
  validateTranslatedCollection(
    source.contracts,
    catalog.contracts,
    "concept_id",
  );
  validateTranslatedCollection(source.mappings, catalog.mappings, "mapping_id");

  return {
    catalog: deepFreeze(structuredClone(catalog)),
    catalogHash: sha256(stableStringify(catalog)),
    source,
  };
}

/**
 * Return only fields that can affect current learner-facing presentation or
 * localized familiar-world selection. IDs and relation roles remain invariant.
 *
 * @param {Record<string, any>} runtime
 */
export function presentationSource(runtime) {
  const worlds = /** @type {Record<string, any>[]} */ (
    runtime.publication.worlds
  );
  const concepts = /** @type {Record<string, any>[]} */ (
    runtime.content.concepts
  );
  const scenarios = /** @type {Record<string, any>[]} */ (
    runtime.content.scenarios
  );
  const contracts = /** @type {Record<string, any>[]} */ (
    runtime.publication.contracts
  );
  const mappings = /** @type {Record<string, any>[]} */ (
    runtime.publication.mappings
  );
  return deepFreeze({
    worlds: worlds.map((world) => ({
      profile_id: world.profile_id,
      world_id: world.world_id,
      label: world.label,
      selection_aliases: structuredClone(world.selection_aliases),
    })),
    concepts: concepts.map((card) => ({
      concept_id: card.id,
      canonical_definition: card.canonical_definition,
      mechanism: structuredClone(card.mechanism),
      safety_boundary: structuredClone(card.safety_boundary),
      analogy_breakpoint: card.analogy_breakpoint,
      neutral_example: card.neutral_example,
    })),
    scenarios: scenarios.map((scenario) => ({
      scenario_id: scenario.scenario_id,
      fixed_criterion: scenario.fixed_criterion,
      encounter: scenario.encounter,
      pre_action: structuredClone(scenario.pre_action),
      next_action: scenario.next_action,
      evidence: scenario.evidence,
      diagnostic_question: scenario.diagnostic_question,
      policy_labels: structuredClone(scenario.policy_labels),
    })),
    contracts: contracts.map((contract) => {
      const relations = /** @type {Record<string, any>[]} */ (
        contract.required_relations
      );
      return {
        concept_id: contract.concept_id,
        relations: relations.map((relation) => ({
          relation_id: relation.relation_id,
          relation: relation.relation,
        })),
      };
    }),
    mappings: mappings.map((mapping) => ({
      mapping_id: mapping.mapping_id,
      analogy_label: mapping.analogy_label,
      role_map: structuredClone(mapping.role_map),
      non_mappings: structuredClone(mapping.non_mappings),
    })),
  });
}

/**
 * Build a reviewed translation entry set from a source projection and an
 * isomorphic translation projection. Used by the one-time importer and tests.
 *
 * @param {ReturnType<typeof presentationSource>} source
 * @param {ReturnType<typeof presentationSource>} translation
 */
export function attachSourceHashes(source, translation) {
  return {
    worlds: attachCollection(source.worlds, translation.worlds, "world_id"),
    concepts: attachCollection(
      source.concepts,
      translation.concepts,
      "concept_id",
    ),
    scenarios: attachCollection(
      source.scenarios,
      translation.scenarios,
      "scenario_id",
    ),
    contracts: attachCollection(
      source.contracts,
      translation.contracts,
      "concept_id",
    ),
    mappings: attachCollection(
      source.mappings,
      translation.mappings,
      "mapping_id",
    ),
  };
}

/** @param {Record<string, unknown>[]} source @param {Record<string, unknown>[]} translation @param {string} idKey */
function attachCollection(source, translation, idKey) {
  const byId = new Map(translation.map((entry) => [entry[idKey], entry]));
  return source.map((sourceEntry) => {
    const translated = byId.get(sourceEntry[idKey]);
    if (!translated)
      fail("missing-translation", `${idKey}:${sourceEntry[idKey]}`);
    assertTranslationShape(
      sourceEntry,
      translated,
      `$translation.${sourceEntry[idKey]}`,
    );
    return {
      source_hash: sha256(stableStringify(sourceEntry)),
      ...structuredClone(translated),
    };
  });
}

/** @param {Record<string, unknown>[]} source @param {unknown} translatedValue @param {string} idKey */
function validateTranslatedCollection(source, translatedValue, idKey) {
  const translated = records(translatedValue, `$catalog.${idKey}`);
  equal(translated.length, source.length, `$catalog.${idKey}.length`);
  const byId = new Map();
  for (const [index, entry] of translated.entries()) {
    const id = safeText(
      entry[idKey],
      `$catalog.${idKey}[${index}].${idKey}`,
      80,
    );
    if (byId.has(id))
      fail("duplicate-translation-id", `$catalog.${idKey}.${id}`);
    byId.set(id, entry);
  }
  for (const sourceEntry of source) {
    const id = String(sourceEntry[idKey]);
    const translatedEntry = byId.get(id);
    if (!translatedEntry)
      fail("missing-translation", `$catalog.${idKey}.${id}`);
    const expectedKeys = ["source_hash", ...Object.keys(sourceEntry)];
    exactKeys(translatedEntry, expectedKeys, `$catalog.${idKey}.${id}`);
    const sourceHash = safeText(
      translatedEntry.source_hash,
      `$catalog.${idKey}.${id}.source_hash`,
      64,
    );
    if (!HASH_PATTERN.test(sourceHash)) {
      fail("invalid-source-hash", `$catalog.${idKey}.${id}.source_hash`);
    }
    equal(
      sourceHash,
      sha256(stableStringify(sourceEntry)),
      `$catalog.${idKey}.${id}.source_hash`,
    );
    const comparable = structuredClone(translatedEntry);
    delete comparable.source_hash;
    assertTranslationShape(sourceEntry, comparable, `$catalog.${idKey}.${id}`);
  }
}

/** @param {unknown} source @param {unknown} translated @param {string} path @param {string | null} [key] */
function assertTranslationShape(source, translated, path, key = null) {
  if (typeof source === "string") {
    const value = safeText(translated, path, 1200);
    if (key !== null && INVARIANT_KEYS.has(key)) equal(value, source, path);
    if (/\.mechanism\.actors\[[0-9]+\]$/u.test(path))
      equal(value, source, path);
    return;
  }
  if (Array.isArray(source)) {
    if (!Array.isArray(translated)) fail("translation-shape-mismatch", path);
    equal(translated.length, source.length, `${path}.length`);
    source.forEach((item, index) =>
      assertTranslationShape(item, translated[index], `${path}[${index}]`, key),
    );
    return;
  }
  if (typeof source === "object" && source !== null) {
    const translatedRecord = record(translated, path);
    exactKeys(translatedRecord, Object.keys(source), path);
    for (const [childKey, child] of Object.entries(source)) {
      assertTranslationShape(
        child,
        translatedRecord[childKey],
        `${path}.${childKey}`,
        childKey,
      );
    }
    return;
  }
  equal(translated, source, path);
}

/** @param {unknown} value */
function validateReview(value) {
  const review = record(value, "$catalog.review");
  exactKeys(
    review,
    ["status", "basis", "reviewed_at", "evidence_id"],
    "$catalog.review",
  );
  equal(review.status, "reviewed", "$catalog.review.status");
  safeText(review.basis, "$catalog.review.basis", 400);
  const reviewedAt = safeText(
    review.reviewed_at,
    "$catalog.review.reviewed_at",
    10,
  );
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(reviewedAt)) {
    fail("invalid-review-date", "$catalog.review.reviewed_at");
  }
  safeText(review.evidence_id, "$catalog.review.evidence_id", 100);
}

/** @param {unknown} value @param {string} path */
function record(value, path) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail("expected-object", path);
  }
  return /** @type {Record<string, any>} */ (value);
}

/** @param {unknown} value @param {string} path */
function records(value, path) {
  if (!Array.isArray(value)) fail("expected-array", path);
  return value.map((entry, index) => record(entry, `${path}[${index}]`));
}

/** @param {unknown} value @param {string} path @param {number} maximum */
function safeText(value, path, maximum) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum ||
    value !== value.normalize("NFC") ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
  ) {
    fail("invalid-text", path);
  }
  return value;
}

/** @param {Record<string, unknown>} value @param {string[]} expected @param {string} path */
function exactKeys(value, expected, path) {
  const actual = Object.keys(value);
  for (const key of expected) {
    if (!Object.hasOwn(value, key)) fail("missing-field", `${path}.${key}`);
  }
  for (const key of actual) {
    if (!expected.includes(key)) fail("unknown-field", `${path}.${key}`);
  }
}

/** @param {unknown} actual @param {unknown} expected @param {string} path */
function equal(actual, expected, path) {
  if (actual !== expected) fail("unexpected-value", path);
}

/** @param {string} code @param {string} path @returns {never} */
function fail(code, path) {
  throw new PresentationCatalogError(code, path);
}

/** @template T @param {T} value @returns {Readonly<T>} */
function deepFreeze(value) {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
