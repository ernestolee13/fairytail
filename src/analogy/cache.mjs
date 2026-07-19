import { resolve } from "node:path";

import { parseJsonDocument } from "../content/load.mjs";
import {
  deletePrivateStoreFile,
  readPrivateStoreFile,
  replacePrivateStoreFile,
} from "../private-store.mjs";
import { sha256, stableStringify } from "../content/stable-json.mjs";

export const ANALOGY_CACHE_FILE = "analogy-cache.json";
export const MAX_CACHE_BYTES = 256 * 1024;
export const MAX_CACHE_ENTRIES = 100;

const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const CONTENT_VERSION_PATTERN = /^[0-9]{4}\.[0-9]{2}\.[0-9]{2}\.[0-9]+$/u;
const MAPPING_ID_PATTERN = /^P[1-9][0-9]*-S[0-9]{2}-A[1-9][0-9]*$/u;
const SCENARIO_ID_PATTERN = /^S[0-9]{2}$/u;
const RENDERER_VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+$/u;
const ENTRY_FIELDS = [
  "cache_key",
  "scenario_id",
  "mapping_id",
  "mapping_version",
  "mapping_hash",
  "content_version",
  "canonical_fact_set_hash",
  "contract_version",
  "catalog_version",
  "renderer_version",
  "locale",
  "choice",
];

/** @typedef {{
 * cache_key: string,
 * scenario_id: string,
 * mapping_id: string,
 * mapping_version: number,
 * mapping_hash: string,
 * content_version: string,
 * canonical_fact_set_hash: string,
 * contract_version: number,
 * catalog_version: string,
 * renderer_version: string,
 * locale: "ko" | "en",
 * choice: "preferred" | "different" | "unfamiliar"
 * }} CacheEntry */

/** @typedef {{ mapping_id: string, mapping_version: number, reason_code: "unfamiliar" | "rejected" }} CacheRejection */

/** @returns {{ cache_version: 1, entries: CacheEntry[], rejections: CacheRejection[] }} */
export function emptyAnalogyCache() {
  return { cache_version: 1, entries: [], rejections: [] };
}

/**
 * The projection digest participates only in the one-way key. It is never
 * stored as a profile-shaped field or cache value.
 *
 * @param {{
 * contentVersion: string,
 * canonicalFactSetHash: string,
 * contractVersion: number,
 * catalogVersion: string,
 * rendererVersion: string,
 * locale: "ko" | "en",
 * scenarioId: string,
 * projectionDigest: string,
 * choice: "preferred" | "different" | "unfamiliar",
 * excludedMappingIds: string[]
 * }} input
 */
export function analogyCacheKey(input) {
  validateVersion(input.contentVersion, "input.contentVersion");
  validateHash(input.canonicalFactSetHash, "input.canonicalFactSetHash");
  positiveInteger(input.contractVersion, "input.contractVersion");
  validateVersion(input.catalogVersion, "input.catalogVersion");
  pattern(
    input.rendererVersion,
    RENDERER_VERSION_PATTERN,
    "input.rendererVersion",
  );
  if (input.locale !== "ko" && input.locale !== "en") fail("invalid-locale");
  pattern(input.scenarioId, SCENARIO_ID_PATTERN, "input.scenarioId");
  validateHash(input.projectionDigest, "input.projectionDigest");
  if (!["preferred", "different", "unfamiliar"].includes(input.choice)) {
    fail("invalid-choice");
  }
  const excludedMappingIds = [...new Set(input.excludedMappingIds)].sort();
  for (const [index, id] of excludedMappingIds.entries()) {
    pattern(id, MAPPING_ID_PATTERN, `input.excludedMappingIds[${index}]`);
  }
  return sha256(
    stableStringify({
      content_version: input.contentVersion,
      canonical_fact_set_hash: input.canonicalFactSetHash,
      contract_version: input.contractVersion,
      catalog_version: input.catalogVersion,
      renderer_version: input.rendererVersion,
      locale: input.locale,
      scenario_id: input.scenarioId,
      approved_projection_digest: input.projectionDigest,
      choice: input.choice,
      excluded_mapping_ids: excludedMappingIds,
    }),
  );
}

/** @param {string | undefined} dataDir */
export async function loadAnalogyCache(dataDir) {
  if (!dataDir) {
    return {
      cache: emptyAnalogyCache(),
      source: "default",
      reason: "no-data-dir",
    };
  }
  try {
    const parsed = parseJsonDocument(
      await readPrivateStoreFile(
        dataDir,
        ANALOGY_CACHE_FILE,
        MAX_CACHE_BYTES,
        "Fairytail analogy cache",
      ),
      "Fairytail analogy cache",
    );
    return {
      cache: validateAnalogyCache(parsed),
      source: "stored",
      reason: "ok",
    };
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return {
        cache: emptyAnalogyCache(),
        source: "default",
        reason: "not-found",
      };
    }
    return {
      cache: emptyAnalogyCache(),
      source: "default",
      reason: "invalid-cache",
    };
  }
}

/** @param {string | undefined} dataDir @param {string} cacheKey */
export async function findCacheReference(dataDir, cacheKey) {
  validateHash(cacheKey, "cacheKey");
  const loaded = await loadAnalogyCache(dataDir);
  return (
    loaded.cache.entries.find((entry) => entry.cache_key === cacheKey) ?? null
  );
}

/** @param {string} dataDir @param {unknown} entryValue */
export async function saveCacheReference(dataDir, entryValue) {
  const entry = validateCacheEntry(entryValue, "$entry");
  const loaded = await loadAnalogyCache(dataDir);
  const entries = loaded.cache.entries.filter(
    (item) => item.cache_key !== entry.cache_key,
  );
  entries.push(entry);
  entries.sort((left, right) => left.cache_key.localeCompare(right.cache_key));
  const cache = validateAnalogyCache({
    cache_version: 1,
    entries: entries.slice(-MAX_CACHE_ENTRIES),
    rejections: loaded.cache.rejections,
  });
  await atomicPrivateJson(dataDir, cache);
  return { ok: true, entry };
}

/** @param {string} dataDir @param {unknown} rejectionValue */
export async function recordMappingRejection(dataDir, rejectionValue) {
  const rejection = validateRejection(rejectionValue, "$rejection");
  const loaded = await loadAnalogyCache(dataDir);
  const rejections = loaded.cache.rejections.filter(
    (item) => item.mapping_id !== rejection.mapping_id,
  );
  rejections.push(rejection);
  rejections.sort((left, right) =>
    left.mapping_id.localeCompare(right.mapping_id),
  );
  const entries = loaded.cache.entries.filter(
    (item) => item.mapping_id !== rejection.mapping_id,
  );
  const cache = validateAnalogyCache({
    cache_version: 1,
    entries,
    rejections: rejections.slice(-MAX_CACHE_ENTRIES),
  });
  await atomicPrivateJson(dataDir, cache);
  return { ok: true, rejection };
}

/** @param {string | undefined} dataDir */
export async function rejectedMappingIds(dataDir) {
  const loaded = await loadAnalogyCache(dataDir);
  return loaded.cache.rejections.map((item) => item.mapping_id);
}

/** @param {string | undefined} dataDir */
export async function clearAnalogyCache(dataDir) {
  if (!dataDir) return { ok: true, deleted: false };
  try {
    const deleted = await deletePrivateStoreFile(
      dataDir,
      ANALOGY_CACHE_FILE,
      "Fairytail analogy cache",
    );
    return { ok: true, deleted };
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return { ok: true, deleted: false };
    }
    throw error;
  }
}

/** @param {unknown} value */
export function validateAnalogyCache(value) {
  const cache = record(value, "$cache");
  exactKeys(cache, ["cache_version", "entries", "rejections"], "$cache");
  if (cache.cache_version !== 1) fail("unsupported-cache-version");
  const entryValues = array(cache.entries, "$cache.entries");
  if (entryValues.length > MAX_CACHE_ENTRIES) fail("too-many-cache-entries");
  const entries = entryValues.map((entry, index) =>
    validateCacheEntry(entry, `$cache.entries[${index}]`),
  );
  unique(
    entries.map((entry) => entry.cache_key),
    "$cache.entries.cache_key",
  );
  const rejectionValues = array(cache.rejections, "$cache.rejections");
  if (rejectionValues.length > MAX_CACHE_ENTRIES) fail("too-many-rejections");
  const rejections = rejectionValues.map((item, index) =>
    validateRejection(item, `$cache.rejections[${index}]`),
  );
  unique(
    rejections.map((item) => item.mapping_id),
    "$cache.rejections.mapping_id",
  );
  return { cache_version: /** @type {const} */ (1), entries, rejections };
}

/** @param {unknown} value @param {string} path @returns {CacheEntry} */
export function validateCacheEntry(value, path) {
  const entry = record(value, path);
  exactKeys(entry, ENTRY_FIELDS, path);
  validateHash(entry.cache_key, `${path}.cache_key`);
  pattern(entry.scenario_id, SCENARIO_ID_PATTERN, `${path}.scenario_id`);
  pattern(entry.mapping_id, MAPPING_ID_PATTERN, `${path}.mapping_id`);
  positiveInteger(entry.mapping_version, `${path}.mapping_version`);
  validateHash(entry.mapping_hash, `${path}.mapping_hash`);
  validateVersion(entry.content_version, `${path}.content_version`);
  validateHash(
    entry.canonical_fact_set_hash,
    `${path}.canonical_fact_set_hash`,
  );
  positiveInteger(entry.contract_version, `${path}.contract_version`);
  validateVersion(entry.catalog_version, `${path}.catalog_version`);
  pattern(
    entry.renderer_version,
    RENDERER_VERSION_PATTERN,
    `${path}.renderer_version`,
  );
  if (entry.locale !== "ko" && entry.locale !== "en") fail("invalid-locale");
  if (
    !["preferred", "different", "unfamiliar"].includes(
      /** @type {string} */ (entry.choice),
    )
  ) {
    fail("invalid-choice");
  }
  return /** @type {CacheEntry} */ ({ ...entry });
}

/** @param {unknown} value @param {string} path @returns {CacheRejection} */
function validateRejection(value, path) {
  const item = record(value, path);
  exactKeys(item, ["mapping_id", "mapping_version", "reason_code"], path);
  pattern(item.mapping_id, MAPPING_ID_PATTERN, `${path}.mapping_id`);
  positiveInteger(item.mapping_version, `${path}.mapping_version`);
  if (item.reason_code !== "unfamiliar" && item.reason_code !== "rejected") {
    fail("invalid-rejection-reason");
  }
  return /** @type {CacheRejection} */ ({ ...item });
}

/** @param {string} dataDir */
export function analogyCachePath(dataDir) {
  if (typeof dataDir !== "string" || dataDir.trim().length === 0) {
    throw new TypeError("Fairytail data directory is required");
  }
  return resolve(dataDir, ANALOGY_CACHE_FILE);
}

/** @param {string} dataDir @param {unknown} value */
async function atomicPrivateJson(dataDir, value) {
  await replacePrivateStoreFile(
    dataDir,
    ANALOGY_CACHE_FILE,
    `${JSON.stringify(value, null, 2)}\n`,
    MAX_CACHE_BYTES,
    "Fairytail analogy cache",
  );
}

/** @param {unknown} value @param {string} path */
function record(value, path) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`Expected object at ${path}`);
  }
  return /** @type {Record<string, unknown>} */ (value);
}

/** @param {unknown} value @param {string} path */
function array(value, path) {
  if (!Array.isArray(value)) throw new TypeError(`Expected array at ${path}`);
  return value;
}

/** @param {Record<string, unknown>} value @param {string[]} expected @param {string} path */
function exactKeys(value, expected, path) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (stableStringify(actual) !== stableStringify(wanted)) {
    throw new TypeError(`Unexpected fields at ${path}`);
  }
}

/** @param {unknown} value @param {RegExp} regex @param {string} path */
function pattern(value, regex, path) {
  if (typeof value !== "string" || !regex.test(value)) {
    throw new TypeError(`Invalid value at ${path}`);
  }
}

/** @param {unknown} value @param {string} path */
function validateHash(value, path) {
  pattern(value, HASH_PATTERN, path);
}

/** @param {unknown} value @param {string} path */
function validateVersion(value, path) {
  pattern(value, CONTENT_VERSION_PATTERN, path);
}

/** @param {unknown} value @param {string} path */
function positiveInteger(value, path) {
  if (!Number.isInteger(value) || /** @type {number} */ (value) < 1) {
    throw new TypeError(`Expected positive integer at ${path}`);
  }
}

/** @param {string[]} values @param {string} path */
function unique(values, path) {
  if (new Set(values).size !== values.length) {
    throw new TypeError(`Duplicate value at ${path}`);
  }
}

/** @param {string} message */
function fail(message) {
  throw new TypeError(`Invalid Fairytail analogy cache: ${message}`);
}

/** @param {unknown} error */
function isNodeError(error) {
  return error instanceof Error && "code" in error;
}
