import { dueLearningEvidence } from "./learning/store.mjs";
import { appendPrivateStoreFile } from "./private-store.mjs";
import {
  assessPreToolUse,
  failClosedAssessment,
  preToolUseResponse,
} from "./safety/pretool.mjs";

export const EVENT_LOG_FILE = "events.jsonl";
export const MAX_EVENT_LOG_BYTES = 1024 * 1024;
export const MAX_EVENT_LINE_BYTES = 2048;

const HOOK_EVENTS = new Set([
  "SessionStart",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
]);

export const FAILURE_CONTEXT = [
  "Fairytail observed a tool failure without copying its content.",
  "Stabilize before retrying; when useful, use /fairytail:error with one bounded observed-evidence summary, one cause tied to that evidence, and one safe action.",
  "Never copy raw tool input, output, code, commands, errors, logs, paths, prompts, profiles, or secrets into Fairytail.",
].join(" ");

export const VERIFICATION_CONTEXT = [
  "Fairytail observed a successful verification-shaped Bash call without copying its content.",
  "This is only a cue: inspect the actual result, then use /fairytail:finish with bounded fresh evidence tied to the current interaction.",
  "Do not infer task completion from this hook alone and do not copy the raw command or output into Fairytail.",
].join(" ");

const VERIFICATION_COMMAND_PATTERN =
  /(?:\bnpm\s+(?:test|run\s+(?:test|check|lint|typecheck|build))\b|\bpnpm\s+(?:(?:run\s+)?(?:test|check|lint|typecheck|build))\b|\byarn\s+(?:(?:run\s+)?(?:test|check|lint|typecheck|build))\b|\bnode\s+--test\b|\bpytest\b|\bcargo\s+test\b|\bgo\s+test\b)/u;

/**
 * Build the bounded model-visible response for the configured hook event.
 *
 * @param {unknown} input
 * @param {{ dueCount?: number, safetyAssessment?: ReturnType<typeof assessPreToolUse> }} [options]
 * @returns {Record<string, any>}
 */
export function responseFor(input, options = {}) {
  if (!isRecord(input)) return {};
  if (input.hook_event_name === "PreToolUse") {
    return preToolUseResponse(
      options.safetyAssessment ?? assessPreToolUse(input),
    );
  }
  if (input.hook_event_name === "SessionStart") {
    const dueCount = Number.isInteger(options.dueCount)
      ? Math.max(0, Number(options.dueCount))
      : 0;
    if (dueCount === 0) return {};
    return hookContext(
      "SessionStart",
      `${dueCount} optional delayed Fairytail review${dueCount === 1 ? " is" : "s are"} due; offer /fairytail:review without blocking current work.`,
    );
  }
  if (input.hook_event_name === "PostToolUseFailure") {
    return hookContext("PostToolUseFailure", FAILURE_CONTEXT);
  }
  if (
    input.hook_event_name === "PostToolUse" &&
    input.tool_name === "Bash" &&
    isRecord(input.tool_input) &&
    isVerificationCommand(input.tool_input.command)
  ) {
    return hookContext("PostToolUse", VERIFICATION_CONTEXT);
  }
  return {};
}

/** @param {unknown} value */
export function isVerificationCommand(value) {
  return (
    typeof value === "string" &&
    value.length <= 16_384 &&
    VERIFICATION_COMMAND_PATTERN.test(value)
  );
}

/**
 * Keep an intentionally tiny, non-content event envelope. Raw prompts, tool
 * inputs, tool outputs, errors, paths, identifiers, and profile fields are not
 * copied into the log.
 *
 * @param {unknown} input
 * @param {string} timestamp
 * @param {ReturnType<typeof assessPreToolUse> | undefined} [safetyAssessment]
 */
export function eventEnvelope(input, timestamp, safetyAssessment) {
  const event =
    isRecord(input) &&
    typeof input.hook_event_name === "string" &&
    HOOK_EVENTS.has(input.hook_event_name)
      ? input.hook_event_name
      : "Unknown";

  if (event === "PreToolUse") {
    const assessment = safetyAssessment ?? failClosedAssessment();
    return {
      schemaVersion: 1,
      timestamp,
      event,
      phase: "g006-deterministic-safety-guard",
      risk: assessment.risk,
      decision: assessment.decision,
      reasonCode: assessment.reason_code,
      target: {
        display: assessment.target.display,
        fingerprint: assessment.target.fingerprint,
      },
      sideEffect: assessment.side_effect,
    };
  }

  return {
    schemaVersion: 1,
    timestamp,
    event,
    phase: "g005-intervention-learning-boundary",
  };
}

/**
 * @param {unknown} input
 * @param {{ dataDir?: string, now?: () => Date }} [options]
 */
export async function handleHook(input, options = {}) {
  const now = options.now ?? (() => new Date());
  const observedAt = now();
  const safetyAssessment =
    isRecord(input) && input.hook_event_name === "PreToolUse"
      ? assessPreToolUse(input)
      : undefined;
  let dueCount = 0;
  if (
    isRecord(input) &&
    input.hook_event_name === "SessionStart" &&
    options.dataDir
  ) {
    try {
      dueCount = (await dueLearningEvidence(options.dataDir, observedAt))
        .length;
    } catch {
      dueCount = 0;
    }
  }
  const response = responseFor(input, { dueCount, safetyAssessment });
  const record = eventEnvelope(
    input,
    observedAt.toISOString(),
    safetyAssessment,
  );
  const persistence = await persistEnvelope(record, options.dataDir);

  if (!persistence.ok) {
    response.systemMessage =
      "Fairytail compatibility logging is unavailable; no prompt, profile, tool input, output, or error was stored.";
  }

  return { response, record, persistence };
}

/**
 * @param {Record<string, unknown>} record
 * @param {string | undefined} dataDir
 * @returns {Promise<{ ok: true, path: string } | { ok: false, reason: "data-dir-unavailable" | "write-failed" }>}
 */
async function persistEnvelope(record, dataDir) {
  if (!dataDir) {
    return { ok: false, reason: "data-dir-unavailable" };
  }

  try {
    const line = `${JSON.stringify(record)}\n`;
    const lineBytes = Buffer.byteLength(line, "utf8");
    if (lineBytes > MAX_EVENT_LINE_BYTES) {
      return { ok: false, reason: "write-failed" };
    }
    const path = await appendPrivateStoreFile(
      dataDir,
      EVENT_LOG_FILE,
      line,
      MAX_EVENT_LOG_BYTES,
      "Fairytail event log",
    );
    return { ok: true, path };
  } catch {
    return { ok: false, reason: "write-failed" };
  }
}

/** @param {string} hookEventName @param {string} additionalContext */
function hookContext(hookEventName, additionalContext) {
  return {
    hookSpecificOutput: {
      hookEventName,
      additionalContext,
    },
  };
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
