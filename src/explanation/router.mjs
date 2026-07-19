import {
  isLocallyTrustedLearningPacket,
  validateLearningPacket,
} from "../learning/packet.mjs";

const CLAUDE_AGENT = "fairytail-explainer";
const CLAUDE_EXPLAINER_MODEL = "claude-haiku-4-5-20251001";

/**
 * Select an explanation route without changing configuration or invoking a
 * model. Unknown capability always stays local (or advisory on Codex).
 *
 * @param {unknown} input
 */
export function routeExplanation(input) {
  const source = asRecord(input);
  if (!source || !validPacket(source.packet)) {
    return decision("deterministic_inline", null, "invalid-packet");
  }
  if (!isLocallyTrustedLearningPacket(source.packet)) {
    return decision("deterministic_inline", null, "untrusted-packet");
  }
  if (source.explicit_opt_in !== true) {
    return decision("deterministic_inline", null, "explicit-opt-in-required");
  }

  const work = asRecord(source.work);
  if (!work) {
    return decision("deterministic_inline", null, "invalid-work-contract");
  }
  if (work.presentation_only !== true) {
    return decision("deterministic_inline", null, "presentation-only-required");
  }
  if (work.ambiguity_resolved !== true) {
    return decision("deterministic_inline", null, "ambiguity-must-be-resolved");
  }
  if (work.result_verified !== true) {
    return decision(
      "deterministic_inline",
      null,
      "verification-must-be-complete",
    );
  }
  if (
    work.code_decision === true ||
    work.reasoning_decision === true ||
    work.safety_decision === true ||
    work.security_decision === true ||
    work.verification_decision === true
  ) {
    return decision(
      "deterministic_inline",
      null,
      "protected-decision-required",
    );
  }
  if (
    work.code_decision !== false ||
    work.reasoning_decision !== false ||
    work.safety_decision !== false ||
    work.security_decision !== false ||
    work.verification_decision !== false
  ) {
    return decision("deterministic_inline", null, "invalid-work-contract");
  }

  const capabilities = asRecord(source.capabilities) ?? {};
  if (source.host === "claude") {
    if (
      capabilities.pluginAgent === true &&
      capabilities.agentName === CLAUDE_AGENT
    ) {
      return decision("isolated_subagent", CLAUDE_EXPLAINER_MODEL, null);
    }
    return decision(
      "deterministic_inline",
      null,
      "claude-plugin-agent-unavailable",
    );
  }

  if (source.host === "codex") {
    return decision("deterministic_inline", null, "codex-model-route-disabled");
  }

  return decision("deterministic_inline", null, "unsupported-host");
}

/** @param {string} route @param {string | null} model @param {string | null} fallback */
function decision(route, model, fallback) {
  return Object.freeze({
    route,
    model,
    fallback,
    parent_model_changed: false,
  });
}

/** @param {unknown} value */
function validPacket(value) {
  try {
    validateLearningPacket(value);
    return true;
  } catch {
    return false;
  }
}

/** @param {unknown} value */
function asRecord(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return /** @type {Record<string, any>} */ (value);
}
