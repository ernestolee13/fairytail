import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { learningEventsPath } from "../src/learning/store.mjs";
import {
  prepareG005Surface,
  recordG005Observation,
  reviewDueG005,
} from "../src/runtime/g005.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const rubric = {
  role_and_flow: 2,
  confusion_boundary: 2,
  analogy_limit: 2,
  safe_next_action: 2,
  fatal_misconception: false,
};

test("runtime connects exposure, delayed retrieval, novel transfer, and evidence-based fading", async (context) => {
  const temporary = await mkdtemp(join(tmpdir(), "fairytail-g005-runtime-"));
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const dataDir = join(temporary, "data");

  const before = await prepareG005Surface(
    {
      pluginRoot: root,
      dataDir,
      input: beforeInput(),
    },
    new Date("2026-07-18T12:00:00.000Z"),
  );
  assert.equal(before.status, "ready");
  assert.equal(before.card.surface, "before");
  assert.equal(before.learning.exposures_recorded, 1);
  assert.deepEqual(before.effects, {
    network_calls: 0,
    model_calls: 0,
    action_execution_calls: 0,
  });

  const explained = await recordG005Observation(
    {
      pluginRoot: root,
      dataDir,
      input: observation("teachback", "S04", "2026-07-18T12:05:00.000Z", false),
    },
    new Date("2026-07-18T12:05:00.000Z"),
  );
  assert.equal(explained.learning_state, "explained_once");
  assert.equal(explained.next_retrieval_after, "2026-07-18T12:25:00.000Z");
  assert.equal(explained.raw_response_stored, false);

  const early = await reviewDueG005(
    { pluginRoot: root, dataDir, requestedLocale: "ko-KR" },
    new Date("2026-07-18T12:24:59.999Z"),
  );
  assert.equal(early.due_count, 0);
  const due = await reviewDueG005(
    { pluginRoot: root, dataDir, requestedLocale: "ko-KR" },
    new Date("2026-07-18T12:25:00.000Z"),
  );
  assert.equal(due.due_count, 1);
  assert.equal(due.prompts[0].skippable, true);
  assert.equal(due.prompts[0].blocks_work, false);
  assert.equal(due.raw_history_included, false);

  const retrieved = await recordG005Observation(
    {
      pluginRoot: root,
      dataDir,
      input: observation("retrieval", "S04", "2026-07-18T12:25:00.000Z", false),
    },
    new Date("2026-07-18T12:25:00.000Z"),
  );
  assert.equal(retrieved.learning_state, "retrieved_delayed");
  assert.equal(retrieved.assistance.explanation_detail, "compact");

  const failedNovelInput = observation(
    "novel_application",
    "ctx-0000000000000001",
    "2026-07-19T00:00:00.000Z",
    true,
  );
  failedNovelInput.rubric = {
    ...rubric,
    role_and_flow: 0,
    confusion_boundary: 0,
  };
  const failedNovel = await recordG005Observation(
    { pluginRoot: root, dataDir, input: failedNovelInput },
    new Date("2026-07-19T00:00:00.000Z"),
  );
  assert.equal(failedNovel.learning_state, "retrieved_delayed");
  assert.equal(failedNovel.assistance.recovery_support, true);
  await assert.rejects(
    recordG005Observation(
      {
        pluginRoot: root,
        dataDir,
        input: observation(
          "novel_application",
          "ctx-0000000000000001",
          "2026-07-19T00:00:01.000Z",
          true,
        ),
      },
      new Date("2026-07-19T00:00:01.000Z"),
    ),
    /different bounded context/u,
  );
  const applied = await recordG005Observation(
    {
      pluginRoot: root,
      dataDir,
      input: observation(
        "novel_application",
        "ctx-0000000000000002",
        "2026-07-19T00:00:02.000Z",
        true,
      ),
    },
    new Date("2026-07-19T00:00:02.000Z"),
  );
  assert.equal(applied.learning_state, "applied_novel");
  assert.equal(applied.assistance.explanation_detail, "minimal");
  assert.equal(applied.assistance.safety_detail, "full");
  assert.equal(applied.assistance.safety_checks_fade, false);
  assert.equal(applied.execution_permission_changed, false);

  const stored = await readFile(learningEventsPath(dataDir), "utf8");
  assert.doesNotMatch(stored, /raw_response|PRIVATE_RESPONSE_CANARY/u);
  assert.equal(JSON.stringify(applied).includes("mastered"), false);
});

test("runtime finish remains pending until fresh passing evidence exists", async (context) => {
  const temporary = await mkdtemp(join(tmpdir(), "fairytail-g005-finish-"));
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const dataDir = join(temporary, "data");
  const base = finishInput(null);
  const pending = await prepareG005Surface(
    { pluginRoot: root, dataDir, input: base },
    new Date("2026-07-18T12:00:00.000Z"),
  );
  assert.equal(
    /** @type {Record<string, any>} */ (pending.card.core).completion.status,
    "verification_required",
  );

  const verified = await prepareG005Surface(
    {
      pluginRoot: root,
      dataDir,
      input: finishInput({
        evidence_version: 1,
        evidence_id: "fresh-check",
        interaction_id: "finish-runtime",
        check_id: "targeted-tests",
        kind: "test",
        status: "passed",
        summary: "The focused check passed after the change.",
        observed_at: "2026-07-18T11:55:00.000Z",
      }),
    },
    new Date("2026-07-18T12:00:00.000Z"),
  );
  assert.equal(
    /** @type {Record<string, any>} */ (verified.card.core).completion.status,
    "verified_complete",
  );
});

test("runtime inputs are closed and production code has no execution or network surface", async () => {
  await assert.rejects(
    recordG005Observation({
      pluginRoot: root,
      dataDir: root,
      input: {
        ...observation("teachback", "S04", "2026-07-18T12:00:00.000Z", false),
        raw_response: "PRIVATE_RESPONSE_CANARY",
      },
    }),
    /exactly/u,
  );
  await assert.rejects(
    recordG005Observation({
      pluginRoot: root,
      dataDir: root,
      input: observation("teachback", "S02", "2026-07-18T12:00:00.000Z", false),
    }),
    /belong to the reviewed scenario/u,
  );
  await assert.rejects(
    recordG005Observation({
      pluginRoot: root,
      dataDir: root,
      input: observation(
        "novel_application",
        "project-name",
        "2026-07-18T12:00:00.000Z",
        true,
      ),
    }),
    /opaque ctx identifier/u,
  );

  const source = await readFile(
    join(root, "src", "runtime", "g005.mjs"),
    "utf8",
  );
  assert.doesNotMatch(source, /node:child_process/u);
  assert.doesNotMatch(source, /\b(?:exec|execFile|spawn|fork)\s*\(/u);
  assert.doesNotMatch(source, /\bfetch\s*\(/u);
});

function beforeInput() {
  return {
    schema_version: 1,
    surface: "before",
    interaction_id: "before-runtime",
    scenario_id: "S04",
    requested_locale: "ko-KR",
    started_at: "2026-07-18T11:59:00.000Z",
    action: {
      actor: "remote_service",
      target: "one fictional read only task",
      expected_change: "one bounded response becomes observable",
    },
  };
}

/** @param {string} kind @param {string} scenarioId @param {string} at @param {boolean} novelContext */
function observation(kind, scenarioId, at, novelContext) {
  return {
    schema_version: 1,
    observation: kind,
    concept_id: "api-request-response",
    scenario_id: scenarioId,
    at,
    novel_context: novelContext,
    rubric,
  };
}

/** @param {Record<string, any> | null} verification */
function finishInput(verification) {
  return {
    schema_version: 1,
    surface: "finish",
    interaction_id: "finish-runtime",
    scenario_id: "S04",
    requested_locale: "en",
    started_at: "2026-07-18T11:50:00.000Z",
    claim: { summary: "The requested local change is complete." },
    verification,
  };
}
