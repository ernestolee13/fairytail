import assert from "node:assert/strict";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { loadG002Bundle } from "../src/content/load.mjs";
import { validateG002Bundle } from "../src/content/validate.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

test("G002 validates the complete versioned fact layer", async () => {
  const result = validateG002Bundle(await loadG002Bundle(root));

  assert.deepEqual(result.counts, {
    concepts: 12,
    confusion_pairs: 12,
    profiles: 3,
    scenarios: 10,
    analogy_candidates: 30,
    golden_cases: 30,
  });
  assert.equal(result.canonicalInvarianceCases, 30);
  assert.equal(result.personalizationReady, false);
});

test("all concept cards retain source, version, breakpoint, and safety metadata", async () => {
  const bundle = /** @type {any} */ (await loadG002Bundle(root));
  const cards = /** @type {any[]} */ (bundle.concepts.cards);

  assert.equal(cards.length, 12);
  for (const card of cards) {
    const sources = /** @type {any[]} */ (card.sources);
    assert.ok(card.scope.length > 0, card.id);
    assert.ok(card.spec_revision.length > 0, card.id);
    assert.ok(card.verified_at.length > 0, card.id);
    assert.ok(card.analogy_breakpoint.length > 0, card.id);
    assert.ok(card.safety_boundary.length > 0, card.id);
    assert.ok(sources.length >= 2, card.id);
    assert.ok(
      sources.some((source) => source.tier === "A"),
      card.id,
    );
    assert.equal(
      new Set(sources.map((source) => source.url)).size,
      sources.length,
      card.id,
    );
    assert.ok(
      sources.every((source) => source.url.startsWith("https://")),
      card.id,
    );
  }
});

test("all shipped schemas use Draft 2020-12 and reject top-level unknown fields", async () => {
  const bundle = /** @type {any} */ (await loadG002Bundle(root));

  assert.equal(Object.keys(bundle.schemas).length, 8);
  for (const [name, schema] of Object.entries(bundle.schemas)) {
    assert.equal(
      /** @type {any} */ (schema).$schema,
      "https://json-schema.org/draft/2020-12/schema",
      name,
    );
    assert.equal(/** @type {any} */ (schema).additionalProperties, false, name);
  }
});
