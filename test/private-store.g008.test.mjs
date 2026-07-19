import assert from "node:assert/strict";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  analogyCachePath,
  loadAnalogyCache,
  recordMappingRejection,
} from "../src/analogy/cache.mjs";
import { EVENT_LOG_FILE, handleHook } from "../src/hook.mjs";
import {
  appendLearningEvent,
  learningEventsPath,
  loadLearningEvidenceStore,
} from "../src/learning/store.mjs";
import { defaultProfile } from "../src/profile/profile.mjs";
import {
  loadProfile,
  profilePath,
  saveProfile,
} from "../src/profile/store.mjs";

const now = new Date("2026-07-18T12:00:00.000Z");

test("private stores reject exact-file symlinks without changing outside files or caller directory modes", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "fairytail-private-file-link-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const dataDir = join(root, "caller-data");
  await mkdir(dataDir, { mode: 0o755 });
  await chmod(dataDir, 0o755);
  const targets = {
    learning: join(root, "outside-learning.txt"),
    profile: join(root, "outside-profile.txt"),
    cache: join(root, "outside-cache.txt"),
    events: join(root, "outside-events.txt"),
  };
  for (const [name, path] of Object.entries(targets)) {
    await writeFile(path, `outside-${name}\n`);
  }
  await symlink(targets.learning, learningEventsPath(dataDir));
  await symlink(targets.profile, profilePath(dataDir));
  await symlink(targets.cache, analogyCachePath(dataDir));
  await symlink(targets.events, join(dataDir, EVENT_LOG_FILE));

  assert.equal(
    (await loadLearningEvidenceStore(dataDir)).reason,
    "invalid-store",
  );
  await assert.rejects(appendLearningEvent(dataDir, learningEvent()));
  assert.equal((await loadProfile(dataDir, now)).reason, "invalid-profile");
  await assert.rejects(saveProfile(dataDir, defaultProfile(now)));
  assert.equal((await loadAnalogyCache(dataDir)).reason, "invalid-cache");
  await assert.rejects(recordMappingRejection(dataDir, cacheRejection()));
  const hook = await handleHook(
    { hook_event_name: "SessionStart" },
    { dataDir, now: () => now },
  );
  assert.deepEqual(hook.persistence, { ok: false, reason: "write-failed" });

  for (const [name, path] of Object.entries(targets)) {
    assert.equal(await readFile(path, "utf8"), `outside-${name}\n`);
  }
  assert.equal((await stat(dataDir)).mode & 0o777, 0o755);
});

test("private stores reject a symlinked data root without populating or chmodding its target", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "fairytail-private-root-link-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const outsideDir = join(root, "outside-data");
  const dataDir = join(root, "linked-data");
  await mkdir(outsideDir, { mode: 0o755 });
  await chmod(outsideDir, 0o755);
  await writeFile(join(outsideDir, "canary.txt"), "outside-root\n");
  await symlink(outsideDir, dataDir);

  await assert.rejects(saveProfile(dataDir, defaultProfile(now)));
  await assert.rejects(appendLearningEvent(dataDir, learningEvent()));
  await assert.rejects(recordMappingRejection(dataDir, cacheRejection()));
  const hook = await handleHook(
    { hook_event_name: "SessionStart" },
    { dataDir, now: () => now },
  );
  assert.deepEqual(hook.persistence, { ok: false, reason: "write-failed" });

  assert.deepEqual(await readdir(outsideDir), ["canary.txt"]);
  assert.equal(
    await readFile(join(outsideDir, "canary.txt"), "utf8"),
    "outside-root\n",
  );
  assert.equal((await stat(outsideDir)).mode & 0o777, 0o755);
});

function learningEvent() {
  return {
    concept_id: "api-request-response",
    event: {
      type: "exposed",
      scenario_id: "S04",
      at: now.toISOString(),
    },
  };
}

function cacheRejection() {
  return {
    mapping_id: "P1-S04-A1",
    mapping_version: 1,
    reason_code: "unfamiliar",
  };
}
