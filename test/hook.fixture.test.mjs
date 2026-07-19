import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const hookScript = join(root, "scripts", "fairytail-hook.mjs");

test("SessionStart fixture stays model-silent without leaking canaries", async (context) => {
  const dataDir = await mkdtemp(join(tmpdir(), "fairytail-fixture-"));
  context.after(() => rm(dataDir, { recursive: true, force: true }));
  const fixture = await readFile(
    join(root, "fixtures", "hooks", "session-start.json"),
    "utf8",
  );

  const result = await runNode(hookScript, fixture, dataDir);
  assert.equal(result.code, 0);
  assert.deepEqual(JSON.parse(result.stdout), {});

  const combined = `${result.stdout}\n${result.stderr}\n${await readFile(
    join(dataDir, "events.jsonl"),
    "utf8",
  )}`;
  assert.doesNotMatch(combined, /PRIVATE_SESSION_CANARY|PRIVATE_PATH_CANARY/);
});

test("failure fixture adds a generic recovery cue but never copies failure content", async (context) => {
  const dataDir = await mkdtemp(join(tmpdir(), "fairytail-fixture-"));
  context.after(() => rm(dataDir, { recursive: true, force: true }));
  const fixture = await readFile(
    join(root, "fixtures", "hooks", "post-tool-failure.json"),
    "utf8",
  );

  const result = await runNode(hookScript, fixture, dataDir);
  assert.equal(result.code, 0);
  const response = JSON.parse(result.stdout);
  assert.equal(response.hookSpecificOutput.hookEventName, "PostToolUseFailure");
  assert.match(response.hookSpecificOutput.additionalContext, /Stabilize/u);
  const log = await readFile(join(dataDir, "events.jsonl"), "utf8");
  assert.doesNotMatch(`${result.stdout}\n${log}`, /PRIVATE_/u);
});

test("verification fixture adds only a generic finish cue", async (context) => {
  const dataDir = await mkdtemp(join(tmpdir(), "fairytail-fixture-"));
  context.after(() => rm(dataDir, { recursive: true, force: true }));
  const fixture = await readFile(
    join(root, "fixtures", "hooks", "post-tool-verification.json"),
    "utf8",
  );

  const result = await runNode(hookScript, fixture, dataDir);
  assert.equal(result.code, 0);
  const response = JSON.parse(result.stdout);
  assert.equal(response.hookSpecificOutput.hookEventName, "PostToolUse");
  assert.match(response.hookSpecificOutput.additionalContext, /finish/u);
  const log = await readFile(join(dataDir, "events.jsonl"), "utf8");
  assert.doesNotMatch(`${result.stdout}\n${log}`, /PRIVATE_/u);
});

test("malformed JSON fails open without persistence", async (context) => {
  const dataDir = await mkdtemp(join(tmpdir(), "fairytail-fixture-"));
  context.after(() => rm(dataDir, { recursive: true, force: true }));
  const fixture = await readFile(
    join(root, "fixtures", "hooks", "malformed.json"),
    "utf8",
  );

  const result = await runNode(hookScript, fixture, dataDir);
  assert.equal(result.code, 0);
  assert.equal(JSON.parse(result.stdout).continue, true);
  await assert.rejects(readFile(join(dataDir, "events.jsonl"), "utf8"));
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /hook_event_name/);
});

/**
 * @param {string} script
 * @param {string} input
 * @param {string} dataDir
 */
function runNode(script, input, dataDir) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, "--data-dir", dataDir]);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(input);
  });
}
