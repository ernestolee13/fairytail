import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { analogyCachePath, loadAnalogyCache } from "../src/analogy/cache.mjs";
import { evaluateGoldenCases } from "../src/analogy/evaluate.mjs";
import {
  ANALOGY_NETWORK_CALLS,
  LIVE_ANALOGY_GENERATION_ENABLED,
  loadAnalogyRuntime,
  resolveAnalogy as resolveAnalogyProduction,
} from "../src/analogy/engine.mjs";
import { renderScenario } from "../src/analogy/render.mjs";
import { completeOnboarding } from "../src/profile/onboarding.mjs";
import { validateProfile } from "../src/profile/profile.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const now = new Date("2026-07-18T12:00:00.000Z");
const runtime = await loadAnalogyRuntime(root, now);

/** Keep this file on the frozen seed catalog it was written to audit. */
/** @param {any} runtimeValue @param {any} input */
function resolveAnalogy(runtimeValue, input) {
  return resolveAnalogyProduction(runtimeValue, {
    ...input,
    regressionCatalog: true,
  });
}

function approvedProfile(overrides = {}) {
  const completed = completeOnboarding(
    {
      background_categories: ["healthcare"],
      familiar_labels: [],
      coding_actions: ["none"],
      presentation_preference: "analogy_first",
      safety_concerns: ["privacy"],
      language: "ko",
      ...overrides,
    },
    "approve",
    now,
  );
  assert.equal(completed.approved, true);
  return completed.profile;
}

test("raw profile, log, error, secret, and learning-history canaries never reach selection, render, or cache", async (context) => {
  const dataDir = await mkdtemp(join(tmpdir(), "fairytail-analogy-privacy-"));
  context.after(() => rm(dataDir, { recursive: true, force: true }));
  const localCanaries = validateProfile({
    ...approvedProfile(),
    observed_experience: ["PRIVATE_OBSERVED_CANARY"],
    safety_concerns: ["PRIVATE_SAFETY_CANARY"],
  });
  const input = /** @type {any} */ ({
    profile: localCanaries,
    scenarioId: "S04",
    dataDir,
    raw_profile: "PRIVATE_RAW_PROFILE_CANARY",
    log: "PRIVATE_LOG_CANARY",
    error: "PRIVATE_ERROR_CANARY",
    secret: "PRIVATE_SECRET_CANARY",
    learning_history: "PRIVATE_HISTORY_CANARY",
  });
  const resolution = await resolveAnalogy(runtime, input);
  assert.equal(resolution.kind, "mapped");
  const rendered = renderScenario(runtime, "S04", resolution);
  const serialized = [
    JSON.stringify(resolution),
    JSON.stringify(rendered),
    await readFile(analogyCachePath(dataDir), "utf8"),
  ].join("\n");

  assert.doesNotMatch(serialized, /PRIVATE_/u);
  assert.doesNotMatch(
    serialized,
    /observed_experience|safety_concerns|learning_history|raw_profile|approved_projection_digest/iu,
  );
});

test("approved but unpublished familiar worlds use neutral rendering and create no cache", async (context) => {
  const dataDir = await mkdtemp(join(tmpdir(), "fairytail-unknown-world-"));
  context.after(() => rm(dataDir, { recursive: true, force: true }));
  const profile = approvedProfile({
    background_categories: ["none"],
    familiar_labels: ["community garden planning"],
  });
  const resolution = await resolveAnalogy(runtime, {
    profile,
    scenarioId: "S04",
    dataDir,
  });

  assert.deepEqual(resolution, {
    kind: "neutral",
    reason: "no-reviewed-world-match",
    profile_projection_calls: 1,
    network_calls: 0,
  });
  assert.equal(
    renderScenario(runtime, "S04", resolution).analogy_or_neutral_fallback.kind,
    "neutral",
  );
  assert.equal((await loadAnalogyCache(dataDir)).reason, "not-found");
});

test("concrete projection consent is rechecked after every local profile change", async () => {
  const profile = approvedProfile();
  const changed = structuredClone(profile);
  changed.presentation_preference = "checklist";
  const resolution = await resolveAnalogy(runtime, {
    profile: validateProfile(changed),
    scenarioId: "S04",
  });

  assert.deepEqual(resolution, {
    kind: "neutral",
    reason: "projection-consent-mismatch",
    profile_projection_calls: 0,
    network_calls: 0,
  });
});

test("bounded seed selector and evaluator never call fetch despite production personalization support", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = /** @type {typeof fetch} */ (
    async () => {
      fetchCalls += 1;
      throw new Error("PRIVATE_NETWORK_CANARY");
    }
  );
  try {
    const resolution = await resolveAnalogy(runtime, {
      profile: approvedProfile(),
      scenarioId: "S04",
    });
    assert.equal(resolution.kind, "mapped");
    assert.equal((await evaluateGoldenCases(runtime, now)).status, "pass");
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(fetchCalls, 0);
  assert.equal(ANALOGY_NETWORK_CALLS, 0);
  assert.equal(LIVE_ANALOGY_GENERATION_ENABLED, true);
});
