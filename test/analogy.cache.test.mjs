import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  MAX_CACHE_BYTES,
  analogyCacheKey,
  analogyCachePath,
  clearAnalogyCache,
  loadAnalogyCache,
  recordMappingRejection,
  saveCacheReference,
  validateAnalogyCache,
  validateCacheEntry,
} from "../src/analogy/cache.mjs";
import { loadAnalogyRuntime } from "../src/analogy/engine.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const now = new Date("2026-07-18T12:00:00.000Z");
const runtime = await loadAnalogyRuntime(root, now);
const scenarioId = "S04";
const scenarioFactHash = /** @type {string} */ (
  /** @type {Record<string, unknown>} */ (runtime.content.scenario_fact_hashes)[
    scenarioId
  ]
);

/** @typedef {Parameters<typeof analogyCacheKey>[0]} KeyInput */
/** @typedef {ReturnType<typeof validateCacheEntry>} CacheEntry */

/** @param {Partial<KeyInput>} [overrides] @returns {KeyInput} */
function keyInput(overrides = {}) {
  return {
    contentVersion: runtime.content.content_version,
    canonicalFactSetHash: scenarioFactHash,
    contractVersion: runtime.publication.contractVersion,
    catalogVersion: runtime.publication.catalogVersion,
    rendererVersion: runtime.renderer_version,
    locale: /** @type {const} */ ("en"),
    scenarioId,
    projectionDigest: "a".repeat(64),
    choice: /** @type {const} */ ("preferred"),
    excludedMappingIds: /** @type {string[]} */ ([]),
    ...overrides,
  };
}

/**
 * @param {string} [mappingId]
 * @param {{ keyInput?: Partial<KeyInput>, entry?: Partial<CacheEntry> }} [overrides]
 * @returns {CacheEntry}
 */
function cacheEntry(mappingId = "P1-S04-A1", overrides = {}) {
  const input = keyInput(overrides.keyInput);
  const mapping = runtime.publication.mappings.find(
    (item) => item.mapping_id === mappingId,
  );
  assert.ok(mapping, mappingId);
  return /** @type {CacheEntry} */ ({
    cache_key: analogyCacheKey(input),
    scenario_id: scenarioId,
    mapping_id: mappingId,
    mapping_version: /** @type {number} */ (mapping.mapping_version),
    mapping_hash: runtime.publication.mappingHashes[mappingId],
    content_version: runtime.content.content_version,
    canonical_fact_set_hash: scenarioFactHash,
    contract_version: runtime.publication.contractVersion,
    catalog_version: runtime.publication.catalogVersion,
    renderer_version: runtime.renderer_version,
    locale: input.locale,
    choice: input.choice,
    ...overrides.entry,
  });
}

test("every content, contract, renderer, locale, projection, choice, and exclusion input invalidates the key", () => {
  const base = analogyCacheKey(keyInput());
  const changes = /** @type {Array<Partial<KeyInput>>} */ ([
    { contentVersion: "2026.07.18.3" },
    { canonicalFactSetHash: "b".repeat(64) },
    { contractVersion: runtime.publication.contractVersion + 1 },
    { catalogVersion: "2026.07.18.3" },
    { rendererVersion: "2.0.1" },
    { locale: "ko" },
    { scenarioId: "S05" },
    { projectionDigest: "b".repeat(64) },
    { choice: "different" },
    { excludedMappingIds: ["P1-S04-A1"] },
  ]);

  for (const change of changes) {
    assert.notEqual(
      analogyCacheKey(keyInput(change)),
      base,
      JSON.stringify(change),
    );
  }
  assert.equal(
    analogyCacheKey(
      keyInput({
        excludedMappingIds: ["P2-S04-A1", "P1-S04-A1", "P1-S04-A1"],
      }),
    ),
    analogyCacheKey(
      keyInput({ excludedMappingIds: ["P1-S04-A1", "P2-S04-A1"] }),
    ),
  );
  assert.throws(() =>
    analogyCacheKey(keyInput({ excludedMappingIds: ["../../canary"] })),
  );
});

test("cache stores only validated references with private filesystem modes", async (context) => {
  const dataDir = await mkdtemp(join(tmpdir(), "fairytail-cache-mode-"));
  context.after(() => rm(dataDir, { recursive: true, force: true }));
  const entry = cacheEntry();
  await saveCacheReference(dataDir, entry);

  assert.equal((await stat(dataDir)).mode & 0o777, 0o700);
  assert.equal((await stat(analogyCachePath(dataDir))).mode & 0o777, 0o600);
  const raw = await readFile(analogyCachePath(dataDir), "utf8");
  const stored = JSON.parse(raw);
  assert.deepEqual(stored.entries, [entry]);
  assert.doesNotMatch(
    raw,
    /profile|familiar_world|approved_projection|prompt|response|PRIVATE_/iu,
  );

  await assert.rejects(() =>
    saveCacheReference(dataDir, {
      ...entry,
      raw_profile: "PRIVATE_CACHE_CANARY",
    }),
  );
  await assert.rejects(() =>
    recordMappingRejection(dataDir, {
      mapping_id: entry.mapping_id,
      mapping_version: entry.mapping_version,
      reason_code: "unfamiliar",
      note: "PRIVATE_REJECTION_CANARY",
    }),
  );
});

test("corrupt and oversized cache files fail to an empty local cache", async (context) => {
  const dataDir = await mkdtemp(join(tmpdir(), "fairytail-cache-corrupt-"));
  context.after(() => rm(dataDir, { recursive: true, force: true }));
  const path = analogyCachePath(dataDir);

  await writeFile(path, "{not-json");
  let loaded = await loadAnalogyCache(dataDir);
  assert.equal(loaded.source, "default");
  assert.equal(loaded.reason, "invalid-cache");
  assert.deepEqual(loaded.cache, {
    cache_version: 1,
    entries: [],
    rejections: [],
  });

  await writeFile(path, Buffer.alloc(MAX_CACHE_BYTES + 1, 0x20));
  loaded = await loadAnalogyCache(dataDir);
  assert.equal(loaded.source, "default");
  assert.equal(loaded.reason, "invalid-cache");
});

test("recording rejection evicts matching mappings and persists reason codes only", async (context) => {
  const dataDir = await mkdtemp(join(tmpdir(), "fairytail-cache-reject-"));
  context.after(() => rm(dataDir, { recursive: true, force: true }));
  const first = cacheEntry("P1-S04-A1");
  const second = cacheEntry("P2-S04-A1", {
    keyInput: { projectionDigest: "b".repeat(64) },
  });
  await saveCacheReference(dataDir, first);
  await saveCacheReference(dataDir, second);
  await recordMappingRejection(dataDir, {
    mapping_id: first.mapping_id,
    mapping_version: first.mapping_version,
    reason_code: "unfamiliar",
  });

  const loaded = await loadAnalogyCache(dataDir);
  assert.deepEqual(
    loaded.cache.entries.map((entry) => entry.mapping_id),
    [second.mapping_id],
  );
  assert.deepEqual(loaded.cache.rejections, [
    {
      mapping_id: first.mapping_id,
      mapping_version: first.mapping_version,
      reason_code: "unfamiliar",
    },
  ]);
  assert.equal((await clearAnalogyCache(dataDir)).deleted, true);
  assert.equal((await clearAnalogyCache(dataDir)).deleted, false);
});

test("cache schema is valid closed Draft 2020-12 JSON", async () => {
  const schema = JSON.parse(
    await readFile(
      join(root, "schemas", "v1", "analogy-cache.schema.json"),
      "utf8",
    ),
  );
  assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.entries.items.additionalProperties, false);
  assert.equal(schema.properties.rejections.items.additionalProperties, false);
  assert.throws(() =>
    validateAnalogyCache({
      cache_version: 1,
      entries: [],
      rejections: [],
      raw_profile: "PRIVATE_SCHEMA_CANARY",
    }),
  );
});
