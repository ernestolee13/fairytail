import { RENDER_SECTION_KEYS } from "../analogy/render.mjs";
import { sha256, stableStringify } from "../content/stable-json.mjs";
import { renderScenarioForLocale } from "../locale/present.mjs";
import { sensitiveReason } from "../profile/sanitize.mjs";

export const LEARNING_PACKET_VERSION = 1;
export const LEARNING_SECTION_SLOTS = Object.freeze([...RENDER_SECTION_KEYS]);

const PACKET_KEYS = [
  "schema_version",
  "packet_id",
  "producer",
  "build_packet_hash",
  "protected_render_hash",
  "protected_render",
  "verified_task_result",
];
const CREATE_INPUT_KEYS = [
  "scenarioId",
  "resolution",
  "requestedLocale",
  "buildPacketHash",
  "verifiedTaskResult",
  "producer",
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
const LOCALIZED_RENDER_KEYS = ["locale", "content"];
const LOCALE_KEYS = [
  "requested_locale",
  "resolved_locale",
  "source_locale",
  "fallback_reason",
  "catalog_hash",
];
const IDENTIFIER_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const CODE_PATTERN =
  /(?:```|`|=>|\b(?:const|let|var|function|class|import|export)\b|[{}])/u;
const MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{2,119}$/u;
const FLOATING_MODEL_PATTERN =
  /^(?:auto|default|fast|haiku|inherit|opus|small|sonnet)$|(?:^|[._:/-])latest(?:$|[._:/-])/iu;
const LIGHTWEIGHT_MODEL_PATTERN =
  /(?:^|[._:/-])(?:fast|flash|haiku|lite|mini|nano|small|spark)(?:$|[._:/-])/iu;
const LOCALLY_TRUSTED_PACKETS = new WeakSet();

/**
 * Bind the already-rendered learning facts to the build decision and a compact,
 * verified task result. The caller is the strong primary model boundary: only
 * the exact inert fields below are accepted.
 *
 * @param {Awaited<ReturnType<import("../analogy/engine.mjs").loadAnalogyRuntime>>} runtime
 * @param {unknown} input
 */
export function createLearningPacket(runtime, input) {
  const source = record(input, "learning packet input");
  exactKeys(source, CREATE_INPUT_KEYS, "learning packet input");
  const buildPacketHash = hash(source.buildPacketHash, "buildPacketHash");
  const taskResult = validateTaskResult(source.verifiedTaskResult);
  const producer = validateProducer(source.producer);
  if (typeof source.scenarioId !== "string" || source.scenarioId.length === 0) {
    throw new TypeError("scenarioId must be a non-empty string");
  }

  const protectedRender = renderScenarioForLocale(
    runtime,
    source.scenarioId,
    /** @type {import("../analogy/engine.mjs").AnalogyResolution} */ (
      source.resolution
    ),
    source.requestedLocale,
  );
  validateProtectedRender(protectedRender);
  const protectedRenderHash = sha256(stableStringify(protectedRender));
  const unsigned = {
    schema_version: LEARNING_PACKET_VERSION,
    producer: structuredClone(producer),
    build_packet_hash: buildPacketHash,
    protected_render_hash: protectedRenderHash,
    protected_render: structuredClone(protectedRender),
    verified_task_result: structuredClone(taskResult),
  };
  const packet = {
    schema_version: unsigned.schema_version,
    packet_id: `fairytail.learning.v1.${sha256(stableStringify(unsigned))}`,
    producer: unsigned.producer,
    build_packet_hash: unsigned.build_packet_hash,
    protected_render_hash: unsigned.protected_render_hash,
    protected_render: unsigned.protected_render,
    verified_task_result: unsigned.verified_task_result,
  };
  const validated = validateLearningPacket(packet);
  LOCALLY_TRUSTED_PACKETS.add(validated);
  return validated;
}

/**
 * Structural validation proves only internal consistency. This identity-bound
 * trust bit proves the packet was derived by this process from the reviewed
 * local runtime through createLearningPacket; a cloned or caller-forged packet
 * must be locally re-derived before it can cross the optional-model boundary.
 *
 * @param {unknown} value
 */
export function isLocallyTrustedLearningPacket(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    LOCALLY_TRUSTED_PACKETS.has(value)
  );
}

/**
 * Validate, clone, and recursively freeze a packet before it crosses the
 * optional presentation-model boundary.
 *
 * @param {unknown} value
 */
export function validateLearningPacket(value) {
  const packet = structuredClone(record(value, "learning packet"));
  exactKeys(packet, PACKET_KEYS, "learning packet");
  if (packet.schema_version !== LEARNING_PACKET_VERSION) {
    throw new TypeError("Unsupported learning packet schema_version");
  }
  packet.producer = validateProducer(packet.producer);
  hash(packet.build_packet_hash, "build_packet_hash");
  hash(packet.protected_render_hash, "protected_render_hash");
  validateProtectedRender(packet.protected_render);
  const actualRenderHash = sha256(stableStringify(packet.protected_render));
  if (packet.protected_render_hash !== actualRenderHash) {
    throw new TypeError(
      "protected_render_hash does not match protected_render",
    );
  }
  packet.verified_task_result = validateTaskResult(packet.verified_task_result);

  const unsigned = {
    schema_version: packet.schema_version,
    producer: packet.producer,
    build_packet_hash: packet.build_packet_hash,
    protected_render_hash: packet.protected_render_hash,
    protected_render: packet.protected_render,
    verified_task_result: packet.verified_task_result,
  };
  const expectedPacketId = `fairytail.learning.v1.${sha256(
    stableStringify(unsigned),
  )}`;
  if (packet.packet_id !== expectedPacketId) {
    throw new TypeError("packet_id does not match packet content");
  }
  return deepFreeze(packet);
}

/** @param {unknown} value */
function validateProducer(value) {
  const producer = structuredClone(record(value, "producer"));
  exactKeys(producer, PRODUCER_KEYS, "producer");
  if (producer.role !== "primary_reasoning_model") {
    throw new TypeError("producer.role must be primary_reasoning_model");
  }
  resolvedModelId(producer.model_id);
  if (producer.packet_validated !== true) {
    throw new TypeError("producer.packet_validated must be true");
  }
  if (producer.parent_model_changed !== false) {
    throw new TypeError("producer.parent_model_changed must be false");
  }
  return deepFreeze(producer);
}

/** @param {unknown} packet */
export function stableLearningPacketBytes(packet) {
  return Buffer.from(stableStringify(validateLearningPacket(packet)), "utf8");
}

/** @param {unknown} value */
function validateTaskResult(value) {
  const result = structuredClone(record(value, "verified_task_result"));
  exactKeys(result, TASK_RESULT_KEYS, "verified_task_result");
  identifier(result.result_id, "verified_task_result.result_id");
  if (result.status !== "verified") {
    throw new TypeError("verified_task_result.status must be verified");
  }
  if (result.outcome !== "changed" && result.outcome !== "no_change") {
    throw new TypeError(
      "verified_task_result.outcome must be changed or no_change",
    );
  }
  safeSummary(result.summary);

  const verification = record(
    result.verification,
    "verified_task_result.verification",
  );
  exactKeys(
    verification,
    VERIFICATION_KEYS,
    "verified_task_result.verification",
  );
  identifier(
    verification.check_id,
    "verified_task_result.verification.check_id",
  );
  if (verification.status !== "passed") {
    throw new TypeError(
      "verified_task_result.verification.status must be passed",
    );
  }
  identifier(
    verification.evidence_id,
    "verified_task_result.verification.evidence_id",
  );
  result.verification = structuredClone(verification);
  return deepFreeze(result);
}

/** @param {unknown} value */
function validateProtectedRender(value) {
  const rendered = record(value, "protected_render");
  exactKeys(rendered, LOCALIZED_RENDER_KEYS, "protected_render");

  const locale = record(rendered.locale, "protected_render.locale");
  exactKeys(locale, LOCALE_KEYS, "protected_render.locale");
  nullableLocale(locale.requested_locale, "requested_locale");
  if (locale.resolved_locale !== "en" && locale.resolved_locale !== "ko") {
    throw new TypeError("protected_render.locale.resolved_locale is invalid");
  }
  if (locale.source_locale !== "en") {
    throw new TypeError("protected_render.locale.source_locale must be en");
  }
  nullableIdentifier(locale.fallback_reason, "fallback_reason");
  if (locale.catalog_hash !== null) {
    hash(locale.catalog_hash, "catalog_hash");
  }

  const content = record(rendered.content, "protected_render.content");
  exactKeys(content, LEARNING_SECTION_SLOTS, "protected_render.content");
  for (const slot of LEARNING_SECTION_SLOTS) {
    if (slot === "protocol_fact_and_fairytail_policy_labels") {
      if (!Array.isArray(content[slot])) {
        throw new TypeError(
          `protected_render.content.${slot} must be an array`,
        );
      }
    } else {
      record(content[slot], `protected_render.content.${slot}`);
    }
  }
  stableStringify(rendered);
}

/** @param {unknown} value @param {string} label */
function safeSummary(value, label = "verified_task_result.summary") {
  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string`);
  }
  if (value !== value.normalize("NFC")) {
    throw new TypeError(`${label} must be NFC`);
  }
  if (value.trim() !== value || value.length === 0 || value.length > 240) {
    throw new TypeError(`${label} must be 1-240 trimmed characters`);
  }
  if (/[\r\n\u0000-\u001f\u007f]/u.test(value)) {
    throw new TypeError(`${label} must be one safe line`);
  }
  if (CODE_PATTERN.test(value)) {
    throw new TypeError(`${label} cannot contain raw code`);
  }
  const sensitive = sensitiveReason(value);
  if (sensitive) {
    throw new TypeError(`${label} contains ${sensitive}`);
  }
}

/** @param {unknown} value @param {string} label */
function identifier(value, label) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 100 ||
    !IDENTIFIER_PATTERN.test(value)
  ) {
    throw new TypeError(`${label} must be a bounded lowercase identifier`);
  }
}

/** @param {unknown} value */
function resolvedModelId(value) {
  if (
    typeof value !== "string" ||
    value !== value.normalize("NFC") ||
    !MODEL_ID_PATTERN.test(value) ||
    !/\d/u.test(value) ||
    FLOATING_MODEL_PATTERN.test(value) ||
    LIGHTWEIGHT_MODEL_PATTERN.test(value)
  ) {
    throw new TypeError(
      "producer.model_id must be a bounded resolved strong-model ID",
    );
  }
}

/** @param {unknown} value @param {string} label */
function nullableIdentifier(value, label) {
  if (value !== null) identifier(value, label);
}

/** @param {unknown} value @param {string} label */
function nullableLocale(value, label) {
  if (value === null) return;
  if (
    typeof value !== "string" ||
    value.length > 35 ||
    !/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/u.test(value)
  ) {
    throw new TypeError(`protected_render.locale.${label} is invalid`);
  }
}

/** @param {unknown} value @param {string} label */
function hash(value, label) {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    throw new TypeError(`${label} must be a lowercase SHA-256 hash`);
  }
  return value;
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
