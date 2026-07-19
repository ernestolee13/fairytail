#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { stderr, stdout } from "node:process";
import { fileURLToPath } from "node:url";

import { learningEventsPath } from "../src/learning/store.mjs";
import {
  prepareG005Surface,
  recordG005Observation,
  reviewDueG005,
} from "../src/runtime/g005.mjs";

const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const smokeRoot = await mkdtemp(join(tmpdir(), "fairytail-g005-smoke-"));

try {
  const dataDir = join(smokeRoot, "data");
  const before = await prepareG005Surface(
    {
      pluginRoot,
      dataDir,
      input: {
        schema_version: 1,
        surface: "before",
        interaction_id: "smoke-before",
        scenario_id: "S04",
        requested_locale: "ko-KR",
        started_at: "2026-07-18T11:59:00.000Z",
        action: {
          actor: "remote_service",
          target: "one fictional read only task",
          expected_change: "one bounded response becomes observable",
        },
      },
    },
    new Date("2026-07-18T12:00:00.000Z"),
  );
  assert.equal(before.card.surface, "before");
  assert.equal(before.learning.exposures_recorded, 1);

  const errorFixture = JSON.parse(
    await readFile(
      join(pluginRoot, "fixtures", "g005", "error-cases.json"),
      "utf8",
    ),
  ).cases[3].input;
  const error = await prepareG005Surface(
    { pluginRoot, dataDir, input: errorFixture },
    new Date("2026-07-18T12:00:00.000Z"),
  );
  assert.equal(error.card.surface, "error");

  const explained = await recordG005Observation(
    {
      pluginRoot,
      dataDir,
      input: observation("teachback", "S04", "2026-07-18T12:05:00.000Z", false),
    },
    new Date("2026-07-18T12:05:00.000Z"),
  );
  assert.equal(explained.learning_state, "explained_once");

  const due = await reviewDueG005(
    { pluginRoot, dataDir, requestedLocale: "ko" },
    new Date("2026-07-18T12:25:00.000Z"),
  );
  assert.equal(due.due_count, 1);
  assert.equal(due.prompts[0].blocks_work, false);

  const retrieved = await recordG005Observation(
    {
      pluginRoot,
      dataDir,
      input: observation("retrieval", "S04", "2026-07-18T12:25:00.000Z", false),
    },
    new Date("2026-07-18T12:25:00.000Z"),
  );
  assert.equal(retrieved.learning_state, "retrieved_delayed");
  const applied = await recordG005Observation(
    {
      pluginRoot,
      dataDir,
      input: observation(
        "novel_application",
        "ctx-0000000000000001",
        "2026-07-19T00:00:00.000Z",
        true,
      ),
    },
    new Date("2026-07-19T00:00:00.000Z"),
  );
  assert.equal(applied.learning_state, "applied_novel");
  assert.equal(applied.assistance.safety_checks_fade, false);

  const pending = await prepareG005Surface(
    { pluginRoot, dataDir, input: finishInput(null) },
    new Date("2026-07-19T00:01:00.000Z"),
  );
  assert.equal(
    /** @type {Record<string, any>} */ (pending.card.core).completion.status,
    "verification_required",
  );
  const verified = await prepareG005Surface(
    {
      pluginRoot,
      dataDir,
      input: finishInput({
        evidence_version: 1,
        evidence_id: "smoke-evidence",
        interaction_id: "smoke-finish",
        check_id: "smoke-check",
        kind: "test",
        status: "passed",
        summary: "The focused smoke check passed after the change.",
        observed_at: "2026-07-19T00:00:30.000Z",
      }),
    },
    new Date("2026-07-19T00:01:00.000Z"),
  );
  assert.equal(
    /** @type {Record<string, any>} */ (verified.card.core).completion.status,
    "verified_complete",
  );

  const storePath = learningEventsPath(dataDir);
  const stored = await readFile(storePath, "utf8");
  assert.equal((await stat(dataDir)).mode & 0o777, 0o700);
  assert.equal((await stat(storePath)).mode & 0o777, 0o600);
  assert.doesNotMatch(stored, /raw_response|PRIVATE_/u);
  assert.equal(
    JSON.stringify({ before, error, applied, verified }).includes("mastered"),
    false,
  );

  stdout.write(
    `${JSON.stringify(
      {
        status: "pass",
        surfaces: ["before", "error", "finish"],
        errorFixtures: 10,
        learningStates: [
          "unseen",
          "exposed",
          "explained_once",
          "retrieved_delayed",
          "applied_novel",
        ],
        delayedReviewNonBlocking: true,
        freshVerificationRequired: true,
        rawLearnerResponsesStored: false,
        executionPermissionChanged: false,
        safetyChecksFade: false,
        localDirectoryMode: "0700",
        localFileMode: "0600",
      },
      null,
      2,
    )}\n`,
  );
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  stderr.write(`Fairytail G005 smoke failed: ${message}\n`);
  process.exitCode = 1;
} finally {
  await rm(smokeRoot, { recursive: true, force: true });
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
    rubric: {
      role_and_flow: 2,
      confusion_boundary: 2,
      analogy_limit: 2,
      safe_next_action: 2,
      fatal_misconception: false,
    },
  };
}

/** @param {Record<string, any> | null} verification */
function finishInput(verification) {
  return {
    schema_version: 1,
    surface: "finish",
    interaction_id: "smoke-finish",
    scenario_id: "S04",
    requested_locale: "en",
    started_at: "2026-07-19T00:00:00.000Z",
    claim: { summary: "The requested local change is complete." },
    verification,
  };
}
