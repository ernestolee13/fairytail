#!/usr/bin/env node

import { writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { format } from "prettier";

import { readJsonDocument } from "../src/content/load.mjs";
import {
  attachSourceHashes,
  presentationSource,
} from "../src/locale/catalog.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const translationRootValue = argumentValue("--translation-root");
if (!translationRootValue) {
  throw new TypeError(
    "Usage: node scripts/import-presentation-catalog.mjs --translation-root <snapshot> [--locale ko] [--output <path>]",
  );
}

const locale = argumentValue("--locale") ?? "ko";
if (locale !== "ko") {
  throw new TypeError(`Unsupported presentation locale: ${locale}`);
}

const translationRoot = resolve(translationRootValue);
const outputPath = resolve(
  argumentValue("--output") ??
    join(root, "content", "locales", locale, "presentation.json"),
);

const [sourceDocuments, translationDocuments] = await Promise.all([
  readProjectionDocuments(root),
  readProjectionDocuments(translationRoot),
]);

if (sourceDocuments.concepts.locale !== "en") {
  throw new Error("The canonical source concepts must declare locale=en");
}
if (translationDocuments.concepts.locale !== locale) {
  throw new Error(
    `The translation snapshot concepts must declare locale=${locale}`,
  );
}

const source = makeProjection(sourceDocuments);
const translation = makeProjection(translationDocuments);
const translatedCollections = attachSourceHashes(source, translation);
const contentVersion = sourceDocuments.concepts.content_version;

if (
  typeof contentVersion !== "string" ||
  !/^[0-9]{4}\.[0-9]{2}\.[0-9]{2}\.[0-9]+$/u.test(contentVersion)
) {
  throw new TypeError("Canonical concepts contain an invalid content_version");
}

const catalog = {
  schema_version: 1,
  catalog_version: contentVersion,
  source_locale: "en",
  locale,
  source_content_version: contentVersion,
  review: {
    status: "reviewed",
    basis:
      "Korean learner-facing copy reconstructed from the reviewed G004 Korean source snapshot; invariant IDs, roles, relation directions, and safety structure are checked against the English source.",
    reviewed_at: "2026-07-18",
    evidence_id: "G009-KO-PRESENTATION-REVIEW-2026-07-18",
  },
  ...translatedCollections,
};

const output = await format(JSON.stringify(catalog), {
  parser: "json",
  filepath: outputPath,
});
await writeFile(outputPath, output, "utf8");

process.stdout.write(
  `${JSON.stringify(
    {
      status: "imported",
      locale,
      source_content_version: contentVersion,
      output: outputPath,
      counts: Object.fromEntries(
        Object.entries(translatedCollections).map(([key, values]) => [
          key,
          values.length,
        ]),
      ),
    },
    null,
    2,
  )}\n`,
);

/** @param {string} documentRoot */
async function readProjectionDocuments(documentRoot) {
  const values = await Promise.all([
    readJsonDocument(join(documentRoot, "content", "v1", "concepts.json")),
    readJsonDocument(
      join(documentRoot, "fixtures", "golden", "v1", "scenarios.json"),
    ),
    readJsonDocument(
      join(documentRoot, "content", "v1", "analogy-contracts.json"),
    ),
    readJsonDocument(
      join(documentRoot, "content", "v1", "validated-analogy-mappings.json"),
    ),
  ]);
  const [concepts, scenarios, contracts, catalog] = values.map((value, index) =>
    record(value, ["concepts", "scenarios", "contracts", "catalog"][index]),
  );
  return { concepts, scenarios, contracts, catalog };
}

/** @param {Record<string, any>} documents */
function makeProjection(documents) {
  return presentationSource({
    content: {
      content_version: documents.concepts.content_version,
      concepts: documents.concepts.cards,
      scenarios: documents.scenarios.scenarios,
    },
    publication: {
      worlds: documents.catalog.worlds,
      contracts: documents.contracts.contracts,
      mappings: documents.catalog.mappings,
    },
  });
}

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

/** @param {unknown} value @param {string} path */
function record(value, path) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object`);
  }
  return /** @type {Record<string, any>} */ (value);
}
