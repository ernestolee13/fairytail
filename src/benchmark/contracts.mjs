export const BENCHMARK_SCHEMA_VERSION = 1;

export const HEADLINE_ARMS = Object.freeze([
  "baseline",
  "ponytail",
  "fairytail-local",
]);

export const DIAGNOSTIC_VARIANTS = Object.freeze([
  "fairytail-agent",
  "fairytail-skill-override",
]);

export const PONYTAIL_COMMIT = "16f29800fd2681bdf24f3eb4ccffe38be3baec6b";

export const PONYTAIL_SKILL_SHA256 =
  "1316a2f3f95741d2300b116fe0c2d81ce4a9568656ed0a62643f54aaf09957f2";

export const CLAUDE_CLI_VERSION = "2.1.214";

export const PARENT_MODEL_ID = "claude-sonnet-4-6";

export const PARENT_EFFORT = "high";

export const RENDERER_MODEL_ID = "claude-haiku-4-5-20251001";

export const METRIC_STATUSES = Object.freeze([
  "measured",
  "derived",
  "estimated",
  "unavailable",
  "invalid",
]);

/**
 * A metric never overloads zero to mean missing. Missing and invalid values are
 * always null and carry a reason; real zeroes retain their numeric value.
 *
 * @param {unknown} value
 * @param {"measured"|"derived"|"estimated"|"unavailable"|"invalid"} status
 * @param {string} source
 * @param {string|null} [reason]
 */
export function metric(value, status, source, reason = null) {
  const envelope = { value, status, source, reason };
  assertMetricEnvelope(envelope);
  return envelope;
}

/**
 * @param {string} source
 * @param {string} reason
 */
export function unavailableMetric(source, reason) {
  return metric(null, "unavailable", source, reason);
}

/**
 * @param {string} source
 * @param {string} reason
 */
export function invalidMetric(source, reason) {
  return metric(null, "invalid", source, reason);
}

/**
 * @param {unknown} value
 * @returns {asserts value is {value: unknown, status: string, source: string, reason: string|null}}
 */
export function assertMetricEnvelope(value) {
  if (!isRecord(value)) {
    throw new TypeError("Metric envelope must be an object");
  }

  const keys = Object.keys(value).sort();
  const expected = ["reason", "source", "status", "value"];
  if (
    keys.length !== expected.length ||
    !keys.every((key, index) => key === expected[index])
  ) {
    throw new TypeError(
      "Metric envelope must contain exactly value, status, source, and reason",
    );
  }

  if (!METRIC_STATUSES.includes(/** @type {never} */ (value.status))) {
    throw new TypeError(`Unknown metric status: ${String(value.status)}`);
  }
  if (typeof value.source !== "string" || value.source.length === 0) {
    throw new TypeError("Metric source must be a non-empty string");
  }
  if (value.reason !== null && typeof value.reason !== "string") {
    throw new TypeError("Metric reason must be a string or null");
  }

  if (value.status === "unavailable" || value.status === "invalid") {
    if (value.value !== null || !value.reason) {
      throw new TypeError(
        `${value.status} metrics require a null value and non-empty reason`,
      );
    }
    return;
  }

  if (value.value === null || value.value === undefined) {
    throw new TypeError(
      `${value.status} metrics require an observed or derived value`,
    );
  }
  if (value.reason !== null) {
    throw new TypeError(`${value.status} metrics must use reason: null`);
  }
  assertFiniteNumbers(value.value, "metric.value");
}

/**
 * @param {unknown} value
 * @param {string} path
 */
function assertFiniteNumbers(value, path) {
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new TypeError(`Non-finite number at ${path}`);
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      assertFiniteNumbers(item, `${path}[${index}]`),
    );
    return;
  }
  if (isRecord(value)) {
    for (const [key, item] of Object.entries(value)) {
      assertFiniteNumbers(item, `${path}.${key}`);
    }
  }
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
export function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
