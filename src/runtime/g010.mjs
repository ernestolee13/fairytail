import { resolve as resolvePath } from "node:path";

import {
  createBuildDecisionPacket,
  validateBuildDecisionPacket,
} from "../build/contract.mjs";
import { loadAnalogyRuntime, resolveAnalogy } from "../analogy/engine.mjs";
import { routeExplanation } from "../explanation/router.mjs";
import { applyProgressiveDisclosure } from "../learning/disclosure.mjs";
import {
  createLearningPacket,
  validateLearningPacket,
} from "../learning/packet.mjs";
import { prepareLearningRender } from "../learning/render.mjs";
import { loadProfile } from "../profile/store.mjs";

export const G010_RUNTIME_SCHEMA_VERSION = 1;

const OPTION_KEYS = ["pluginRoot", "dataDir", "input"];
const INPUT_KEYS = [
  "schema_version",
  "scenario_id",
  "requested_locale",
  "build_decision",
  "producer",
  "verified_task_result",
  "routing",
];
const PRODUCER_KEYS = [
  "role",
  "model_id",
  "packet_validated",
  "parent_model_changed",
];
const TASK_RESULT_KEYS = [
  "result_id",
  "status",
  "outcome",
  "summary",
  "verification",
];
const VERIFICATION_KEYS = ["check_id", "status", "evidence_id"];
const ROUTING_KEYS = ["explicit_opt_in", "host", "capabilities", "work"];
const CAPABILITY_KEYS = [
  "pluginAgent",
  "separatelyInstalled",
  "agentName",
  "model",
];
const WORK_KEYS = [
  "presentation_only",
  "ambiguity_resolved",
  "result_verified",
  "code_decision",
  "reasoning_decision",
  "safety_decision",
  "security_decision",
  "verification_decision",
];
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Prepare the complete deterministic G010 response and an optional route
 * recommendation. This boundary performs local file reads and bounded cache
 * maintenance only; it never executes the build check or invokes a model.
 *
 * @param {unknown} value
 */
export async function prepareG010Runtime(value) {
  const options = plainRecord(value, "G010 runtime options");
  exactKeys(options, OPTION_KEYS, "G010 runtime options");
  const pluginRoot = localPath(options.pluginRoot, "pluginRoot");
  const dataDir = localPath(options.dataDir, "dataDir");
  const input = validateRuntimeInput(options.input);

  // Build checks are inert argv data. Creating and validating this packet does
  // not interpret or execute runnable_check.argv.
  const createdBuildPacket = createBuildDecisionPacket(input.build_decision);
  const buildPacket = validateBuildDecisionPacket(createdBuildPacket);

  const [loadedProfile, runtime] = await Promise.all([
    loadProfile(dataDir),
    loadAnalogyRuntime(pluginRoot),
  ]);
  const resolution = await resolveAnalogy(runtime, {
    profile: loadedProfile.profile,
    scenarioId: input.scenario_id,
    dataDir,
  });

  // Keep the identity-bound packet returned by createLearningPacket. A clone
  // can be structurally valid but must not gain optional-route trust.
  const learningPacket = createLearningPacket(runtime, {
    scenarioId: input.scenario_id,
    resolution,
    requestedLocale: input.requested_locale,
    buildPacketHash: buildPacket.packet_hash,
    verifiedTaskResult: input.verified_task_result,
    producer: input.producer,
  });
  validateLearningPacket(learningPacket);
  const prepared = prepareLearningRender(learningPacket);
  const userFacingRender = applyProgressiveDisclosure(
    prepared.deterministic_output,
  );
  const routeRecommendation = routeExplanation({
    packet: learningPacket,
    explicit_opt_in: input.routing.explicit_opt_in,
    host: input.routing.host,
    capabilities: input.routing.capabilities,
    work: input.routing.work,
  });

  // Deliberately select only non-raw artifacts. In particular, the stored
  // profile, paths, build trace/task text, prompts, code, and check argv never
  // cross this return boundary.
  return deepFreeze({
    schema_version: G010_RUNTIME_SCHEMA_VERSION,
    status: "ready",
    analogy: {
      kind: resolution.kind,
      reason: resolution.reason,
    },
    explanation_id: learningPacket.packet_id,
    build_packet_hash: buildPacket.packet_hash,
    protected_render_hash: learningPacket.protected_render_hash,
    // This is both the user-facing render and the authoritative local fallback.
    // Returning it once avoids duplicating the same bytes in model tool output.
    deterministic_output: userFacingRender,
    route_recommendation: routeRecommendation,
    effects: {
      network_calls: resolution.network_calls,
      model_calls: 0,
      execution_calls: 0,
    },
  });
}

/** @param {unknown} value */
function validateRuntimeInput(value) {
  const input = plainRecord(value, "G010 input");
  exactKeys(input, INPUT_KEYS, "G010 input");
  if (input.schema_version !== G010_RUNTIME_SCHEMA_VERSION) {
    throw new TypeError("Unsupported G010 input schema_version");
  }
  if (
    typeof input.scenario_id !== "string" ||
    !/^S\d{2}$/u.test(input.scenario_id)
  ) {
    throw new TypeError("G010 input scenario_id is invalid");
  }
  if (
    input.requested_locale !== null &&
    (typeof input.requested_locale !== "string" ||
      input.requested_locale.length === 0 ||
      input.requested_locale.length > 35)
  ) {
    throw new TypeError("G010 input requested_locale is invalid");
  }

  plainRecord(input.build_decision, "G010 input build_decision");
  const producer = plainRecord(input.producer, "G010 input producer");
  exactKeys(producer, PRODUCER_KEYS, "G010 input producer");
  const taskResult = plainRecord(
    input.verified_task_result,
    "G010 input verified_task_result",
  );
  exactKeys(taskResult, TASK_RESULT_KEYS, "G010 input verified_task_result");
  const verification = plainRecord(
    taskResult.verification,
    "G010 input verified_task_result.verification",
  );
  exactKeys(
    verification,
    VERIFICATION_KEYS,
    "G010 input verified_task_result.verification",
  );

  const routing = plainRecord(input.routing, "G010 input routing");
  exactKeys(routing, ROUTING_KEYS, "G010 input routing");
  if (typeof routing.explicit_opt_in !== "boolean") {
    throw new TypeError("G010 input routing.explicit_opt_in must be boolean");
  }
  if (!new Set(["claude", "codex", "other"]).has(routing.host)) {
    throw new TypeError("G010 input routing.host is invalid");
  }
  const capabilities = plainRecord(
    routing.capabilities,
    "G010 input routing.capabilities",
  );
  exactKeys(capabilities, CAPABILITY_KEYS, "G010 input routing.capabilities");
  for (const key of ["pluginAgent", "separatelyInstalled"]) {
    if (typeof capabilities[key] !== "boolean") {
      throw new TypeError(`G010 input routing.capabilities.${key} is invalid`);
    }
  }
  for (const key of ["agentName", "model"]) {
    if (
      capabilities[key] !== null &&
      (typeof capabilities[key] !== "string" ||
        capabilities[key].length === 0 ||
        capabilities[key].length > 120)
    ) {
      throw new TypeError(`G010 input routing.capabilities.${key} is invalid`);
    }
  }

  const work = plainRecord(routing.work, "G010 input routing.work");
  exactKeys(work, WORK_KEYS, "G010 input routing.work");
  for (const key of WORK_KEYS) {
    if (typeof work[key] !== "boolean") {
      throw new TypeError(`G010 input routing.work.${key} must be boolean`);
    }
  }
  return /** @type {Record<string, any>} */ (
    deepFreeze(structuredClone(input))
  );
}

/** @param {unknown} value @param {string} label */
function localPath(value, label) {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.length === 0 ||
    value.includes("\0") ||
    /^[A-Za-z][A-Za-z\d+.-]*:/u.test(value)
  ) {
    throw new TypeError(`${label} must be a local filesystem path`);
  }
  return resolvePath(value);
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
  const result = /** @type {Record<string, any>} */ (value);
  for (const key of Object.keys(result)) {
    if (FORBIDDEN_KEYS.has(key)) {
      throw new TypeError(`${label} contains an unsafe key`);
    }
  }
  return result;
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
