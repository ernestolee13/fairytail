#!/usr/bin/env node

import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { format } from "prettier";

import { readJsonDocument } from "../src/content/load.mjs";
import {
  canonicalFactHash,
  canonicalFactSetHash,
  sha256,
  stableStringify,
} from "../src/content/stable-json.mjs";

const DEFAULT_CONTENT_VERSION = "2026.07.18.2";
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const contentVersion =
  argumentValue("--content-version") ?? DEFAULT_CONTENT_VERSION;

if (!/^[0-9]{4}\.[0-9]{2}\.[0-9]{2}\.[0-9]+$/u.test(contentVersion)) {
  throw new TypeError(`Invalid --content-version: ${contentVersion}`);
}

const paths = {
  concepts: join(root, "content", "v1", "concepts.json"),
  confusionPairs: join(root, "content", "v1", "confusion-pairs.json"),
  manifest: join(root, "content", "v1", "manifest.json"),
  contracts: join(root, "content", "v1", "analogy-contracts.json"),
  catalog: join(root, "content", "v1", "validated-analogy-mappings.json"),
  scenarios: join(root, "fixtures", "golden", "v1", "scenarios.json"),
  cases: join(root, "fixtures", "golden", "v1", "cases.json"),
  candidates: join(root, "fixtures", "golden", "v1", "analogy-mappings.json"),
};

const loadedDocuments = await Promise.all(
  Object.values(paths).map((path) => readJsonDocument(path)),
);
const [
  concepts,
  confusionPairs,
  manifest,
  contracts,
  catalog,
  scenarios,
  cases,
  candidates,
] = loadedDocuments.map((value, index) =>
  record(value, Object.keys(paths)[index]),
);

const conceptCards = records(concepts.cards, "concepts.cards");
const scenarioRecords = records(scenarios.scenarios, "scenarios.scenarios");
const caseRecords = records(cases.cases, "cases.cases");
const contractRecords = records(contracts.contracts, "contracts.contracts");
const publishedMappings = records(catalog.mappings, "catalog.mappings");
const candidateMappings = records(candidates.mappings, "candidates.mappings");

const conceptById = uniqueIndex(conceptCards, "id", "concepts.cards");
const scenarioById = uniqueIndex(
  scenarioRecords,
  "scenario_id",
  "scenarios.scenarios",
);

concepts.content_version = contentVersion;
confusionPairs.content_version = contentVersion;
manifest.content_version = contentVersion;
contracts.content_version = contentVersion;
catalog.catalog_version = contentVersion;
catalog.content_version = contentVersion;

const canonicalHashes = Object.fromEntries(
  conceptCards.map((card) => [
    text(card.id, "concept.id"),
    canonicalFactHash(card),
  ]),
);

const scenarioFactHashes = Object.fromEntries(
  scenarioRecords.map((scenario) => {
    const scenarioId = text(scenario.scenario_id, "scenario.scenario_id");
    const cards = strings(
      scenario.concept_ids,
      `${scenarioId}.concept_ids`,
    ).map((conceptId) =>
      required(conceptById, conceptId, `${scenarioId}.concept_ids`),
    );
    return [scenarioId, canonicalFactSetHash(cards, contentVersion)];
  }),
);

manifest.canonical_hashes = canonicalHashes;
manifest.scenario_fact_hashes = scenarioFactHashes;

for (const item of caseRecords) {
  const caseId = text(item.case_id, "case.case_id");
  const scenarioId = text(item.scenario_id, `${caseId}.scenario_id`);
  const scenario = required(scenarioById, scenarioId, `${caseId}.scenario_id`);
  const caseConceptIds = strings(item.concept_ids, `${caseId}.concept_ids`);
  const scenarioConceptIds = strings(
    scenario.concept_ids,
    `${scenarioId}.concept_ids`,
  );
  if (stableStringify(caseConceptIds) !== stableStringify(scenarioConceptIds)) {
    throw new Error(`${caseId}.concept_ids does not match ${scenarioId}`);
  }
  item.canonical_fact_set_hash = required(
    new Map(Object.entries(scenarioFactHashes)),
    scenarioId,
    `${caseId}.canonical_fact_set_hash`,
  );
}

for (const contract of contractRecords) {
  const conceptId = text(contract.concept_id, "contract.concept_id");
  contract.canonical_fact_hash = required(
    new Map(Object.entries(canonicalHashes)),
    conceptId,
    `${conceptId}.canonical_fact_hash`,
  );
}

for (const mapping of candidateMappings) {
  const mappingId = text(mapping.mapping_id, "candidate.mapping_id");
  const conceptId = text(mapping.concept_id, `${mappingId}.concept_id`);
  const concept = required(conceptById, conceptId, `${mappingId}.concept_id`);
  mapping.breakpoint = text(
    concept.analogy_breakpoint,
    `${conceptId}.analogy_breakpoint`,
  );
  mapping.neutral_fallback = text(
    concept.neutral_example,
    `${conceptId}.neutral_example`,
  );
}

catalog.candidate_registry_hash = sha256(stableStringify(candidates));
catalog.mapping_catalog_hash = sha256(
  stableStringify({
    catalog_version: contentVersion,
    content_version: contentVersion,
    mappings: publishedMappings,
  }),
);

await Promise.all(
  Object.entries(paths)
    .filter(([name]) =>
      [
        "concepts",
        "confusionPairs",
        "manifest",
        "contracts",
        "catalog",
        "cases",
        "candidates",
      ].includes(name),
    )
    .map(async ([name, path]) => {
      const document = {
        concepts,
        confusionPairs,
        manifest,
        contracts,
        catalog,
        cases,
        candidates,
      }[name];
      await writeJson(path, document);
    }),
);

process.stdout.write(
  `${JSON.stringify(
    {
      status: "refreshed",
      content_version: contentVersion,
      canonical_fact_hashes: Object.keys(canonicalHashes).length,
      scenario_fact_hashes: Object.keys(scenarioFactHashes).length,
      golden_cases: caseRecords.length,
      contracts: contractRecords.length,
      candidate_registry_hash: catalog.candidate_registry_hash,
      mapping_catalog_hash: catalog.mapping_catalog_hash,
    },
    null,
    2,
  )}\n`,
);

/** @param {string} flag */
function argumentValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new TypeError(`${flag} requires a value`);
  }
  return value;
}

/** @param {string} path @param {unknown} value */
async function writeJson(path, value) {
  const output = await format(JSON.stringify(value), {
    parser: "json",
    filepath: path,
  });
  await writeFile(path, output, "utf8");
}

/** @param {unknown} value @param {string} path */
function record(value, path) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object`);
  }
  return /** @type {Record<string, any>} */ (value);
}

/** @param {unknown} value @param {string} path */
function records(value, path) {
  if (!Array.isArray(value)) throw new TypeError(`${path} must be an array`);
  return value.map((item, index) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new TypeError(`${path}[${index}] must be an object`);
    }
    return /** @type {Record<string, any>} */ (item);
  });
}

/** @param {unknown} value @param {string} path */
function text(value, path) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${path} must be a non-empty string`);
  }
  return value;
}

/** @param {unknown} value @param {string} path */
function strings(value, path) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError(`${path} must be a non-empty array`);
  }
  return value.map((item, index) => text(item, `${path}[${index}]`));
}

/** @param {Record<string, any>[]} values @param {string} key @param {string} path */
function uniqueIndex(values, key, path) {
  const index = new Map();
  for (const [position, value] of values.entries()) {
    const id = text(value[key], `${path}[${position}].${key}`);
    if (index.has(id))
      throw new Error(`${path} contains duplicate ${key} ${id}`);
    index.set(id, value);
  }
  return index;
}

/** @template T @param {Map<string, T>} map @param {string} key @param {string} path */
function required(map, key, path) {
  const value = map.get(key);
  if (value === undefined)
    throw new Error(`${path} references unknown id ${key}`);
  return value;
}
