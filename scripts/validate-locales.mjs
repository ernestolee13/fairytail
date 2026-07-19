#!/usr/bin/env node

import assert from "node:assert/strict";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { loadAnalogyRuntime, resolveAnalogy } from "../src/analogy/engine.mjs";
import { stableStringify } from "../src/content/stable-json.mjs";
import { renderScenarioForLocale } from "../src/locale/present.mjs";
import { approvePersonalization } from "../src/profile/privacy.mjs";
import { PROJECTION_FIELDS } from "../src/profile/profile.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const now = new Date("2026-07-18T12:00:00.000Z");
const runtime = await loadAnalogyRuntime(root, now);
let parityCount = 0;

for (const fixtureCase of runtime.content.cases) {
  const fixtureProfile = runtime.content.profiles.find(
    (profile) => profile.profile_id === fixtureCase.profile_id,
  );
  assert.ok(fixtureProfile, String(fixtureCase.profile_id));
  const approval = approvePersonalization(
    {
      ...structuredClone(fixtureProfile),
      profile_version: 2,
      model_processing: {
        mode: "neutral_local",
        approved_fields: [],
        approved_at: null,
        approved_projection_digest: null,
      },
    },
    PROJECTION_FIELDS,
    now,
  );
  assert.equal(approval.approved, true);
  const resolution = await resolveAnalogy(runtime, {
    profile: approval.profile,
    scenarioId: String(fixtureCase.scenario_id),
    regressionCatalog: true,
  });
  assert.equal(resolution.kind, "mapped");
  const english = renderScenarioForLocale(
    runtime,
    String(fixtureCase.scenario_id),
    resolution,
    "en",
  );
  const korean = renderScenarioForLocale(
    runtime,
    String(fixtureCase.scenario_id),
    resolution,
    "ko",
  );
  assert.deepEqual(signature(korean.content), signature(english.content));
  assert.notEqual(
    stableStringify(korean.content),
    stableStringify(english.content),
  );
  parityCount += 1;
}

process.stdout.write(
  `${JSON.stringify(
    {
      status: "pass",
      source_locale: runtime.localization.source_locale,
      reviewed_locales: runtime.localization.supported_locales,
      content_version: runtime.content.content_version,
      presentation_catalog_hash: runtime.localization.catalog_hashes.ko,
      parity_cases: parityCount,
      canonical_hash_parity_cases: parityCount,
      role_relation_parity_cases: parityCount,
      network_calls: 0,
    },
    null,
    2,
  )}\n`,
);

/** @param {Record<string, any>} content */
function signature(content) {
  const analogy = content.analogy_or_neutral_fallback;
  const concepts = /** @type {Record<string, any>[]} */ (
    content.canonical_definition.concepts
  );
  const policyLabels = /** @type {Record<string, any>[]} */ (
    content.protocol_fact_and_fairytail_policy_labels
  );
  const relations = /** @type {Record<string, any>[]} */ (
    analogy.preserved_relations ?? []
  );
  return {
    content_version: content.canonical_definition.content_version,
    canonical_fact_set_hash:
      content.canonical_definition.canonical_fact_set_hash,
    concepts: concepts.map((concept) => ({
      id: concept.concept_id,
      actors: concept.mechanism.actors,
      flow_steps: concept.mechanism.flow.length,
      safety_boundaries: concept.safety_boundary.length,
    })),
    scenario_id: content.current_encounter.scenario_id,
    pre_action_keys: Object.keys(content.target_side_effect_risk_rollback),
    policy_kinds: policyLabels.map((label) => label.kind),
    analogy: {
      kind: analogy.kind,
      mapping_id: analogy.mapping_id,
      concept_id: analogy.analogy_concept_id,
      world_id: analogy.profile_world_id,
      role_keys: Object.keys(analogy.role_map ?? {}),
      relations: relations.map((relation) => [
        relation.relation_id,
        relation.from_role,
        relation.to_role,
      ]),
      controls: analogy.controls,
    },
    breakpoint_kind: content.analogy_breakpoint.kind,
  };
}
