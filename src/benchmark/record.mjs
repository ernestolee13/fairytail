import {
  BENCHMARK_SCHEMA_VERSION,
  DIAGNOSTIC_VARIANTS,
  HEADLINE_ARMS,
  assertMetricEnvelope,
  isRecord,
} from "./contracts.mjs";

/** @param {unknown} record */
export function validateBenchmarkRun(record) {
  if (!isRecord(record)) throw new TypeError("Benchmark run must be an object");
  const required = [
    "schema_version",
    "benchmark_id",
    "run_id",
    "created_at",
    "synthetic",
    "measurement_kind",
    "lane",
    "complete",
    "publishable",
    "host",
    "host_cli_version",
    "arm",
    "variant",
    "task_id",
    "repetition",
    "pins",
    "isolation",
    "outcome",
    "metrics",
    "artifacts",
    "limitations",
  ];
  for (const field of required) {
    if (!Object.hasOwn(record, field))
      throw new TypeError(`Missing run field: ${field}`);
  }
  if (
    record.schema_version !== BENCHMARK_SCHEMA_VERSION ||
    record.benchmark_id !== "g010"
  ) {
    throw new TypeError("Unsupported benchmark run schema");
  }
  if (typeof record.run_id !== "string" || record.run_id.length === 0) {
    throw new TypeError("run_id must be non-empty");
  }
  if (
    typeof record.created_at !== "string" ||
    Number.isNaN(Date.parse(record.created_at))
  ) {
    throw new TypeError("created_at must be an ISO date-time");
  }
  if (
    typeof record.synthetic !== "boolean" ||
    typeof record.complete !== "boolean"
  ) {
    throw new TypeError("synthetic and complete must be booleans");
  }
  if (record.publishable !== false && record.publishable !== true) {
    throw new TypeError("publishable must be boolean");
  }
  if (!HEADLINE_ARMS.includes(/** @type {never} */ (record.arm))) {
    throw new TypeError(`Unknown headline arm: ${String(record.arm)}`);
  }
  if (
    record.variant !== "headline" &&
    !DIAGNOSTIC_VARIANTS.includes(/** @type {never} */ (record.variant))
  ) {
    throw new TypeError(`Unknown benchmark variant: ${String(record.variant)}`);
  }
  if (record.variant !== "headline" && record.arm !== "fairytail-local") {
    throw new TypeError(
      "Diagnostic routing variants belong to fairytail-local only",
    );
  }
  if (!Number.isInteger(record.repetition) || Number(record.repetition) < 1) {
    throw new TypeError("repetition must be a positive integer");
  }
  if (
    !Array.isArray(record.limitations) ||
    record.limitations.some((item) => typeof item !== "string")
  ) {
    throw new TypeError("limitations must be an array of strings");
  }
  assertMetricTree(record.outcome, "outcome");
  assertMetricTree(record.metrics, "metrics");
  return record;
}

/**
 * Publication is an external verifier decision, never a self-asserted label.
 * Synthetic, placeholder, incomplete, failed-gate, or unpinned runs are
 * rejected.
 *
 * @param {unknown} input
 */
export function assertPublishableRun(input) {
  const record = validateBenchmarkRun(input);
  if (record.synthetic === true)
    throw new Error("Synthetic results are not publishable");
  if (record.measurement_kind !== "live-agent") {
    throw new Error("Only live-agent measurements are publishable");
  }
  if (record.complete !== true)
    throw new Error("Incomplete results are not publishable");
  if (!isRecord(record.outcome))
    throw new TypeError("outcome must be an object");
  for (const gate of ["correctness_gate", "safety_gate", "hard_gate_passed"]) {
    const envelope = record.outcome[gate];
    assertMetricEnvelope(envelope);
    if (!isRecord(envelope) || envelope.value !== true) {
      throw new Error(`Failed publication gate: ${gate}`);
    }
  }
  if (!isRecord(record.pins) || record.pins.verified !== true) {
    throw new Error("Manifest/model pins are not verified");
  }
  return record;
}

/**
 * @param {unknown} value
 * @param {string} path
 */
function assertMetricTree(value, path) {
  if (!isRecord(value)) throw new TypeError(`${path} must be an object`);
  if (Object.hasOwn(value, "status")) {
    assertMetricEnvelope(value);
    return;
  }
  const entries = Object.entries(value);
  if (entries.length === 0) throw new TypeError(`${path} must not be empty`);
  for (const [key, child] of entries) {
    assertMetricTree(child, `${path}.${key}`);
  }
}
