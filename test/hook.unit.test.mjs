import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  EVENT_LOG_FILE,
  FAILURE_CONTEXT,
  VERIFICATION_CONTEXT,
  eventEnvelope,
  handleHook,
  isVerificationCommand,
  responseFor,
} from "../src/hook.mjs";
import { appendLearningEvent } from "../src/learning/store.mjs";

test("SessionStart stays silent when no delayed review is due", () => {
  assert.deepEqual(responseFor({ hook_event_name: "SessionStart" }), {});
});

test("failure and verification cues are generic and never copy event content", () => {
  assert.deepEqual(responseFor({ hook_event_name: "PostToolUseFailure" }), {
    hookSpecificOutput: {
      hookEventName: "PostToolUseFailure",
      additionalContext: FAILURE_CONTEXT,
    },
  });
  const verified = responseFor({
    hook_event_name: "PostToolUse",
    tool_name: "Bash",
    tool_input: { command: "npm run check PRIVATE_COMMAND_CANARY" },
    tool_response: "PRIVATE_OUTPUT_CANARY",
  });
  assert.deepEqual(verified, {
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: VERIFICATION_CONTEXT,
    },
  });
  assert.doesNotMatch(JSON.stringify(verified), /PRIVATE_/u);
  assert.deepEqual(
    responseFor({
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      tool_input: { command: "echo not-a-check" },
    }),
    {},
  );
  assert.deepEqual(responseFor(null), {});
});

test("verification command recognition is narrow and bounded", () => {
  for (const command of [
    "npm test",
    "npm run typecheck",
    "pnpm lint",
    "yarn run build",
    "node --test test/runtime.g005.test.mjs",
    "pytest -q",
    "cargo test",
    "go test ./...",
  ]) {
    assert.equal(isVerificationCommand(command), true, command);
  }
  for (const command of ["echo test", "npm install", "node app.mjs", null]) {
    assert.equal(isVerificationCommand(command), false, String(command));
  }
});

test("event envelope excludes raw and identifying fields", () => {
  const input = {
    hook_event_name: "PostToolUseFailure",
    session_id: "PRIVATE_SESSION_CANARY",
    cwd: "/private/PRIVATE_PATH_CANARY",
    tool_name: "Bash",
    tool_input: { command: "PRIVATE_TOOL_INPUT_CANARY" },
    error: "PRIVATE_ERROR_CANARY",
  };

  assert.deepEqual(eventEnvelope(input, "2026-07-18T00:00:00.000Z"), {
    schemaVersion: 1,
    timestamp: "2026-07-18T00:00:00.000Z",
    event: "PostToolUseFailure",
    phase: "g005-intervention-learning-boundary",
  });
  assert.equal(
    eventEnvelope(
      { hook_event_name: "PRIVATE_EVENT_CANARY" },
      "2026-07-18T00:00:00.000Z",
    ).event,
    "Unknown",
  );
});

test("SessionStart reports only the count of optional due reviews", async (context) => {
  const dataDir = await mkdtemp(join(tmpdir(), "fairytail-due-hook-"));
  context.after(() => rm(dataDir, { recursive: true, force: true }));
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
      score: 8,
      fatal_misconception: false,
    },
  });

  const result = await handleHook(
    { hook_event_name: "SessionStart", prompt: "PRIVATE_PROMPT_CANARY" },
    {
      dataDir,
      now: () => new Date("2026-07-18T00:25:00.000Z"),
    },
  );
  const serialized = JSON.stringify(result.response);
  assert.match(serialized, /1 optional delayed Fairytail review is due/u);
  assert.doesNotMatch(serialized, /api-request-response|S04|PRIVATE_/u);
});

test("handler persists only the sanitized envelope", async (context) => {
  const dataDir = await mkdtemp(join(tmpdir(), "fairytail-unit-"));
  context.after(() => rm(dataDir, { recursive: true, force: true }));

  const input = {
    hook_event_name: "SessionStart",
    session_id: "PRIVATE_SESSION_CANARY",
    cwd: "/private/PRIVATE_PATH_CANARY",
  };
  const result = await handleHook(input, {
    dataDir,
    now: () => new Date("2026-07-18T00:00:00.000Z"),
  });

  assert.equal(result.persistence.ok, true);
  const log = await readFile(join(dataDir, EVENT_LOG_FILE), "utf8");
  assert.match(log, /SessionStart/);
  assert.doesNotMatch(log, /PRIVATE_/);
});

test("logging failure is non-blocking and does not echo the failing path", async (context) => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "fairytail-failure-"));
  context.after(() => rm(fixtureRoot, { recursive: true, force: true }));
  const filePath = join(fixtureRoot, "not-a-directory");
  await writeFile(filePath, "occupied");

  const result = await handleHook(
    { hook_event_name: "SessionStart", prompt: "PRIVATE_PROMPT_CANARY" },
    { dataDir: filePath },
  );

  assert.deepEqual(result.persistence, { ok: false, reason: "write-failed" });
  assert.deepEqual(result.response, {
    systemMessage:
      "Fairytail compatibility logging is unavailable; no prompt, profile, tool input, output, or error was stored.",
  });
  const serialized = JSON.stringify(result.response);
  assert.doesNotMatch(serialized, /PRIVATE_PROMPT_CANARY|not-a-directory/);
});
