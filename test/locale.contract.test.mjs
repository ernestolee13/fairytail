import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  loadAnalogyRuntime,
  loadAnalogyRuntimeSafe,
  resolveAnalogy as resolveAnalogyProduction,
} from "../src/analogy/engine.mjs";
import { renderScenario } from "../src/analogy/render.mjs";
import { stableStringify } from "../src/content/stable-json.mjs";
import { negotiateLocale } from "../src/locale/locale.mjs";
import {
  renderScenarioForLocale,
  stableLocalizedRenderBytes,
} from "../src/locale/present.mjs";
import { completeOnboarding } from "../src/profile/onboarding.mjs";
import { approvePersonalization } from "../src/profile/privacy.mjs";
import { PROJECTION_FIELDS } from "../src/profile/profile.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const now = new Date("2026-07-18T12:00:00.000Z");
const runtime = await loadAnalogyRuntime(root, now);

/** Locale parity is measured against the frozen three-seed regression set. */
/** @param {any} runtimeValue @param {any} input */
function resolveAnalogy(runtimeValue, input) {
  return resolveAnalogyProduction(runtimeValue, {
    ...input,
    regressionCatalog: true,
  });
}

test("locale negotiation is bounded to reviewed English and Korean catalogs", () => {
  assert.deepEqual(negotiateLocale("en-US"), {
    requested_locale: "en-us",
    resolved_locale: "en",
    source_locale: "en",
    fallback_reason: null,
  });
  assert.deepEqual(negotiateLocale("ko_KR"), {
    requested_locale: "ko-kr",
    resolved_locale: "ko",
    source_locale: "en",
    fallback_reason: null,
  });
  assert.equal(negotiateLocale("ja-JP").resolved_locale, "en");
  assert.equal(negotiateLocale("ja-JP").fallback_reason, "unsupported-locale");
  assert.equal(
    negotiateLocale({ locale: "ko" }).fallback_reason,
    "invalid-locale",
  );
  assert.equal(negotiateLocale(undefined).resolved_locale, "en");
});

test("all 30 reviewed mappings preserve structure across English and Korean presentation", async () => {
  let parityCount = 0;
  for (const fixtureCase of runtime.content.cases) {
    const profileId = String(fixtureCase.profile_id);
    const scenarioId = String(fixtureCase.scenario_id);
    const resolution = await resolveAnalogy(runtime, {
      profile: approvedFixtureProfile(profileId),
      scenarioId,
    });
    assert.equal(resolution.kind, "mapped", `${profileId}/${scenarioId}`);
    if (resolution.kind !== "mapped") continue;
    assert.equal(resolution.mapping_id, `${fixtureCase.analogy_mapping_id}-A1`);

    const english = renderScenarioForLocale(
      runtime,
      scenarioId,
      resolution,
      "en-US",
    );
    const korean = renderScenarioForLocale(
      runtime,
      scenarioId,
      resolution,
      "ko-KR",
    );
    const repeated = renderScenarioForLocale(
      runtime,
      scenarioId,
      resolution,
      "ko-KR",
    );

    assert.deepEqual(
      structuralSignature(korean.content),
      structuralSignature(english.content),
    );
    assert.equal(english.locale.resolved_locale, "en");
    assert.equal(english.locale.catalog_hash, null);
    assert.equal(korean.locale.resolved_locale, "ko");
    assert.equal(typeof korean.locale.catalog_hash, "string");
    assert.match(String(korean.locale.catalog_hash), /^[a-f0-9]{64}$/u);
    assert.notEqual(
      stableStringify(korean.content),
      stableStringify(english.content),
    );
    assert.match(stableStringify(korean.content), /[가-힣]/u);
    assert.deepEqual(
      stableLocalizedRenderBytes(repeated),
      stableLocalizedRenderBytes(korean),
    );
    parityCount += 1;
  }
  assert.equal(parityCount, 30);
});

test("three legacy seed fixtures remain selectable in both locales while unknown fixtures stay neutral", async () => {
  const worlds = [
    ["healthcare", "P1"],
    ["operations", "P2"],
    ["education", "P3"],
  ];
  for (const locale of ["en", "ko"]) {
    for (const [category, profileId] of worlds) {
      const completed = completeOnboarding(
        {
          background_categories: [category],
          familiar_labels: [],
          coding_actions: ["none"],
          presentation_preference: "analogy_first",
          safety_concerns: ["none"],
          language: locale,
        },
        "approve",
        now,
      );
      assert.equal(completed.approved, true);
      const resolution = await resolveAnalogy(runtime, {
        profile: completed.profile,
        scenarioId: "S04",
      });
      assert.equal(resolution.kind, "mapped", `${locale}/${category}`);
      if (resolution.kind === "mapped") {
        assert.equal(resolution.mapping_id, `${profileId}-S04-A1`);
      }
    }
  }

  const unknown = completeOnboarding(
    {
      background_categories: [],
      familiar_labels: ["Restaurant shift handoff"],
      coding_actions: ["none"],
      presentation_preference: "analogy_first",
      safety_concerns: ["none"],
      language: "en",
    },
    "approve",
    now,
  );
  const resolution = await resolveAnalogy(runtime, {
    profile: unknown.profile,
    scenarioId: "S04",
  });
  assert.equal(resolution.kind, "neutral");
  assert.equal(resolution.reason, "no-reviewed-world-match");
});

test("a stale Korean source hash fails strict loading and safely falls back to English", async (context) => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "fairytail-locale-safe-"));
  context.after(() => rm(fixtureRoot, { recursive: true, force: true }));
  await Promise.all(
    ["content", "fixtures", "schemas"].map((directory) =>
      cp(join(root, directory), join(fixtureRoot, directory), {
        recursive: true,
      }),
    ),
  );
  const catalogPath = join(
    fixtureRoot,
    "content",
    "locales",
    "ko",
    "presentation.json",
  );
  const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
  catalog.concepts[0].source_hash = "0".repeat(64);
  await writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);

  await assert.rejects(() => loadAnalogyRuntime(fixtureRoot, now));
  const loaded = await loadAnalogyRuntimeSafe(fixtureRoot, now);
  assert.equal(loaded.status, "ready");
  assert.equal(loaded.locale_status, "fallback");
  assert.equal(loaded.reason, "invalid-presentation-catalog");
  assert.deepEqual(
    loaded.runtime.content.canonical_hashes,
    runtime.content.canonical_hashes,
  );

  const resolution = await resolveAnalogy(loaded.runtime, {
    profile: approvedFixtureProfile("P1"),
    scenarioId: "S04",
  });
  const localized = renderScenarioForLocale(
    loaded.runtime,
    "S04",
    resolution,
    "ko",
  );
  assert.equal(localized.locale.resolved_locale, "en");
  assert.equal(
    localized.locale.fallback_reason,
    "invalid-presentation-catalog",
  );
  assert.deepEqual(
    localized.content,
    renderScenario(loaded.runtime, "S04", resolution),
  );
});

test("locale loading, selection, and rendering make zero network calls", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error("network forbidden in locale contract test");
  };
  try {
    const isolated = await loadAnalogyRuntime(root, now);
    const resolution = await resolveAnalogy(isolated, {
      profile: approvedFixtureProfile("P1"),
      scenarioId: "S04",
    });
    renderScenarioForLocale(isolated, "S04", resolution, "ko");
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

/** @param {string} profileId */
function approvedFixtureProfile(profileId) {
  const fixture = runtime.content.profiles.find(
    (profile) => profile.profile_id === profileId,
  );
  assert.ok(fixture, profileId);
  const approval = approvePersonalization(
    {
      ...structuredClone(fixture),
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
  assert.equal(approval.approved, true, profileId);
  return approval.profile;
}

/** @param {Record<string, any>} content */
function structuralSignature(content) {
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
  const neutralComparisons = /** @type {Record<string, any>[]} */ (
    analogy.neutral_comparison ?? []
  );
  return {
    section_keys: Object.keys(content),
    content_version: content.canonical_definition.content_version,
    canonical_fact_set_hash:
      content.canonical_definition.canonical_fact_set_hash,
    concepts: concepts.map((concept) => ({
      concept_id: concept.concept_id,
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
      analogy_concept_id: analogy.analogy_concept_id,
      profile_world_id: analogy.profile_world_id,
      role_keys: Object.keys(analogy.role_map ?? {}),
      relations: relations.map((relation) => ({
        relation_id: relation.relation_id,
        from_role: relation.from_role,
        to_role: relation.to_role,
      })),
      neutral_concept_ids: neutralComparisons.map((item) => item.concept_id),
      controls: analogy.controls,
    },
    breakpoint_kind: content.analogy_breakpoint.kind,
  };
}
