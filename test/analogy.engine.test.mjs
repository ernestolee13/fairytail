import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { loadAnalogyCache } from "../src/analogy/cache.mjs";
import {
  loadAnalogyRuntime,
  loadAnalogyRuntimeSafe,
  resolveAnalogy as resolveAnalogyBase,
} from "../src/analogy/engine.mjs";
import { renderScenario, stableRenderBytes } from "../src/analogy/render.mjs";
import { completeOnboarding } from "../src/profile/onboarding.mjs";
import { localOnlyProfile, validateProfile } from "../src/profile/profile.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const now = new Date("2026-07-18T12:00:00.000Z");
const runtime = await loadAnalogyRuntime(root, now);
/** @param {any} runtimeValue @param {any} input */
const resolveAnalogy = (runtimeValue, input) =>
  resolveAnalogyBase(runtimeValue, { ...input, regressionCatalog: true });

function approvedProfile() {
  const completed = completeOnboarding(
    {
      background_categories: ["healthcare"],
      familiar_labels: [],
      coding_actions: ["none"],
      presentation_preference: "analogy_first",
      safety_concerns: ["privacy"],
      language: "ko",
    },
    "approve",
    now,
  );
  assert.equal(completed.approved, true);
  return completed.profile;
}

test("validated selection is deterministic and cache hits render byte-for-byte", async (context) => {
  const dataDir = await mkdtemp(join(tmpdir(), "fairytail-engine-cache-"));
  context.after(() => rm(dataDir, { recursive: true, force: true }));
  const profile = approvedProfile();

  const first = await resolveAnalogy(runtime, {
    profile,
    scenarioId: "S04",
    dataDir,
  });
  assert.equal(first.kind, "mapped");
  if (first.kind !== "mapped") return;
  assert.equal(first.mapping_id, "P1-S04-A1");
  assert.equal(first.profile_world_id, "hospital-nursing");
  assert.equal(first.source, "catalog");
  const firstBytes = stableRenderBytes(renderScenario(runtime, "S04", first));

  const repeated = await resolveAnalogy(runtime, {
    profile,
    scenarioId: "S04",
    dataDir,
  });
  assert.equal(repeated.kind, "mapped");
  if (repeated.kind !== "mapped") return;
  assert.equal(repeated.mapping_id, first.mapping_id);
  assert.equal(repeated.source, "cache");
  assert.deepEqual(
    stableRenderBytes(renderScenario(runtime, "S04", repeated)),
    firstBytes,
  );
});

test("different and unfamiliar stay inside the approved world or fall back to neutral", async (context) => {
  const dataDir = await mkdtemp(join(tmpdir(), "fairytail-engine-controls-"));
  context.after(() => rm(dataDir, { recursive: true, force: true }));
  const profile = approvedProfile();
  const first = await resolveAnalogy(runtime, {
    profile,
    scenarioId: "S04",
    dataDir,
  });
  assert.equal(first.kind, "mapped");
  if (first.kind !== "mapped") return;

  const different = await resolveAnalogy(runtime, {
    profile,
    scenarioId: "S04",
    dataDir,
    choice: "different",
    priorMappingId: first.mapping_id,
  });
  assert.deepEqual(different, {
    kind: "neutral",
    reason: "no-validated-alternative",
    profile_projection_calls: 1,
    network_calls: 0,
  });

  const unfamiliar = await resolveAnalogy(runtime, {
    profile,
    scenarioId: "S04",
    dataDir,
    choice: "unfamiliar",
    priorMappingId: first.mapping_id,
  });
  assert.deepEqual(unfamiliar, {
    kind: "neutral",
    reason: "no-validated-alternative",
    profile_projection_calls: 1,
    network_calls: 0,
  });
  const stored = await loadAnalogyCache(dataDir);
  assert.deepEqual(stored.cache.rejections, [
    {
      mapping_id: first.mapping_id,
      mapping_version: first.mapping_version,
      reason_code: "unfamiliar",
    },
  ]);
  assert.ok(
    stored.cache.entries.every(
      (entry) => entry.mapping_id !== first.mapping_id,
    ),
  );

  const crossWorldPrior = await resolveAnalogy(runtime, {
    profile,
    scenarioId: "S04",
    dataDir,
    choice: "different",
    priorMappingId: "P2-S04-A1",
  });
  assert.deepEqual(crossWorldPrior, {
    kind: "neutral",
    reason: "prior-mapping-outside-approved-world",
    profile_projection_calls: 1,
    network_calls: 0,
  });

  const preferredAgain = await resolveAnalogy(runtime, {
    profile,
    scenarioId: "S04",
    dataDir,
  });
  assert.deepEqual(preferredAgain, {
    kind: "neutral",
    reason: "no-validated-alternative",
    profile_projection_calls: 1,
    network_calls: 0,
  });
});

test("neutral, no-analogy, digest mismatch, and invalid exclusions clear personalization cache", async (context) => {
  const dataDir = await mkdtemp(join(tmpdir(), "fairytail-engine-fallback-"));
  context.after(() => rm(dataDir, { recursive: true, force: true }));
  const approved = approvedProfile();
  const first = await resolveAnalogy(runtime, {
    profile: approved,
    scenarioId: "S04",
    dataDir,
  });
  assert.equal(first.kind, "mapped");

  const invalidExclusion = await resolveAnalogy(runtime, {
    profile: approved,
    scenarioId: "S04",
    dataDir,
    rejectedMappingIds: ["../../PRIVATE_CANARY"],
  });
  assert.deepEqual(invalidExclusion, {
    kind: "neutral",
    reason: "invalid-rejected-mapping-id",
    profile_projection_calls: 1,
    network_calls: 0,
  });
  assert.equal((await loadAnalogyCache(dataDir)).reason, "not-found");

  const mismatched = structuredClone(approved);
  mismatched.familiar_worlds[0].label = "병원·간호";
  const digestMismatch = await resolveAnalogy(runtime, {
    profile: validateProfile(mismatched),
    scenarioId: "S04",
    dataDir,
  });
  assert.equal(digestMismatch.kind, "neutral");
  assert.equal(digestMismatch.reason, "projection-consent-mismatch");
  assert.equal(digestMismatch.profile_projection_calls, 0);

  const neutral = await resolveAnalogy(runtime, {
    profile: localOnlyProfile(approved, now),
    scenarioId: "S04",
    dataDir,
  });
  assert.equal(neutral.kind, "neutral");
  assert.equal(neutral.profile_projection_calls, 0);

  const none = await resolveAnalogy(runtime, {
    profile: approved,
    scenarioId: "S04",
    dataDir,
    choice: "no_analogy",
  });
  assert.deepEqual(none, {
    kind: "none",
    reason: "user-no-analogy",
    profile_projection_calls: 0,
    network_calls: 0,
  });
  assert.equal((await loadAnalogyCache(dataDir)).reason, "not-found");
});

test("renderer suppresses a forged mapping while preserving canonical facts", async () => {
  const resolution = await resolveAnalogy(runtime, {
    profile: approvedProfile(),
    scenarioId: "S04",
  });
  assert.equal(resolution.kind, "mapped");
  if (resolution.kind !== "mapped") return;
  const expected = renderScenario(runtime, "S04", resolution);
  const forged = {
    ...resolution,
    mapping_hash: "0".repeat(64),
  };
  const rendered = renderScenario(runtime, "S04", forged);

  assert.equal(rendered.analogy_or_neutral_fallback.kind, "neutral");
  assert.equal(
    rendered.analogy_or_neutral_fallback.reason,
    "unpublishable-mapping",
  );
  assert.deepEqual(
    rendered.canonical_definition,
    expected.canonical_definition,
  );

  const sameHashForgery = {
    ...resolution,
    analogy_label: "Bypassed regression gate",
    role_map: Object.fromEntries(
      Object.keys(resolution.role_map).map((role) => [role, `forged ${role}`]),
    ),
  };
  const sameHashRendered = renderScenario(runtime, "S04", sameHashForgery);
  assert.equal(sameHashRendered.analogy_or_neutral_fallback.kind, "neutral");
  assert.equal(
    sameHashRendered.analogy_or_neutral_fallback.reason,
    "unpublishable-mapping",
  );
  assert.doesNotMatch(
    JSON.stringify(sameHashRendered),
    /Bypassed regression gate|forged API/u,
  );
});

test("damaged analogy assets degrade to neutral without weakening canonical validation", async (context) => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "fairytail-runtime-safe-"));
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
    "v1",
    "validated-analogy-mappings.json",
  );
  const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
  catalog.mapping_catalog_hash = "0".repeat(64);
  await writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);

  await assert.rejects(() => loadAnalogyRuntime(fixtureRoot, now));
  const loaded = await loadAnalogyRuntimeSafe(fixtureRoot, now);
  assert.equal(loaded.status, "fallback");
  assert.equal(loaded.runtime.publication.selectionMode, "neutral-only");
  assert.equal(loaded.runtime.publication.mappingCount, 0);
  const resolution = await resolveAnalogy(loaded.runtime, {
    profile: approvedProfile(),
    scenarioId: "S04",
  });
  assert.equal(resolution.kind, "neutral");
  assert.equal(resolution.reason, "no-reviewed-world-match");
  const rendered = renderScenario(loaded.runtime, "S04", resolution);
  assert.equal(rendered.analogy_or_neutral_fallback.kind, "neutral");
  assert.ok(rendered.canonical_definition.concepts.length > 0);
});
