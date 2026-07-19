import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  appendLearningEvent,
  deleteLearningEvents,
  exportLearningEvidence,
  learningEventsPath,
  loadLearningEvidenceStore,
} from "../src/learning/store.mjs";

test("learning events are append-only, private, bounded, and contain no raw response", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "fairytail-learning-store-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const dataDir = join(root, "data");

  await appendLearningEvent(dataDir, {
    concept_id: "api-request-response",
    event: {
      type: "exposed",
      scenario_id: "S04",
      at: "2026-07-18T00:00:00.000Z",
    },
  });
  await appendLearningEvent(dataDir, {
    concept_id: "api-request-response",
    event: {
      type: "teachback_scored",
      scenario_id: "S04",
      at: "2026-07-18T00:05:00.000Z",
      score: 7,
      fatal_misconception: false,
    },
  });

  const path = learningEventsPath(dataDir);
  const body = await readFile(path, "utf8");
  assert.equal(body.trim().split("\n").length, 2);
  assert.doesNotMatch(body, /raw_response|PRIVATE_CANARY/u);
  assert.equal((await stat(dataDir)).mode & 0o777, 0o700);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  const loaded = await loadLearningEvidenceStore(dataDir);
  assert.equal(loaded.reason, "ok");
  assert.equal(loaded.records[0].state, "explained_once");
  assert.equal(Object.isFrozen(loaded.records[0]), true);
});

test("a corrupt store fails closed and is never overwritten by append", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "fairytail-learning-corrupt-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const dataDir = join(root, "data");
  const path = learningEventsPath(dataDir);
  await mkdir(dataDir, { recursive: true });
  await writeFile(path, "PRIVATE_CORRUPT_CANARY\n", { mode: 0o600 });
  const before = await readFile(path, "utf8");

  const loaded = await loadLearningEvidenceStore(dataDir);
  assert.deepEqual(loaded, {
    source: "default",
    reason: "invalid-store",
    records: [],
  });
  await assert.rejects(
    appendLearningEvent(dataDir, {
      concept_id: "api-request-response",
      event: {
        type: "exposed",
        scenario_id: "S04",
        at: "2026-07-18T00:00:00.000Z",
      },
    }),
    /invalid and was not modified/u,
  );
  assert.equal(await readFile(path, "utf8"), before);
});

test("export is explicit and deletion targets only the learning event file", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "fairytail-learning-lifecycle-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const dataDir = join(root, "data");
  const sibling = join(dataDir, "keep.txt");
  const destination = join(root, "export", "learning.json");
  await appendLearningEvent(dataDir, {
    concept_id: "api-request-response",
    event: {
      type: "exposed",
      scenario_id: "S04",
      at: "2026-07-18T00:00:00.000Z",
    },
  });
  await writeFile(sibling, "keep", "utf8");

  await exportLearningEvidence(dataDir, destination);
  assert.equal((await stat(destination)).mode & 0o777, 0o600);
  assert.equal(
    JSON.parse(await readFile(destination, "utf8")).records.length,
    1,
  );
  await assert.rejects(exportLearningEvidence(dataDir, destination));

  assert.deepEqual(await deleteLearningEvents(dataDir), {
    ok: true,
    deleted: true,
  });
  assert.equal(await readFile(sibling, "utf8"), "keep");
  assert.equal((await deleteLearningEvents(dataDir)).deleted, false);
});
