import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { EVENT_LOG_FILE, handleHook } from "../src/hook.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const hookScript = join(root, "scripts", "fairytail-hook.mjs");
const cases = JSON.parse(
  await readFile(join(root, "fixtures", "g006", "pretool-cases.json"), "utf8"),
);

test("PreToolUse denies before execution and logs only reason code plus sanitized target", async (context) => {
  const dataDir = await mkdtemp(join(tmpdir(), "fairytail-g006-hook-"));
  context.after(() => rm(dataDir, { recursive: true, force: true }));
  const hostile = cases.hostile.find(
    (/** @type {Record<string, any>} */ item) =>
      item.id === "H11-mcp-secret-message",
  );
  const result = await handleHook(hostile.event, {
    dataDir,
    now: () => new Date("2026-07-18T00:00:00.000Z"),
  });

  assert.equal(result.response.hookSpecificOutput.permissionDecision, "deny");
  assert.equal(result.record.event, "PreToolUse");
  assert.equal(result.record.reasonCode, "FTG-RED-CREDENTIAL_EXPOSURE");
  assert.equal(result.record.sideEffect, "credential_disclosure");
  assert.match(result.record.target.fingerprint, /^sha256:[a-f0-9]{16}$/u);
  assert.equal(result.persistence.ok, true);

  const path = join(dataDir, EVENT_LOG_FILE);
  const body = await readFile(path, "utf8");
  assert.doesNotMatch(
    `${JSON.stringify(result.response)}\n${body}`,
    /PRIVATE_SECRET_CANARY|Bearer|authorization|ship/u,
  );
  assert.equal((await stat(dataDir)).mode & 0o777, 0o700);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
});

test("safe and yellow decisions remain auditable without returning allow", async (context) => {
  const dataDir = await mkdtemp(join(tmpdir(), "fairytail-g006-hook-"));
  context.after(() => rm(dataDir, { recursive: true, force: true }));
  const safe = await handleHook(cases.safe[0].event, { dataDir });
  const yellow = await handleHook(cases.yellow[0].event, { dataDir });

  assert.deepEqual(safe.response, {});
  assert.equal(safe.record.reasonCode, "FTG-GREEN-READ_ONLY");
  assert.equal(yellow.response.hookSpecificOutput.permissionDecision, "ask");
  assert.doesNotMatch(JSON.stringify(yellow.response), /"allow"/u);
  const lines = (await readFile(join(dataDir, EVENT_LOG_FILE), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(lines.length, 2);
  assert.deepEqual(
    lines.map((line) => line.decision),
    ["defer", "ask"],
  );
});

test("logging failure never weakens a red deny", async (context) => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "fairytail-g006-log-"));
  context.after(() => rm(fixtureRoot, { recursive: true, force: true }));
  const occupied = join(fixtureRoot, "occupied");
  await writeFile(occupied, "not a directory");

  const result = await handleHook(cases.hostile[0].event, {
    dataDir: occupied,
  });
  assert.equal(result.persistence.ok, false);
  assert.equal(result.response.hookSpecificOutput.permissionDecision, "deny");
  assert.match(result.response.systemMessage, /logging is unavailable/u);
});

test("malformed configured PreToolUse input fails closed with generic output", async () => {
  const malformed = await runHook("{not-json", "PreToolUse");
  assert.equal(malformed.code, 0);
  const response = JSON.parse(malformed.stdout);
  assert.equal(response.hookSpecificOutput.hookEventName, "PreToolUse");
  assert.equal(response.hookSpecificOutput.permissionDecision, "deny");
  assert.match(
    response.hookSpecificOutput.permissionDecisionReason,
    /FTG-RED-UNCLASSIFIED_AUTOMATION/u,
  );
  assert.doesNotMatch(
    `${malformed.stdout}\n${malformed.stderr}`,
    /not-json|hook_event_name/u,
  );

  const mismatch = await runHook(
    JSON.stringify({ hook_event_name: "SessionStart" }),
    "PreToolUse",
  );
  assert.equal(
    JSON.parse(mismatch.stdout).hookSpecificOutput.permissionDecision,
    "deny",
  );
});

/** @param {string} input @param {string} expectedEvent */
function runHook(input, expectedEvent) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      hookScript,
      "--expected-event",
      expectedEvent,
    ]);
    let commandStdout = "";
    let commandStderr = "";
    child.stdout.on("data", (chunk) => {
      commandStdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      commandStderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) =>
      resolve({ code, stdout: commandStdout, stderr: commandStderr }),
    );
    child.stdin.end(input);
  });
}
