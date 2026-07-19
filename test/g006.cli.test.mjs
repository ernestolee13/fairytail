import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { safetyAction } from "../src/safety/policy.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const script = join(root, "scripts", "fairytail-safety.mjs");

test("CLI assesses and acknowledges a red boundary without granting execution", async (context) => {
  const temp = await mkdtemp(join(tmpdir(), "fairytail-g006-cli-"));
  context.after(() => rm(temp, { recursive: true, force: true }));
  const path = join(temp, "action.json");
  await writeFile(
    path,
    JSON.stringify(
      safetyAction({
        source: "fairytail_automation",
        operation: "delete",
        toolName: "fairytail-safety-test",
        target: {
          kind: "filesystem",
          locator: "workspace:/",
          scope: "workspace",
          environment: "local",
        },
        flags: { recursive: true, force: true, bulk: true },
      }),
    ),
  );

  const assessed = await run(["assess", "--input", path]);
  assert.equal(assessed.code, 0);
  const output = JSON.parse(assessed.stdout);
  assert.equal(output.assessment.decision, "deny");
  assert.equal(output.effects.action_execution_calls, 0);
  assert.equal(output.effects.permission_grants, 0);

  const acknowledged = await run([
    "acknowledge",
    "--input",
    path,
    "--retype",
    output.assessment.retype_phrase,
  ]);
  assert.equal(acknowledged.code, 0);
  const result = JSON.parse(acknowledged.stdout);
  assert.equal(result.acknowledgement.manual_action_only, true);
  assert.equal(result.acknowledgement.execution_authorized, false);
  assert.equal(result.effects.action_execution_calls, 0);

  const wrong = await run([
    "acknowledge",
    "--input",
    path,
    "--retype",
    "RETYPE WRONG",
  ]);
  assert.equal(wrong.code, 1);
  assert.deepEqual(JSON.parse(wrong.stdout), {
    status: "error",
    code: "g006-safety-operation-failed",
  });
  assert.doesNotMatch(wrong.stdout, /workspace|delete|WRONG/u);
});

test("hook diagnostic CLI returns only a sanitized event assessment", async (context) => {
  const temp = await mkdtemp(join(tmpdir(), "fairytail-g006-cli-"));
  context.after(() => rm(temp, { recursive: true, force: true }));
  const path = join(temp, "event.json");
  const fixture = JSON.parse(
    await readFile(
      join(root, "fixtures", "g006", "pretool-cases.json"),
      "utf8",
    ),
  );
  const hostile = fixture.hostile.find(
    (/** @type {Record<string, any>} */ item) =>
      item.id === "H08-profile-transmission",
  );
  await writeFile(path, JSON.stringify(hostile.event));

  const result = await run(["hook", "--input", path]);
  assert.equal(result.code, 0);
  const output = JSON.parse(result.stdout);
  assert.equal(output.assessment.decision, "deny");
  assert.equal(output.raw_event_included, false);
  assert.equal(output.effects.network_calls, 0);
  assert.doesNotMatch(
    result.stdout,
    /PRIVATE_PERSON@example|profile_data=hospital|curl -X POST/u,
  );
});

/** @param {string[]} args */
function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args]);
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
  });
}
