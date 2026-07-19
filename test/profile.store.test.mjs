import assert from "node:assert/strict";
import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { completeOnboarding } from "../src/profile/onboarding.mjs";
import { validateProfile } from "../src/profile/profile.mjs";
import {
  deleteProfile,
  exportProfile,
  loadProfile,
  profilePath,
  resetProfile,
  saveProfile,
} from "../src/profile/store.mjs";

const now = new Date("2026-07-18T10:00:00.000Z");
const answers = {
  background_categories: ["content"],
  familiar_labels: ["글 초안·교정·발행 순서"],
  coding_actions: ["none"],
  presentation_preference: "checklist",
  safety_concerns: ["cost"],
  language: "ko",
};

test("clean fixture starts in safe neutral mode and private storage works offline", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "fairytail-store-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const dataDir = join(root, "data");
  const priorFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = /** @type {typeof fetch} */ (
    async () => {
      networkCalls += 1;
      throw new Error("network disabled");
    }
  );
  context.after(() => {
    globalThis.fetch = priorFetch;
  });

  const first = await loadProfile(dataDir, now);
  assert.equal(first.source, "default");
  assert.equal(first.reason, "not-found");
  assert.equal(first.needsOnboarding, true);
  assert.equal(first.profile.model_processing.mode, "neutral_local");
  assert.deepEqual(first.profile.model_processing.approved_fields, []);

  const profile = completeOnboarding(answers, "neutral", now).profile;
  await saveProfile(dataDir, profile);
  assert.equal((await stat(dataDir)).mode & 0o777, 0o700);
  assert.equal((await stat(profilePath(dataDir))).mode & 0o777, 0o600);
  const stored = await loadProfile(dataDir, now);
  assert.equal(stored.source, "stored");
  assert.equal(stored.needsOnboarding, false);
  assert.deepEqual(stored.profile, profile);
  assert.equal(networkCalls, 0);
});

test("invalid and corrupt profiles fail to a neutral default without execution", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "fairytail-corrupt-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const dataDir = join(root, "data");
  await saveProfile(
    dataDir,
    completeOnboarding(answers, "neutral", now).profile,
  );
  await writeFile(
    profilePath(dataDir),
    '{"profile_version":1,"constructor":{"polluted":true}}',
    "utf8",
  );
  const loaded = await loadProfile(dataDir, now);
  assert.equal(loaded.source, "default");
  assert.equal(loaded.reason, "invalid-profile");
  assert.equal(loaded.profile.model_processing.mode, "neutral_local");
  assert.equal(Object.hasOwn(Object.prototype, "polluted"), false);
});

test("export, reset, and exact-file delete are deterministic", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "fairytail-lifecycle-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const dataDir = join(root, "data");
  const exportPath = join(root, "exports", "fairytail-profile.json");
  const profile = completeOnboarding(answers, "approve", now).profile;
  await saveProfile(dataDir, profile);

  await exportProfile(dataDir, exportPath);
  assert.deepEqual(
    validateProfile(JSON.parse(await readFile(exportPath, "utf8"))),
    profile,
  );
  assert.equal((await stat(exportPath)).mode & 0o777, 0o600);
  await assert.rejects(exportProfile(dataDir, exportPath));
  assert.deepEqual(
    validateProfile(JSON.parse(await readFile(exportPath, "utf8"))),
    profile,
  );

  const reset = await resetProfile(dataDir, now);
  assert.equal(reset.profile.model_processing.mode, "neutral_local");
  assert.equal(reset.profile.presentation_preference, "neutral");
  assert.deepEqual(reset.profile.familiar_worlds, []);

  const sibling = join(dataDir, "keep-me.txt");
  await writeFile(sibling, "keep", "utf8");
  const deleted = await deleteProfile(dataDir);
  assert.equal(deleted.deleted, true);
  assert.equal(await readFile(sibling, "utf8"), "keep");
  assert.equal((await deleteProfile(dataDir)).deleted, false);
  assert.equal((await loadProfile(dataDir, now)).needsOnboarding, true);
});

test("profile writes repair only the exact file and preserve an existing caller directory mode", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "fairytail-mode-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const dataDir = join(root, "data");
  const profile = completeOnboarding(answers, "neutral", now).profile;
  await saveProfile(dataDir, profile);
  await chmod(dataDir, 0o755);
  await chmod(profilePath(dataDir), 0o644);
  await saveProfile(dataDir, profile);
  assert.equal((await stat(dataDir)).mode & 0o777, 0o755);
  assert.equal((await stat(profilePath(dataDir))).mode & 0o777, 0o600);
});
