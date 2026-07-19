import {
  acknowledgeManualBoundary,
  assessSafetyAction,
} from "../safety/policy.mjs";
import { assessPreToolUse, preToolUseResponse } from "../safety/pretool.mjs";

export const G006_RUNTIME_SCHEMA_VERSION = 1;

/**
 * Assess a closed action descriptor. This boundary renders policy data only;
 * it has no tool, command, model, network, or action execution surface.
 *
 * @param {unknown} value
 */
export function assessG006Action(value) {
  return envelope("assessed", assessSafetyAction(value));
}

/**
 * Confirm that the red manual-only boundary was retyped. A successful result
 * remains `execution_authorized: false` and cannot become a Fairytail permit.
 *
 * @param {unknown} value
 */
export function acknowledgeG006Boundary(value) {
  const input = plainRecord(value, "G006 acknowledgement");
  exactKeys(input, ["action", "retype"], "G006 acknowledgement");
  const acknowledgement = acknowledgeManualBoundary(input.action, input.retype);
  return Object.freeze({
    schema_version: G006_RUNTIME_SCHEMA_VERSION,
    status: "acknowledged",
    acknowledgement,
    effects: noEffects(),
  });
}

/**
 * Evaluate a stored test/diagnostic hook event while returning only sanitized
 * decision fields. The raw event is never copied into the result.
 *
 * @param {unknown} value
 */
export function assessG006HookEvent(value) {
  const assessment = assessPreToolUse(value);
  return Object.freeze({
    schema_version: G006_RUNTIME_SCHEMA_VERSION,
    status: "assessed",
    assessment,
    hook_response: preToolUseResponse(assessment),
    raw_event_included: false,
    effects: noEffects(),
  });
}

/** @param {string} status @param {Readonly<Record<string, any>>} assessment */
function envelope(status, assessment) {
  return Object.freeze({
    schema_version: G006_RUNTIME_SCHEMA_VERSION,
    status,
    assessment,
    effects: noEffects(),
  });
}

function noEffects() {
  return Object.freeze({
    model_calls: 0,
    network_calls: 0,
    action_execution_calls: 0,
    permission_grants: 0,
  });
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

/** @param {Record<string, any>} value @param {string[]} keys @param {string} label */
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
