import { createHash, timingSafeEqual } from "node:crypto";

import { sensitiveReason } from "../profile/sanitize.mjs";

export const SAFETY_SCHEMA_VERSION = 1;

export const REASON_CODES = Object.freeze({
  READ_ONLY: "FTG-GREEN-READ_ONLY",
  WORKSPACE_WRITE: "FTG-YELLOW-WORKSPACE_WRITE",
  DEPENDENCY_INSTALL: "FTG-YELLOW-DEPENDENCY_INSTALL",
  DATABASE_WRITE: "FTG-YELLOW-DATABASE_WRITE",
  SCOPED_PERMISSION: "FTG-YELLOW-SCOPED_PERMISSION",
  UNCLASSIFIED_AUTOMATION: "FTG-RED-UNCLASSIFIED_AUTOMATION",
  DESTRUCTIVE_DELETE: "FTG-RED-DESTRUCTIVE_DELETE",
  OUTSIDE_WORKSPACE_WRITE: "FTG-RED-OUTSIDE_WORKSPACE_WRITE",
  CREDENTIAL_EXPOSURE: "FTG-RED-CREDENTIAL_EXPOSURE",
  PERMISSION_WIDENING: "FTG-RED-PERMISSION_WIDENING",
  DATABASE_DESTRUCTIVE: "FTG-RED-DATABASE_DESTRUCTIVE",
  EXTERNAL_PUBLICATION: "FTG-RED-EXTERNAL_PUBLICATION",
  PRODUCTION_CHANGE: "FTG-RED-PRODUCTION_CHANGE",
  BILLING_OR_COST: "FTG-RED-BILLING_OR_COST",
  PRIVACY_TRANSMISSION: "FTG-RED-PRIVACY_TRANSMISSION",
  UNTRUSTED_INSTALLER: "FTG-RED-UNTRUSTED_INSTALLER",
  HISTORY_REWRITE: "FTG-RED-HISTORY_REWRITE",
  HOST_DEFER: "FTG-HOST-DEFER_UNCLASSIFIED",
});

const ACTION_KEYS = [
  "schema_version",
  "source",
  "operation",
  "tool_name",
  "target",
  "flags",
  "rollback",
  "approval_state",
];
const TARGET_KEYS = ["kind", "locator", "scope", "environment"];
const FLAG_KEYS = [
  "recursive",
  "force",
  "bulk",
  "public",
  "permission_widening",
  "secrets_present",
  "personal_data_present",
  "profile_data_present",
  "consent_recorded",
  "cost_bounded",
];
const ROLLBACK_KEYS = ["available", "strategy"];
const SOURCES = new Set(["fairytail_automation", "host_tool_review"]);
const OPERATIONS = new Set([
  "read",
  "write_file",
  "install_dependency",
  "delete",
  "credential_exposure",
  "change_permission",
  "database_read",
  "database_write",
  "database_migration",
  "publish",
  "send_message",
  "production_change",
  "billing",
  "transmit_profile",
  "install_remote_code",
  "rewrite_history",
  "unknown",
]);
const TARGET_KINDS = new Set([
  "filesystem",
  "database",
  "repository",
  "service",
  "account",
  "channel",
  "billing",
  "profile",
  "network",
  "tool",
  "unknown",
]);
const TARGET_SCOPES = new Set([
  "single",
  "batch",
  "workspace",
  "outside_workspace",
  "home",
  "root",
  "global",
  "unknown",
]);
const ENVIRONMENTS = new Set([
  "local",
  "test",
  "staging",
  "production",
  "external",
  "unknown",
]);
const APPROVAL_STATES = new Set(["none", "scoped_user_approved"]);
const ROLLBACK_STRATEGIES = new Set([
  "none",
  "version_control",
  "backup",
  "transaction",
  "provider_undo",
  "manual",
]);
const TOOL_PATTERN = /^[A-Za-z0-9_.:-]{1,120}$/u;
const LOCATOR_PATTERN = /^[\p{L}\p{M}\p{N} ._:/#()+-]{1,160}$/u;
const BROAD_SCOPES = new Set([
  "workspace",
  "outside_workspace",
  "home",
  "root",
  "global",
  "unknown",
]);

/**
 * Validate the closed, prose-free safety descriptor. The descriptor can name
 * a target, but it cannot carry a raw command, secret, URL, email, or profile.
 *
 * @param {unknown} value
 */
export function validateSafetyAction(value) {
  const action = structuredClone(plainRecord(value, "safety action"));
  exactKeys(action, ACTION_KEYS, "safety action");
  if (action.schema_version !== SAFETY_SCHEMA_VERSION) {
    throw new TypeError("unsupported safety action schema version");
  }
  if (!SOURCES.has(action.source)) {
    throw new TypeError("safety action source is invalid");
  }
  if (!OPERATIONS.has(action.operation)) {
    throw new TypeError("safety action operation is invalid");
  }
  if (
    typeof action.tool_name !== "string" ||
    !TOOL_PATTERN.test(action.tool_name)
  ) {
    throw new TypeError("safety action tool_name is invalid");
  }

  const target = plainRecord(action.target, "safety action target");
  exactKeys(target, TARGET_KEYS, "safety action target");
  if (!TARGET_KINDS.has(target.kind)) {
    throw new TypeError("safety target kind is invalid");
  }
  if (
    typeof target.locator !== "string" ||
    target.locator !== target.locator.normalize("NFC") ||
    !LOCATOR_PATTERN.test(target.locator) ||
    sensitiveReason(target.locator)
  ) {
    throw new TypeError("safety target locator is not privacy-safe");
  }
  if (!TARGET_SCOPES.has(target.scope)) {
    throw new TypeError("safety target scope is invalid");
  }
  if (!ENVIRONMENTS.has(target.environment)) {
    throw new TypeError("safety target environment is invalid");
  }

  const flags = plainRecord(action.flags, "safety action flags");
  exactKeys(flags, FLAG_KEYS, "safety action flags");
  for (const key of FLAG_KEYS) {
    if (typeof flags[key] !== "boolean") {
      throw new TypeError(`safety action flag ${key} must be boolean`);
    }
  }

  const rollback = plainRecord(action.rollback, "safety action rollback");
  exactKeys(rollback, ROLLBACK_KEYS, "safety action rollback");
  if (typeof rollback.available !== "boolean") {
    throw new TypeError("safety rollback available must be boolean");
  }
  if (!ROLLBACK_STRATEGIES.has(rollback.strategy)) {
    throw new TypeError("safety rollback strategy is invalid");
  }
  if (rollback.available === (rollback.strategy === "none")) {
    throw new TypeError("safety rollback availability and strategy disagree");
  }
  if (!APPROVAL_STATES.has(action.approval_state)) {
    throw new TypeError("safety approval state is invalid");
  }
  return deepFreeze(action);
}

/**
 * Classify an action only from the closed descriptor. Model prose never enters
 * this decision. Fairytail never grants execution permission: green/yellow
 * results still defer to the host, and red results remain manual-only.
 *
 * @param {unknown} value
 */
export function assessSafetyAction(value) {
  const action = validateSafetyAction(value);
  const outcome = classify(action);
  const target = {
    display: action.target.locator,
    fingerprint: fingerprint(action.target.locator),
    kind: action.target.kind,
    scope: action.target.scope,
    environment: action.target.environment,
  };
  const actionFingerprint = fingerprint(
    JSON.stringify({
      operation: action.operation,
      tool_name: action.tool_name,
      target: target.fingerprint,
      flags: action.flags,
      rollback: action.rollback,
    }),
  );
  const userApprovalObserved = action.approval_state === "scoped_user_approved";
  const decision =
    outcome.risk === "red"
      ? "deny"
      : outcome.risk === "yellow" && !userApprovalObserved
        ? "ask"
        : "defer";
  const retypePhrase =
    outcome.risk === "red"
      ? `RETYPE ${outcome.reasonCode} ${actionFingerprint.slice(7)}`
      : null;
  return deepFreeze({
    schema_version: SAFETY_SCHEMA_VERSION,
    risk: outcome.risk,
    decision,
    reason_code: outcome.reasonCode,
    target,
    side_effect: sideEffect(action.operation),
    action_fingerprint: actionFingerprint,
    approval_observed: userApprovalObserved,
    requirements: {
      host_policy_still_required: true,
      scoped_user_approval: outcome.risk === "yellow" && !userApprovalObserved,
      user_retype: outcome.risk === "red",
      manual_action_only: outcome.risk === "red",
    },
    recovery: recoveryFor(outcome.reasonCode),
    retype_phrase: retypePhrase,
    execution_authorized: false,
    may_request_host_execution:
      outcome.risk === "green" ||
      (outcome.risk === "yellow" && userApprovalObserved),
  });
}

/**
 * Verify that a human saw and retyped a red boundary. This acknowledgement is
 * deliberately incapable of becoming an automation permit.
 *
 * @param {unknown} value
 * @param {unknown} retyped
 */
export function acknowledgeManualBoundary(value, retyped) {
  const assessment = assessSafetyAction(value);
  if (assessment.risk !== "red" || assessment.retype_phrase === null) {
    throw new TypeError("manual acknowledgement applies only to red actions");
  }
  if (
    typeof retyped !== "string" ||
    !sameText(retyped, assessment.retype_phrase)
  ) {
    throw new TypeError("manual boundary retype did not match");
  }
  return deepFreeze({
    schema_version: SAFETY_SCHEMA_VERSION,
    status: "acknowledged",
    reason_code: assessment.reason_code,
    target: assessment.target,
    manual_action_only: true,
    execution_authorized: false,
    host_policy_still_required: true,
    recovery: assessment.recovery,
  });
}

/**
 * Build a closed descriptor for internal adapters. Callers still pass through
 * validateSafetyAction and cannot introduce extra fields.
 *
 * @param {{
 *   source?: "fairytail_automation" | "host_tool_review",
 *   operation: string,
 *   toolName: string,
 *   target: { kind: string, locator: string, scope: string, environment: string },
 *   flags?: Partial<Record<(typeof FLAG_KEYS)[number], boolean>>,
 *   rollback?: { available: boolean, strategy: string },
 *   approvalState?: "none" | "scoped_user_approved"
 * }} input
 */
export function safetyAction(input) {
  const flags = Object.fromEntries(FLAG_KEYS.map((key) => [key, false]));
  Object.assign(flags, input.flags ?? {});
  return validateSafetyAction({
    schema_version: SAFETY_SCHEMA_VERSION,
    source: input.source ?? "host_tool_review",
    operation: input.operation,
    tool_name: input.toolName,
    target: input.target,
    flags,
    rollback: input.rollback ?? { available: false, strategy: "none" },
    approval_state: input.approvalState ?? "none",
  });
}

/** @param {ReturnType<typeof validateSafetyAction>} action */
function classify(action) {
  if (action.operation === "unknown") {
    return red(REASON_CODES.UNCLASSIFIED_AUTOMATION);
  }
  if (
    action.operation === "credential_exposure" ||
    action.flags.secrets_present
  ) {
    return red(REASON_CODES.CREDENTIAL_EXPOSURE);
  }
  if (
    action.operation === "transmit_profile" ||
    ((action.flags.personal_data_present ||
      action.flags.profile_data_present) &&
      (!action.flags.consent_recorded ||
        new Set(["external", "production", "unknown"]).has(
          action.target.environment,
        )))
  ) {
    return red(REASON_CODES.PRIVACY_TRANSMISSION);
  }
  if (action.operation === "install_remote_code") {
    return red(REASON_CODES.UNTRUSTED_INSTALLER);
  }
  if (
    action.flags.permission_widening ||
    (action.operation === "change_permission" &&
      BROAD_SCOPES.has(action.target.scope))
  ) {
    return red(REASON_CODES.PERMISSION_WIDENING);
  }
  if (action.operation === "delete") {
    if (
      action.flags.recursive ||
      action.flags.force ||
      action.flags.bulk ||
      BROAD_SCOPES.has(action.target.scope) ||
      !action.rollback.available
    ) {
      return red(REASON_CODES.DESTRUCTIVE_DELETE);
    }
    return yellow(REASON_CODES.WORKSPACE_WRITE);
  }
  if (action.operation === "rewrite_history") {
    return red(REASON_CODES.HISTORY_REWRITE);
  }
  if (action.operation === "database_migration") {
    return red(REASON_CODES.DATABASE_DESTRUCTIVE);
  }
  if (action.operation === "database_write") {
    if (
      action.flags.bulk ||
      action.flags.force ||
      !action.rollback.available ||
      new Set(["production", "unknown"]).has(action.target.environment)
    ) {
      return red(REASON_CODES.DATABASE_DESTRUCTIVE);
    }
    return yellow(REASON_CODES.DATABASE_WRITE);
  }
  if (
    action.operation === "production_change" ||
    action.target.environment === "production"
  ) {
    return red(REASON_CODES.PRODUCTION_CHANGE);
  }
  if (action.operation === "billing") {
    return red(REASON_CODES.BILLING_OR_COST);
  }
  if (
    action.operation === "publish" ||
    action.operation === "send_message" ||
    action.flags.public
  ) {
    return red(REASON_CODES.EXTERNAL_PUBLICATION);
  }
  if (
    action.operation === "write_file" &&
    action.target.scope === "outside_workspace"
  ) {
    return red(REASON_CODES.OUTSIDE_WORKSPACE_WRITE);
  }
  if (action.operation === "change_permission") {
    return yellow(REASON_CODES.SCOPED_PERMISSION);
  }
  if (action.operation === "install_dependency") {
    return yellow(REASON_CODES.DEPENDENCY_INSTALL);
  }
  if (action.operation === "write_file") {
    return yellow(REASON_CODES.WORKSPACE_WRITE);
  }
  return { risk: "green", reasonCode: REASON_CODES.READ_ONLY };
}

/** @param {string} operation */
function sideEffect(operation) {
  return (
    {
      read: "read_only",
      database_read: "read_only",
      write_file: "filesystem_change",
      install_dependency: "dependency_change",
      delete: "deletion",
      credential_exposure: "credential_disclosure",
      change_permission: "permission_change",
      database_write: "database_write",
      database_migration: "database_migration",
      publish: "external_publication",
      send_message: "external_message",
      production_change: "production_change",
      billing: "billing_or_cost",
      transmit_profile: "profile_data_transmission",
      install_remote_code: "remote_code_execution",
      rewrite_history: "repository_history_rewrite",
      unknown: "unknown_side_effect",
    }[operation] ?? "unknown_side_effect"
  );
}

/** @param {string} reasonCode */
function recoveryFor(reasonCode) {
  if (reasonCode === REASON_CODES.CREDENTIAL_EXPOSURE) {
    return {
      precondition: "Stop output and transmission of the credential.",
      rollback:
        "Revoke or rotate it at the provider, then remove it from logs and history; .gitignore does not erase past exposure.",
    };
  }
  if (reasonCode === REASON_CODES.PRIVACY_TRANSMISSION) {
    return {
      precondition:
        "Remove personal data or use only the approved typed projection with recorded consent.",
      rollback:
        "Revoke the projection approval and delete any Fairytail cache before retrying.",
    };
  }
  if (reasonCode === REASON_CODES.DATABASE_DESTRUCTIVE) {
    return {
      precondition:
        "Verify the database environment, backup, transaction boundary, and exact affected rows.",
      rollback:
        "Rehearse and test the rollback on non-production data before any manual action.",
    };
  }
  if (reasonCode === REASON_CODES.PRODUCTION_CHANGE) {
    return {
      precondition:
        "Use a staged target, health check, and an already tested rollback.",
      rollback:
        "Keep production automation outside Fairytail and perform the approved run manually.",
    };
  }
  if (reasonCode === REASON_CODES.BILLING_OR_COST) {
    return {
      precondition:
        "Show provider, exact amount, currency, recurrence, and cancellation terms.",
      rollback:
        "Complete purchases manually and record the provider cancellation path first.",
    };
  }
  if (reasonCode === REASON_CODES.EXTERNAL_PUBLICATION) {
    return {
      precondition:
        "Preview the exact recipient, visibility, and payload without secrets or personal data.",
      rollback:
        "Use the provider undo or deletion path and perform the approved send manually.",
    };
  }
  if (reasonCode === REASON_CODES.PERMISSION_WIDENING) {
    return {
      precondition:
        "Inspect the current owner and mode, then choose the narrowest required permission.",
      rollback: "Record the original owner and mode before any manual change.",
    };
  }
  if (reasonCode === REASON_CODES.DESTRUCTIVE_DELETE) {
    return {
      precondition:
        "Resolve the exact target and make a recoverable copy or version-control checkpoint.",
      rollback:
        "Restore from that checkpoint; retry only with a narrower, non-recursive target.",
    };
  }
  if (reasonCode === REASON_CODES.HISTORY_REWRITE) {
    return {
      precondition:
        "Inspect the branch, remote, collaborators, and a backup reference before rewriting history.",
      rollback:
        "Keep the original commit reference and recover with the host's normal Git policy.",
    };
  }
  if (reasonCode === REASON_CODES.UNTRUSTED_INSTALLER) {
    return {
      precondition:
        "Download without executing, pin the source and version, and inspect a signed or checksummed artifact.",
      rollback:
        "Use an isolated disposable environment; do not pipe unknown network output into a shell.",
    };
  }
  if (reasonCode === REASON_CODES.OUTSIDE_WORKSPACE_WRITE) {
    return {
      precondition:
        "Move the target inside the current workspace or name it manually.",
      rollback:
        "Record the original file and use the host's normal permission prompt for any outside-workspace change.",
    };
  }
  return {
    precondition: "Inspect the exact target, side effect, and current state.",
    rollback:
      "Use a scoped host approval and verify the smallest reversible result before continuing.",
  };
}

/** @param {string} value */
function fingerprint(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex").slice(0, 16)}`;
}

/** @param {string} left @param {string} right */
function sameText(left, right) {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

/** @param {string} reasonCode */
function red(reasonCode) {
  return { risk: "red", reasonCode };
}

/** @param {string} reasonCode */
function yellow(reasonCode) {
  return { risk: "yellow", reasonCode };
}

/** @param {unknown} value @param {string} label */
function plainRecord(value, label) {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new TypeError(`${label} must be a plain object`);
  }
  return /** @type {Record<string, any>} */ (value);
}

/** @param {Record<string, any>} value @param {ReadonlyArray<string>} keys @param {string} label */
function exactKeys(value, keys, label) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new TypeError(
      `${label} must contain exactly: ${expected.join(", ")}`,
    );
  }
}

/** @template T @param {T} value @returns {Readonly<T>} */
function deepFreeze(value) {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
