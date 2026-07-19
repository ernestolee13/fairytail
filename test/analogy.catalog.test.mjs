import assert from "node:assert/strict";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  AnalogyValidationError,
  analogyRoleIds,
  loadAnalogyAssets,
  validateAnalogyAssets,
} from "../src/analogy/catalog.mjs";
import { loadG002Bundle } from "../src/content/load.mjs";
import { validateG002Bundle } from "../src/content/validate.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const now = new Date("2026-07-18T12:00:00.000Z");

test("G004 publishes 30 reviewed mappings without mutating G002 candidates", async () => {
  const bundle = /** @type {any} */ (await loadG002Bundle(root));
  validateG002Bundle(bundle);
  const publication = validateAnalogyAssets(
    bundle,
    /** @type {any} */ (await loadAnalogyAssets(root)),
    now,
  );

  assert.equal(publication.status, "pass");
  assert.equal(publication.selectionMode, "bundled-validated-selection-only");
  assert.equal(publication.mappingCount, 30);
  assert.equal(publication.worldCount, 3);
  assert.equal(new Set(Object.values(publication.mappingHashes)).size, 30);
  const candidates = /** @type {Array<Record<string, any>>} */ (
    bundle.mappings.mappings
  );
  const published = /** @type {Array<Record<string, any>>} */ (
    publication.mappings
  );
  assert.ok(
    candidates.every(
      (mapping) =>
        mapping.validation_status === "candidate_requires_validation" &&
        mapping.relations_preserved.length === 0,
    ),
  );
  assert.ok(
    published.every((mapping) => mapping.validation_status === "validated"),
  );
});

test("every published mapping covers the exact fixed concept roles and relations", async () => {
  const bundle = /** @type {any} */ (await loadG002Bundle(root));
  const publication = validateAnalogyAssets(
    bundle,
    /** @type {any} */ (await loadAnalogyAssets(root)),
    now,
  );
  const cards = new Map(
    /** @type {Array<Record<string, any>>} */ (bundle.concepts.cards).map(
      (card) => [card.id, card],
    ),
  );
  const contracts = new Map(
    /** @type {Array<Record<string, any>>} */ (publication.contracts).map(
      (contract) => [contract.concept_id, contract],
    ),
  );

  for (const mapping of /** @type {Array<Record<string, any>>} */ (
    publication.mappings
  )) {
    const card = cards.get(mapping.concept_id);
    const contract = contracts.get(mapping.concept_id);
    assert.ok(card, mapping.mapping_id);
    assert.ok(contract, mapping.mapping_id);
    assert.deepEqual(
      Object.keys(mapping.role_map).sort(),
      analogyRoleIds(card).sort(),
      mapping.mapping_id,
    );
    assert.deepEqual(
      [...mapping.relation_ids].sort(),
      /** @type {Array<Record<string, any>>} */ (contract.required_relations)
        .map((relation) => relation.relation_id)
        .sort(),
      mapping.mapping_id,
    );
    assert.ok(mapping.non_mappings.length > 0, mapping.mapping_id);
  }
});

test("role omissions, extras, relation drift, placeholders, and hash drift fail closed", async () => {
  const bundle = /** @type {any} */ (await loadG002Bundle(root));
  const assets = /** @type {any} */ (await loadAnalogyAssets(root));
  /** @type {Array<(copy: any) => void>} */
  const mutations = [
    (copy) => {
      delete copy.catalog.mappings[0].role_map.manifest;
    },
    (copy) => {
      copy.catalog.mappings[0].role_map.superpower = "자동 승인";
    },
    (copy) => {
      copy.catalog.mappings[0].relation_ids.pop();
    },
    (copy) => {
      copy.catalog.mappings[0].non_mappings = [
        "아직 구조 검증되지 않아 사용자에게 표시할 수 없음",
      ];
    },
    (copy) => {
      copy.catalog.mappings[0].breakpoint_ref =
        "concepts/package-dependency#neutral_example";
    },
    (copy) => {
      copy.contracts.contracts[0].required_relations[0].from_role = "package";
      copy.contracts.contracts[0].required_relations[0].to_role = "package";
    },
    (copy) => {
      copy.catalog.mapping_catalog_hash = "0".repeat(64);
    },
  ];

  for (const mutate of mutations) {
    const copy = structuredClone(assets);
    mutate(copy);
    assert.throws(
      () => validateAnalogyAssets(bundle, copy, now),
      (error) => error instanceof AnalogyValidationError,
    );
  }
});

test("published mappings expire deterministically and schemas are closed", async () => {
  const bundle = /** @type {any} */ (await loadG002Bundle(root));
  const assets = /** @type {any} */ (await loadAnalogyAssets(root));
  assert.throws(
    () =>
      validateAnalogyAssets(
        bundle,
        assets,
        new Date("2027-07-19T00:00:00.000Z"),
      ),
    (error) =>
      error instanceof AnalogyValidationError &&
      error.code === "mapping-expired",
  );
  for (const schema of Object.values(assets.schemas)) {
    assert.equal(
      schema.$schema,
      "https://json-schema.org/draft/2020-12/schema",
    );
    assert.equal(schema.additionalProperties, false);
  }
});
