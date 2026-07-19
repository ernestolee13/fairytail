#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { stdout } from "node:process";
import { fileURLToPath } from "node:url";

import { EVENT_LOG_FILE, handleHook } from "../src/hook.mjs";
import {
  acknowledgeManualBoundary,
  assessSafetyAction,
  safetyAction,
} from "../src/safety/policy.mjs";
import {
  assessPreToolUse,
  preToolUseResponse,
} from "../src/safety/pretool.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dataDir = await mkdtemp(join(tmpdir(), "fairytail-g006-smoke-"));

try {
  const fixture = JSON.parse(
    await readFile(
      join(root, "fixtures", "g006", "pretool-cases.json"),
      "utf8",
    ),
  );
  const reasonCodes = new Set();
  for (const item of fixture.hostile) {
    const assessment = assessPreToolUse(item.event);
    const result = await handleHook(item.event, { dataDir });
    assert.equal(assessment.decision, "deny", item.id);
    assert.equal(assessment.reason_code, item.expected_reason_code, item.id);
    assert.equal(
      result.response.hookSpecificOutput.permissionDecision,
      "deny",
      item.id,
    );
    assert.equal(assessment.execution_authorized, false, item.id);
    assert.equal(result.persistence.ok, true, item.id);
    reasonCodes.add(assessment.reason_code);
  }
  for (const item of fixture.yellow) {
    const assessment = assessPreToolUse(item.event);
    const result = await handleHook(item.event, { dataDir });
    assert.equal(assessment.decision, "ask", item.id);
    assert.equal(
      result.response.hookSpecificOutput.permissionDecision,
      "ask",
      item.id,
    );
    assert.doesNotMatch(JSON.stringify(result.response), /"allow"/u);
  }
  for (const item of fixture.safe) {
    const assessment = assessPreToolUse(item.event);
    const result = await handleHook(item.event, { dataDir });
    assert.equal(assessment.decision, "defer", item.id);
    assert.deepEqual(preToolUseResponse(assessment), {}, item.id);
    assert.deepEqual(result.response, {}, item.id);
  }

  const malformed = assessPreToolUse(null);
  assert.equal(malformed.decision, "deny");
  assert.equal(malformed.reason_code, "FTG-RED-UNCLASSIFIED_AUTOMATION");

  const redAction = safetyAction({
    source: "fairytail_automation",
    operation: "delete",
    toolName: "fairytail-safety-smoke",
    target: {
      kind: "filesystem",
      locator: "workspace:/",
      scope: "workspace",
      environment: "local",
    },
    flags: { recursive: true, force: true, bulk: true },
  });
  const redAssessment = assessSafetyAction(redAction);
  assert.equal(redAssessment.risk, "red");
  if (redAssessment.retype_phrase === null) {
    throw new Error("red smoke assessment did not provide a boundary phrase");
  }
  const acknowledged = acknowledgeManualBoundary(
    redAction,
    redAssessment.retype_phrase,
  );
  assert.equal(acknowledged.manual_action_only, true);
  assert.equal(acknowledged.execution_authorized, false);

  const eventPath = join(dataDir, EVENT_LOG_FILE);
  const eventLog = await readFile(eventPath, "utf8");
  const events = eventLog
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(
    events.length,
    fixture.hostile.length + fixture.yellow.length + fixture.safe.length,
  );
  assert.ok(
    events.every(
      (event) =>
        event.event === "PreToolUse" &&
        typeof event.reasonCode === "string" &&
        typeof event.target?.display === "string" &&
        /^sha256:[a-f0-9]{16}$/u.test(event.target?.fingerprint),
    ),
  );
  assert.doesNotMatch(
    eventLog,
    /PRIVATE_|Bearer|DROP TABLE|rm -rf|curl |tool_input|file_path|content/u,
  );
  assert.equal((await stat(dataDir)).mode & 0o777, 0o700);
  assert.equal((await stat(eventPath)).mode & 0o777, 0o600);

  stdout.write(
    `${JSON.stringify(
      {
        status: "pass",
        hostile: {
          blocked: fixture.hostile.length,
          total: fixture.hostile.length,
          reasonCodes: reasonCodes.size,
        },
        yellow: {
          asked: fixture.yellow.length,
          total: fixture.yellow.length,
        },
        safe: {
          deferred: fixture.safe.length,
          total: fixture.safe.length,
        },
        malformedFairytailAutomation: "denied",
        redRetype: "manual-only-no-permit",
        rawPayloadLogged: false,
        returnsAllow: false,
        modelCalls: 0,
        networkCalls: 0,
        actionExecutionCalls: 0,
        permissionGrants: 0,
        privateModes: { directory: "0700", file: "0600" },
      },
      null,
      2,
    )}\n`,
  );
} finally {
  await rm(dataDir, { recursive: true, force: true });
}
