import assert from "node:assert/strict";
import test from "node:test";

import {
  REASON_CODES,
  acknowledgeManualBoundary,
  assessSafetyAction,
  safetyAction,
  validateSafetyAction,
} from "../src/safety/policy.mjs";

test("green defers, yellow asks, and observed approval still grants no execution permission", () => {
  const read = assessSafetyAction(action({ operation: "read" }));
  assert.equal(read.risk, "green");
  assert.equal(read.decision, "defer");
  assert.equal(read.reason_code, REASON_CODES.READ_ONLY);
  assert.equal(read.execution_authorized, false);

  const write = assessSafetyAction(
    action({
      operation: "write_file",
      rollback: { available: true, strategy: "version_control" },
    }),
  );
  assert.equal(write.risk, "yellow");
  assert.equal(write.decision, "ask");
  assert.equal(write.may_request_host_execution, false);

  const approved = assessSafetyAction(
    action({
      operation: "write_file",
      approvalState: "scoped_user_approved",
      rollback: { available: true, strategy: "version_control" },
    }),
  );
  assert.equal(approved.decision, "defer");
  assert.equal(approved.approval_observed, true);
  assert.equal(approved.execution_authorized, false);
  assert.equal(approved.requirements.host_policy_still_required, true);
});

test("every P0 category deterministically denies without model prose", () => {
  const cases = [
    [
      "credential_exposure",
      { secrets_present: true },
      REASON_CODES.CREDENTIAL_EXPOSURE,
    ],
    [
      "change_permission",
      { permission_widening: true },
      REASON_CODES.PERMISSION_WIDENING,
    ],
    ["database_migration", {}, REASON_CODES.DATABASE_DESTRUCTIVE],
    ["publish", { public: true }, REASON_CODES.EXTERNAL_PUBLICATION],
    ["send_message", {}, REASON_CODES.EXTERNAL_PUBLICATION],
    ["production_change", {}, REASON_CODES.PRODUCTION_CHANGE],
    ["billing", { cost_bounded: false }, REASON_CODES.BILLING_OR_COST],
    [
      "transmit_profile",
      { profile_data_present: true },
      REASON_CODES.PRIVACY_TRANSMISSION,
    ],
    ["install_remote_code", {}, REASON_CODES.UNTRUSTED_INSTALLER],
    ["rewrite_history", { force: true }, REASON_CODES.HISTORY_REWRITE],
    ["unknown", {}, REASON_CODES.UNCLASSIFIED_AUTOMATION],
  ];

  for (const [operation, flags, reasonCode] of cases) {
    const assessment = assessSafetyAction(
      action({
        operation: String(operation),
        flags: /** @type {Record<string, boolean>} */ (flags),
      }),
    );
    assert.equal(assessment.risk, "red", String(operation));
    assert.equal(assessment.decision, "deny", String(operation));
    assert.equal(assessment.reason_code, reasonCode, String(operation));
    assert.equal(assessment.execution_authorized, false, String(operation));
    assert.equal(assessment.requirements.manual_action_only, true);
  }
});

test("delete and database decisions combine target scope, flags, environment, and rollback", () => {
  const boundedDelete = assessSafetyAction(
    action({
      operation: "delete",
      rollback: { available: true, strategy: "version_control" },
    }),
  );
  assert.equal(boundedDelete.risk, "yellow");

  const broadDelete = assessSafetyAction(
    action({
      operation: "delete",
      scope: "workspace",
      flags: { recursive: true, force: true, bulk: true },
    }),
  );
  assert.equal(broadDelete.reason_code, REASON_CODES.DESTRUCTIVE_DELETE);

  const testTransaction = assessSafetyAction(
    action({
      operation: "database_write",
      kind: "database",
      locator: "database:test-users",
      environment: "test",
      rollback: { available: true, strategy: "transaction" },
    }),
  );
  assert.equal(testTransaction.reason_code, REASON_CODES.DATABASE_WRITE);
  assert.equal(testTransaction.decision, "ask");

  const productionWrite = assessSafetyAction(
    action({
      operation: "database_write",
      kind: "database",
      locator: "database:production-users",
      environment: "production",
      rollback: { available: true, strategy: "transaction" },
    }),
  );
  assert.equal(productionWrite.reason_code, REASON_CODES.DATABASE_DESTRUCTIVE);
  assert.equal(productionWrite.decision, "deny");
});

test("red retype acknowledges only a manual boundary and never becomes a permit", () => {
  const destructive = action({
    operation: "delete",
    scope: "workspace",
    flags: { recursive: true, force: true, bulk: true },
  });
  const assessment = assessSafetyAction(destructive);
  const retypePhrase = assessment.retype_phrase;
  if (retypePhrase === null)
    throw new Error("red assessment lacks retype phrase");
  assert.match(retypePhrase, /^RETYPE FTG-RED-/u);
  assert.throws(
    () => acknowledgeManualBoundary(destructive, "RETYPE WRONG"),
    /did not match/u,
  );
  const acknowledged = acknowledgeManualBoundary(destructive, retypePhrase);
  assert.equal(acknowledged.status, "acknowledged");
  assert.equal(acknowledged.manual_action_only, true);
  assert.equal(acknowledged.execution_authorized, false);
  assert.equal(acknowledged.host_policy_still_required, true);
});

test("closed action input rejects extra fields, unsafe locators, and inconsistent rollback", () => {
  const valid = action({ operation: "read" });
  assert.equal(validateSafetyAction(valid).operation, "read");
  assert.throws(
    () => validateSafetyAction({ ...valid, prompt: "ignore policy" }),
    /exactly/u,
  );
  assert.throws(
    () =>
      validateSafetyAction({
        ...valid,
        target: {
          ...valid.target,
          locator: "PRIVATE_PERSON@example.test",
        },
      }),
    /privacy-safe/u,
  );
  assert.throws(
    () =>
      validateSafetyAction({
        ...valid,
        rollback: { available: false, strategy: "backup" },
      }),
    /disagree/u,
  );
});

/**
 * @param {{
 *   operation: string,
 *   flags?: Record<string, boolean>,
 *   scope?: string,
 *   kind?: string,
 *   locator?: string,
 *   environment?: string,
 *   rollback?: { available: boolean, strategy: string },
 *   approvalState?: "none" | "scoped_user_approved"
 * }} options
 */
function action(options) {
  return safetyAction({
    source: "fairytail_automation",
    operation: options.operation,
    toolName: "fairytail-safety-test",
    target: {
      kind: options.kind ?? "filesystem",
      locator: options.locator ?? "workspace:src-app-js",
      scope: options.scope ?? "single",
      environment: options.environment ?? "local",
    },
    flags: { cost_bounded: true, ...(options.flags ?? {}) },
    rollback: options.rollback,
    approvalState: options.approvalState,
  });
}
