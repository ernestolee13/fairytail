import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  assessPreToolUse,
  preToolUseResponse,
} from "../src/safety/pretool.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const fixture = JSON.parse(
  await readFile(join(root, "fixtures", "g006", "pretool-cases.json"), "utf8"),
);

test("all hostile fixtures deny before side effects with stable reason codes", () => {
  assert.ok(fixture.hostile.length >= 8);
  for (const item of fixture.hostile) {
    const assessment = assessPreToolUse(item.event);
    const response = preToolUseResponse(assessment);
    assert.equal(assessment.risk, "red", item.id);
    assert.equal(assessment.decision, "deny", item.id);
    assert.equal(assessment.reason_code, item.expected_reason_code, item.id);
    assert.equal(assessment.execution_authorized, false, item.id);
    assert.equal(assessment.requirements.manual_action_only, true, item.id);
    const hookOutput = response.hookSpecificOutput;
    assert.ok(hookOutput, item.id);
    assert.equal(hookOutput.permissionDecision, "deny", item.id);
    assert.match(
      hookOutput.permissionDecisionReason,
      new RegExp(item.expected_reason_code, "u"),
      item.id,
    );
    assert.notEqual(assessment.target.display, "", item.id);
    assert.match(assessment.target.fingerprint, /^sha256:[a-f0-9]{16}$/u);
    assert.notEqual(assessment.recovery.precondition, "", item.id);
    assert.notEqual(assessment.recovery.rollback, "", item.id);
  }
});

test("yellow fixtures force a scoped host approval without returning allow", () => {
  for (const item of fixture.yellow) {
    const assessment = assessPreToolUse(item.event);
    const response = preToolUseResponse(assessment);
    assert.equal(assessment.risk, "yellow", item.id);
    assert.equal(assessment.decision, "ask", item.id);
    assert.equal(assessment.reason_code, item.expected_reason_code, item.id);
    const hookOutput = response.hookSpecificOutput;
    assert.ok(hookOutput, item.id);
    assert.equal(hookOutput.permissionDecision, "ask", item.id);
    assert.doesNotMatch(JSON.stringify(response), /"allow"/u, item.id);
  }
});

test("read-only and single-file edit fixtures defer to host policy", () => {
  for (const item of fixture.safe) {
    const assessment = assessPreToolUse(item.event);
    assert.equal(assessment.decision, "defer", item.id);
    assert.notEqual(assessment.risk, "red", item.id);
    assert.notEqual(assessment.risk, "yellow", item.id);
    assert.deepEqual(preToolUseResponse(assessment), {}, item.id);
  }
});

test("raw secrets, personal data, commands, and outside paths never enter decisions", () => {
  for (const item of fixture.hostile) {
    const serialized = JSON.stringify({
      assessment: assessPreToolUse(item.event),
      response: preToolUseResponse(assessPreToolUse(item.event)),
    });
    assert.doesNotMatch(
      serialized,
      /PRIVATE_SECRET_CANARY|PRIVATE_PERSON@example|\/tmp\/PRIVATE_PERSON|DROP TABLE users|rm -rf/u,
      item.id,
    );
  }
});

test("malformed and unknown Fairytail automation fail closed while unknown host tools defer", () => {
  for (const input of [
    null,
    {},
    { hook_event_name: "PreToolUse", cwd: "/workspace", tool_name: "Bash" },
    {
      hook_event_name: "PreToolUse",
      cwd: "/workspace",
      tool_name: "Bash",
      tool_input: { command: null },
    },
    {
      hook_event_name: "PreToolUse",
      cwd: "/workspace",
      tool_name: "Write",
      tool_input: { content: "missing target" },
    },
    {
      hook_event_name: "PreToolUse",
      cwd: "/workspace",
      tool_name: "mcp__fairytail__unknown_action",
      tool_input: {},
    },
  ]) {
    const assessment = assessPreToolUse(input);
    assert.equal(assessment.decision, "deny");
    assert.equal(assessment.reason_code, "FTG-RED-UNCLASSIFIED_AUTOMATION");
  }

  const host = assessPreToolUse({
    hook_event_name: "PreToolUse",
    cwd: "/workspace",
    tool_name: "Agent",
    tool_input: { description: "host-owned action" },
  });
  assert.equal(host.risk, "unknown");
  assert.equal(host.decision, "defer");
  assert.deepEqual(preToolUseResponse(host), {});
});
