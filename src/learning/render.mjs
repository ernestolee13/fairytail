import { stableStringify } from "../content/stable-json.mjs";
import {
  isLocallyTrustedLearningPacket,
  LEARNING_SECTION_SLOTS,
  validateLearningPacket,
} from "./packet.mjs";

export const EXPLANATION_PATCH_VERSION = 1;
const PATCH_KEYS = [
  "schema_version",
  "packet_id",
  "protected_render_hash",
  "section_order",
  "section_detail",
];
const MAX_PATCH_BYTES = 16 * 1024;
const LOCALLY_TRUSTED_PREPARED_RENDERS = new WeakSet();

/**
 * Precompute the complete local answer before any optional model call.
 *
 * @param {unknown} packetValue
 */
export function prepareLearningRender(packetValue) {
  const locallyTrusted = isLocallyTrustedLearningPacket(packetValue);
  const packet = validateLearningPacket(packetValue);
  const deterministicOutput = compose(packet, null);
  const prepared = deepFreeze({
    packet,
    deterministic_output: deterministicOutput,
    deterministic_json: stableStringify(deterministicOutput),
  });
  if (locallyTrusted) LOCALLY_TRUSTED_PREPARED_RENDERS.add(prepared);
  return prepared;
}

/**
 * Validate the model's closed presentation patch. It can name existing slots
 * and choose disclosure metadata; it has no field capable of carrying facts or
 * replacement prose.
 *
 * @param {unknown} value
 * @param {unknown} packetValue
 */
export function validateExplanationPatch(value, packetValue) {
  const packet = validateLearningPacket(packetValue);
  const parsed = parsePatch(value);
  const patch = structuredClone(record(parsed, "explanation patch"));
  exactKeys(patch, PATCH_KEYS, "explanation patch");
  if (patch.schema_version !== EXPLANATION_PATCH_VERSION) {
    throw new TypeError("Unsupported explanation patch schema_version");
  }
  if (patch.packet_id !== packet.packet_id) {
    throw new TypeError("explanation patch packet_id mismatch");
  }
  if (patch.protected_render_hash !== packet.protected_render_hash) {
    throw new TypeError("explanation patch protected_render_hash mismatch");
  }
  if (!Array.isArray(patch.section_order)) {
    throw new TypeError("explanation patch section_order must be an array");
  }
  if (
    patch.section_order.length !== LEARNING_SECTION_SLOTS.length ||
    new Set(patch.section_order).size !== LEARNING_SECTION_SLOTS.length ||
    !LEARNING_SECTION_SLOTS.every((slot) => patch.section_order.includes(slot))
  ) {
    throw new TypeError(
      "explanation patch section_order must be an exact slot permutation",
    );
  }
  const detail = record(
    patch.section_detail,
    "explanation patch section_detail",
  );
  exactKeys(detail, LEARNING_SECTION_SLOTS, "explanation patch section_detail");
  for (const slot of LEARNING_SECTION_SLOTS) {
    if (detail[slot] !== "full" && detail[slot] !== "compact") {
      throw new TypeError(
        `explanation patch detail for ${slot} must be full or compact`,
      );
    }
  }
  patch.section_detail = detail;
  return deepFreeze(patch);
}

/**
 * Apply a valid presentation-only patch or return the exact precomputed local
 * output for every invalid, empty, timed-out, or mutating response.
 *
 * @param {ReturnType<typeof prepareLearningRender>} prepared
 * @param {unknown} patchValue
 */
export function applyExplanationPatch(prepared, patchValue) {
  if (!LOCALLY_TRUSTED_PREPARED_RENDERS.has(prepared)) {
    return fallback(prepared, "untrusted-packet");
  }
  const fallbackReason = obviousFallbackReason(patchValue);
  if (fallbackReason) return fallback(prepared, fallbackReason);
  try {
    const patch = validateExplanationPatch(patchValue, prepared.packet);
    return deepFreeze({
      status: "applied",
      fallback_reason: null,
      output: compose(prepared.packet, patch),
    });
  } catch {
    return fallback(prepared, "invalid-patch");
  }
}

/** @param {unknown} output */
export function stableLearningRenderBytes(output) {
  return Buffer.from(stableStringify(output), "utf8");
}

/** @param {ReturnType<typeof validateLearningPacket>} packet @param {ReturnType<typeof validateExplanationPatch> | null} patch */
function compose(packet, patch) {
  const order = /** @type {string[]} */ (
    patch?.section_order ?? [...LEARNING_SECTION_SLOTS]
  );
  return deepFreeze({
    render_version: 1,
    packet_id: packet.packet_id,
    producer: structuredClone(packet.producer),
    build_packet_hash: packet.build_packet_hash,
    protected_render_hash: packet.protected_render_hash,
    route: patch === null ? "deterministic" : "isolated_presentation_patch",
    locale: structuredClone(packet.protected_render.locale),
    sections: order.map((slot) => ({
      slot,
      detail: patch?.section_detail[slot] ?? "full",
      content: structuredClone(packet.protected_render.content[slot]),
    })),
    verified_task_result: structuredClone(packet.verified_task_result),
  });
}

/** @param {unknown} value */
function parsePatch(value) {
  if (typeof value !== "string") return value;
  if (Buffer.byteLength(value, "utf8") > MAX_PATCH_BYTES) {
    throw new TypeError("explanation patch is too large");
  }
  return JSON.parse(value);
}

/** @param {unknown} value */
function obviousFallbackReason(value) {
  if (value === undefined || value === null) return "empty-patch";
  if (typeof value === "string" && value.trim().length === 0) {
    return "empty-patch";
  }
  if (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    /** @type {Record<string, unknown>} */ (value).status === "timeout"
  ) {
    return "timeout";
  }
  return null;
}

/** @param {ReturnType<typeof prepareLearningRender>} prepared @param {string} reason */
function fallback(prepared, reason) {
  return deepFreeze({
    status: "fallback",
    fallback_reason: reason,
    output: prepared.deterministic_output,
  });
}

/** @param {unknown} value @param {string} label */
function record(value, label) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
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
