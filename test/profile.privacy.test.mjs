import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { handleHook } from "../src/hook.mjs";
import { completeOnboarding } from "../src/profile/onboarding.mjs";
import {
  LOCAL_ONLY_FIELDS,
  approvePersonalization,
  constructApprovedProjection,
  projectionDigest,
  transmissionPreview,
  withApprovedProjection,
} from "../src/profile/privacy.mjs";
import { localOnlyProfile, validateProfile } from "../src/profile/profile.mjs";

const now = new Date("2026-07-18T10:00:00.000Z");
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const answers = {
  background_categories: ["operations"],
  familiar_labels: ["일정 관리·업무 인계"],
  coding_actions: ["ran_command"],
  presentation_preference: "analogy_first",
  safety_concerns: ["privacy"],
  language: "ko",
};

test("typed projection contains only approved fields and label-only familiar worlds", () => {
  const approved = completeOnboarding(answers, "approve", now).profile;
  const withLocalCanaries = validateProfile({
    ...approved,
    observed_experience: ["PRIVATE_OBSERVED_CANARY"],
    safety_concerns: ["PRIVATE_SAFETY_CANARY"],
  });
  const constructed = constructApprovedProjection(withLocalCanaries);
  assert.equal(constructed.status, "ready");
  if (constructed.status !== "ready") return;
  assert.deepEqual(Object.keys(constructed.projection), [
    "language",
    "presentation_preference",
    "familiar_worlds",
  ]);
  assert.deepEqual(
    Object.keys(constructed.projection.familiar_worlds?.[0] ?? {}),
    ["label"],
  );
  const serialized = JSON.stringify(constructed.projection);
  assert.doesNotMatch(
    serialized,
    /PRIVATE_|profile_id|observed_experience|safety_concerns|approved_at|updated_at/u,
  );
});

test("profile projection schema is Draft 2020-12 and closed at both object levels", async () => {
  const schema = JSON.parse(
    await readFile(
      join(root, "schemas", "v1", "profile-projection.schema.json"),
      "utf8",
    ),
  );
  assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(Object.keys(schema.properties), [
    "language",
    "presentation_preference",
    "familiar_worlds",
  ]);
  assert.equal(
    schema.properties.familiar_worlds.items.additionalProperties,
    false,
  );
  assert.deepEqual(
    Object.keys(schema.properties.familiar_worlds.items.properties),
    ["label"],
  );
});

test("neutral, no-analogy, invalid, and unsafe profiles invoke the boundary zero times", async () => {
  const approved = completeOnboarding(answers, "approve", now).profile;
  const neutral = localOnlyProfile(approved, now);
  const noAnalogy = localOnlyProfile(approved, now, {
    noAnalogy: true,
    presentation: "neutral",
  });
  const invalid = { ...approved, raw_onboarding: "PRIVATE_RAW_CANARY" };
  const unsafe = structuredClone(approved);
  unsafe.familiar_worlds[0].label = "PRIVATE_EMAIL_CANARY@example.test";

  for (const profile of [neutral, noAnalogy, invalid, unsafe]) {
    let calls = 0;
    const result = await withApprovedProjection(profile, () => {
      calls += 1;
    });
    assert.equal(result.calls, 0);
    assert.equal(calls, 0);
  }
});

test("personalized boundary invokes once with an immutable safe projection", async () => {
  const approved = completeOnboarding(answers, "approve", now).profile;
  let captured = "";
  const result = await withApprovedProjection(approved, (projection) => {
    captured = JSON.stringify(projection);
    assert.equal(Object.isFrozen(projection), true);
    assert.equal(Object.isFrozen(projection.familiar_worlds), true);
    return "intercepted";
  });
  assert.deepEqual(result, {
    calls: 1,
    status: "delivered",
    result: "intercepted",
  });
  assert.doesNotMatch(captured, /profile_id|observed|safety|PRIVATE_/u);
});

test("preview drives consent and revocation without retaining a raw prompt", () => {
  const neutral = completeOnboarding(answers, "neutral", now).profile;
  const preview = transmissionPreview(neutral, ["language", "familiar_worlds"]);
  assert.equal(preview.status, "ready");
  assert.deepEqual(preview.fields, ["language", "familiar_worlds"]);
  assert.deepEqual(preview.excluded_local_fields, LOCAL_ONLY_FIELDS);

  const approval = approvePersonalization(
    neutral,
    ["language", "familiar_worlds"],
    now,
  );
  assert.equal(approval.approved, true);
  assert.deepEqual(approval.profile.model_processing.approved_fields, [
    "language",
    "familiar_worlds",
  ]);
  assert.equal(approval.preview.status, "ready");
  if (approval.preview.status !== "ready") return;
  assert.equal(
    approval.profile.model_processing.approved_projection_digest,
    projectionDigest(approval.preview.projection),
  );
  const serialized = JSON.stringify(approval.profile.model_processing);
  assert.doesNotMatch(serialized, /prompt|response|preview|PRIVATE_/u);
});

test("consent digest rejects a later change to an approved projection", () => {
  const approved = completeOnboarding(answers, "approve", now).profile;
  const changed = structuredClone(approved);
  changed.presentation_preference = "checklist";
  const result = constructApprovedProjection(validateProfile(changed));
  assert.deepEqual(result, {
    status: "fallback",
    reason: "projection-consent-mismatch",
  });
});

test("denylisted canaries never enter plugin logs, snapshots, or caches", async (context) => {
  const dataDir = await mkdtemp(join(tmpdir(), "fairytail-privacy-"));
  context.after(() => rm(dataDir, { recursive: true, force: true }));
  const canary = "PRIVATE_BOUNDARY_CANARY";
  await handleHook(
    {
      hook_event_name: "SessionStart",
      profile: canary,
      prompt: canary,
      error: canary,
    },
    { dataDir, now: () => now },
  );
  const log = await readFile(join(dataDir, "events.jsonl"), "utf8");
  assert.doesNotMatch(log, new RegExp(canary, "u"));
  assert.deepEqual(
    (await readdir(dataDir)).filter((name) => /cache|snapshot/iu.test(name)),
    [],
  );
});
