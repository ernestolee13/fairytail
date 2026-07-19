import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  ContentLoadError,
  MAX_JSON_BYTES,
  loadG002Bundle,
  parseJsonDocument,
} from "../src/content/load.mjs";
import {
  ContentValidationError,
  validateG002Bundle,
} from "../src/content/validate.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const malformedRoot = join(root, "fixtures", "content", "malformed");

test("invalid JSON and prototype-pollution keys fail as inert data", async () => {
  const invalid = await readFile(join(malformedRoot, "invalid-json.json"));
  const prototypeKey = await readFile(
    join(malformedRoot, "prototype-key.json"),
  );

  assert.throws(
    () => parseJsonDocument(invalid, "invalid fixture"),
    (error) =>
      error instanceof ContentLoadError && error.code === "invalid-json",
  );
  assert.throws(
    () => parseJsonDocument(prototypeKey, "prototype fixture"),
    (error) =>
      error instanceof ContentLoadError && error.code === "dangerous-key",
  );
  assert.equal(/** @type {any} */ ({}).polluted, undefined);
});

test("execution-shaped strings remain data and never run", async () => {
  const fixture = await readFile(join(malformedRoot, "execution-shaped.json"));
  delete (/** @type {any} */ (globalThis).__FAIRYTAIL_CONTENT_CANARY__);

  const parsed = /** @type {any} */ (
    parseJsonDocument(fixture, "execution-shaped fixture")
  );

  assert.equal(
    parsed.payload,
    "globalThis.__FAIRYTAIL_CONTENT_CANARY__ = true",
  );
  assert.equal(
    /** @type {any} */ (globalThis).__FAIRYTAIL_CONTENT_CANARY__,
    undefined,
  );
});

test("oversized and over-deep documents are rejected before publication", () => {
  assert.throws(
    () => parseJsonDocument("x".repeat(MAX_JSON_BYTES + 1), "oversized"),
    (error) =>
      error instanceof ContentLoadError && error.code === "document-too-large",
  );

  let nested = '"leaf"';
  for (let index = 0; index < 70; index += 1) nested = `{"a":${nested}}`;
  assert.throws(
    () => parseJsonDocument(nested, "over-deep"),
    (error) =>
      error instanceof ContentLoadError && error.code === "document-too-deep",
  );
});

test("missing, unknown, unsupported, unsafe-source, and future metadata fail closed", async () => {
  const bundle = /** @type {any} */ (await loadG002Bundle(root));
  const missingCard = parseJsonDocument(
    await readFile(join(malformedRoot, "missing-required-card.json")),
  );
  /** @type {Array<(copy: any) => void>} */
  const mutations = [
    (copy) => {
      copy.concepts.cards[0] = missingCard;
    },
    (copy) => {
      copy.concepts.cards[0].unknown_override = true;
    },
    (copy) => {
      copy.concepts.cards[0].schema_version = 2;
    },
    (copy) => {
      copy.concepts.cards[0].sources[0].url = "http://unsafe.example.test";
    },
    (copy) => {
      copy.concepts.cards[0].sources = [copy.concepts.cards[0].sources[0]];
    },
    (copy) => {
      copy.concepts.cards[0].verified_at = "2026-07-19";
    },
  ];

  for (const mutate of mutations) {
    const copy = structuredClone(bundle);
    mutate(copy);
    assert.throws(
      () => validateG002Bundle(copy),
      (error) => error instanceof ContentValidationError,
    );
  }
});
