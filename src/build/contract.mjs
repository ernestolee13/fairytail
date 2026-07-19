import { sha256, stableStringify } from "../content/stable-json.mjs";

export const BUILD_DECISION_SCHEMA_VERSION = 1;
export const BUILD_CONTRACT_VERSION = 1;
export const BUILD_CONTRACT_ID = "fairytail-build-decision-v1";

export const PONYTAIL_PROVENANCE = Object.freeze({
  project: "Ponytail",
  repository: "https://github.com/DietrichGebert/ponytail",
  commit: "16f29800fd2681bdf24f3eb4ccffe38be3baec6b",
  license: "MIT",
  adaptation: "Fairytail build-layer decision contract",
});

export const BUILD_LADDER = Object.freeze([
  "need",
  "repository_reuse",
  "standard_library",
  "native_platform",
  "installed_dependency",
  "one_line",
  "minimum_working_diff",
]);

export const SAFETY_INVARIANTS = Object.freeze([
  "trust_boundary_validation",
  "data_loss_prevention",
  "security",
  "accessibility",
  "explicit_requirements",
  "hardware_calibration",
]);

export const CHECK_TRIGGER_KINDS = Object.freeze([
  "branch",
  "loop",
  "parser",
  "money",
  "security",
  "nontrivial",
]);

export const COMPLEXITY_KINDS = Object.freeze([
  "trivial",
  ...CHECK_TRIGGER_KINDS,
]);

export const ALLOWED_CHECK_EXECUTABLES = Object.freeze([
  "node",
  "npm",
  "npx",
  "pnpm",
  "yarn",
  "bun",
  "deno",
  "python",
  "python3",
  "pytest",
  "cargo",
  "go",
  "dotnet",
  "mvn",
  "gradle",
  "./gradlew",
  "make",
  "just",
  "ruby",
  "bundle",
]);

const INPUT_FIELDS = [
  "task",
  "trace",
  "safety",
  "complexity",
  "ladder",
  "runnable_check",
];
const PACKET_FIELDS = [
  "schema_version",
  "contract_version",
  "contract_id",
  "provenance",
  ...INPUT_FIELDS.slice(0, 5),
  "decision",
  "runnable_check",
  "packet_hash",
];
const PROVENANCE_FIELDS = [
  "project",
  "repository",
  "commit",
  "license",
  "adaptation",
];
const TASK_FIELDS = [
  "summary",
  "requested_outcome",
  "explicit_requirements",
  "implementation_required",
];
const TRACE_FIELDS = [
  "completed_before_ladder",
  "entry_point",
  "flow",
  "callers",
  "shared_root",
  "evidence",
];
const SAFETY_DISPOSITION_FIELDS = ["applicable", "status", "evidence"];
const LADDER_ENTRY_FIELDS = ["rung", "status", "evidence"];
const DECISION_FIELDS = ["selected_rung", "rationale"];
const INPUT_CHECK_FIELDS = ["argv", "expected_evidence"];
const PACKET_CHECK_FIELDS = [
  "required",
  "reason_kinds",
  "argv",
  "expected_evidence",
];
const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const ARGV_TOKEN_PATTERN = /^[A-Za-z0-9_@%+=:,./-]+$/u;
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * A closed, deterministic build decision packet. The function validates the
 * trace before reading the ladder, derives the first working rung, records a
 * non-executing runnable-check plan, hashes the canonical packet, and freezes
 * the complete result.
 *
 * @param {unknown} value
 */
export function createBuildDecisionPacket(value) {
  const input = plainRecord(value, "$input");
  exactKeys(input, INPUT_FIELDS, "$input");

  const task = validateTask(input.task, "$input.task");
  const trace = validateTrace(input.trace, "$input.trace");
  const safety = validateSafety(input.safety, "$input.safety");
  const complexity = validateComplexity(
    input.complexity,
    safety,
    "$input.complexity",
  );

  // Intentionally validate the trace and invariants before the ladder. The
  // decision ladder is not a substitute for understanding the real flow.
  const ladder = validateLadder(input.ladder, "$input.ladder");
  const selected = firstSatisfyingEntry(ladder, "$input.ladder");
  validateTaskDecision(task, selected.rung, "$input.task");
  const runnableCheck = validateInputCheck(
    input.runnable_check,
    requiredCheckReasons(complexity, safety),
    "$input.runnable_check",
  );

  const withoutHash = {
    schema_version: BUILD_DECISION_SCHEMA_VERSION,
    contract_version: BUILD_CONTRACT_VERSION,
    contract_id: BUILD_CONTRACT_ID,
    provenance: { ...PONYTAIL_PROVENANCE },
    task,
    trace,
    safety,
    complexity,
    ladder,
    decision: {
      selected_rung: selected.rung,
      rationale: selected.evidence,
    },
    runnable_check: runnableCheck,
  };
  const packet = {
    ...withoutHash,
    packet_hash: sha256(stableStringify(withoutHash)),
  };

  return deepFreeze(packet);
}

/**
 * Validate an externally supplied packet, including provenance and hash, then
 * return a newly reconstructed, deeply frozen value.
 *
 * @param {unknown} value
 */
export function validateBuildDecisionPacket(value) {
  const packet = plainRecord(value, "$packet");
  exactKeys(packet, PACKET_FIELDS, "$packet");
  equal(
    packet.schema_version,
    BUILD_DECISION_SCHEMA_VERSION,
    "$packet.schema_version",
  );
  equal(
    packet.contract_version,
    BUILD_CONTRACT_VERSION,
    "$packet.contract_version",
  );
  equal(packet.contract_id, BUILD_CONTRACT_ID, "$packet.contract_id");
  const provenance = validateProvenance(
    packet.provenance,
    "$packet.provenance",
  );
  const task = validateTask(packet.task, "$packet.task");
  const trace = validateTrace(packet.trace, "$packet.trace");
  const safety = validateSafety(packet.safety, "$packet.safety");
  const complexity = validateComplexity(
    packet.complexity,
    safety,
    "$packet.complexity",
  );
  const ladder = validateLadder(packet.ladder, "$packet.ladder");
  const selected = firstSatisfyingEntry(ladder, "$packet.ladder");
  validateTaskDecision(task, selected.rung, "$packet.task");
  const decision = validateDecision(
    packet.decision,
    selected,
    "$packet.decision",
  );
  const runnableCheck = validatePacketCheck(
    packet.runnable_check,
    requiredCheckReasons(complexity, safety),
    "$packet.runnable_check",
  );
  const packetHash = fixedText(packet.packet_hash, "$packet.packet_hash", 64);
  if (!HASH_PATTERN.test(packetHash)) {
    fail("invalid-hash", "$packet.packet_hash");
  }

  const withoutHash = {
    schema_version: BUILD_DECISION_SCHEMA_VERSION,
    contract_version: BUILD_CONTRACT_VERSION,
    contract_id: BUILD_CONTRACT_ID,
    provenance,
    task,
    trace,
    safety,
    complexity,
    ladder,
    decision,
    runnable_check: runnableCheck,
  };
  const expectedHash = sha256(stableStringify(withoutHash));
  if (packetHash !== expectedHash) {
    fail("hash-mismatch", "$packet.packet_hash");
  }

  return deepFreeze({ ...withoutHash, packet_hash: packetHash });
}

/** @param {unknown} value @param {string} path */
function validateProvenance(value, path) {
  const provenance = plainRecord(value, path);
  exactKeys(provenance, PROVENANCE_FIELDS, path);
  for (const field of PROVENANCE_FIELDS) {
    equal(
      provenance[field],
      PONYTAIL_PROVENANCE[
        /** @type {keyof typeof PONYTAIL_PROVENANCE} */ (field)
      ],
      `${path}.${field}`,
    );
  }
  return { ...PONYTAIL_PROVENANCE };
}

/** @param {unknown} value @param {string} path */
function validateTask(value, path) {
  const task = plainRecord(value, path);
  exactKeys(task, TASK_FIELDS, path);
  const summary = safeText(task.summary, `${path}.summary`, 240);
  const requestedOutcome = safeText(
    task.requested_outcome,
    `${path}.requested_outcome`,
    500,
  );
  const explicitRequirements = uniqueTextList(
    task.explicit_requirements,
    `${path}.explicit_requirements`,
    1,
    32,
    500,
  );
  if (typeof task.implementation_required !== "boolean") {
    fail("invalid-boolean", `${path}.implementation_required`);
  }
  return {
    summary,
    requested_outcome: requestedOutcome,
    explicit_requirements: explicitRequirements,
    implementation_required: task.implementation_required,
  };
}

/** @param {unknown} value @param {string} path */
function validateTrace(value, path) {
  const trace = plainRecord(value, path);
  exactKeys(trace, TRACE_FIELDS, path);
  equal(trace.completed_before_ladder, true, `${path}.completed_before_ladder`);
  return {
    completed_before_ladder: true,
    entry_point: safeText(trace.entry_point, `${path}.entry_point`, 300),
    flow: uniqueTextList(trace.flow, `${path}.flow`, 1, 64, 500),
    callers: uniqueTextList(trace.callers, `${path}.callers`, 1, 64, 300),
    shared_root: safeText(trace.shared_root, `${path}.shared_root`, 300),
    evidence: uniqueTextList(trace.evidence, `${path}.evidence`, 1, 64, 500),
  };
}

/** @param {unknown} value @param {string} path */
function validateSafety(value, path) {
  const safety = plainRecord(value, path);
  exactKeys(safety, SAFETY_INVARIANTS, path);
  /** @type {Record<string, { applicable: boolean, status: "preserved" | "not_applicable", evidence: string }>} */
  const result = {};
  for (const invariant of SAFETY_INVARIANTS) {
    result[invariant] = validateSafetyDisposition(
      safety[invariant],
      `${path}.${invariant}`,
    );
  }
  if (!result.explicit_requirements.applicable) {
    fail("explicit-requirements-must-apply", `${path}.explicit_requirements`);
  }
  return result;
}

/** @param {unknown} value @param {string} path */
function validateSafetyDisposition(value, path) {
  const disposition = plainRecord(value, path);
  exactKeys(disposition, SAFETY_DISPOSITION_FIELDS, path);
  if (typeof disposition.applicable !== "boolean") {
    fail("invalid-boolean", `${path}.applicable`);
  }
  const status = fixedText(disposition.status, `${path}.status`, 32);
  if (status !== "preserved" && status !== "not_applicable") {
    fail("invalid-safety-status", `${path}.status`);
  }
  if (disposition.applicable !== (status === "preserved")) {
    fail("safety-status-mismatch", path);
  }
  return {
    applicable: disposition.applicable,
    status: /** @type {"preserved" | "not_applicable"} */ (status),
    evidence: safeText(disposition.evidence, `${path}.evidence`, 500),
  };
}

/**
 * @param {unknown} value
 * @param {Record<string, { applicable: boolean }>} safety
 * @param {string} path
 */
function validateComplexity(value, safety, path) {
  const complexity = plainRecord(value, path);
  exactKeys(complexity, ["kinds"], path);
  const kinds = uniqueEnumList(
    complexity.kinds,
    COMPLEXITY_KINDS,
    `${path}.kinds`,
  );
  if (kinds.includes("trivial") && kinds.length !== 1) {
    fail("trivial-cannot-be-combined", `${path}.kinds`);
  }
  if (safety.security.applicable && !kinds.includes("security")) {
    fail("security-kind-required", `${path}.kinds`);
  }
  return {
    kinds: COMPLEXITY_KINDS.filter((kind) => kinds.includes(kind)),
  };
}

/** @param {unknown} value @param {string} path */
function validateLadder(value, path) {
  const entries = list(value, path);
  if (entries.length !== BUILD_LADDER.length) {
    fail("invalid-ladder-length", path);
  }
  return entries.map((entryValue, index) => {
    const entryPath = `${path}[${index}]`;
    const entry = plainRecord(entryValue, entryPath);
    exactKeys(entry, LADDER_ENTRY_FIELDS, entryPath);
    equal(entry.rung, BUILD_LADDER[index], `${entryPath}.rung`);
    const status = fixedText(entry.status, `${entryPath}.status`, 32);
    if (
      status !== "satisfies" &&
      status !== "does_not_satisfy" &&
      status !== "not_evaluated"
    ) {
      fail("invalid-ladder-status", `${entryPath}.status`);
    }
    return {
      rung: /** @type {(typeof BUILD_LADDER)[number]} */ (entry.rung),
      status,
      evidence: safeText(entry.evidence, `${entryPath}.evidence`, 500),
    };
  });
}

/**
 * @param {Array<{ rung: string, status: string, evidence: string }>} ladder
 * @param {string} path
 */
function firstSatisfyingEntry(ladder, path) {
  const selectedIndex = ladder.findIndex(
    (entry) => entry.status === "satisfies",
  );
  if (selectedIndex === -1) fail("no-working-rung", path);
  for (const [index, entry] of ladder.entries()) {
    const expected =
      index < selectedIndex
        ? "does_not_satisfy"
        : index === selectedIndex
          ? "satisfies"
          : "not_evaluated";
    if (entry.status !== expected) {
      fail("ladder-short-circuit-violation", `${path}[${index}].status`);
    }
  }
  return ladder[selectedIndex];
}

/**
 * @param {{ implementation_required: boolean }} task
 * @param {string} selectedRung
 * @param {string} path
 */
function validateTaskDecision(task, selectedRung, path) {
  if (task.implementation_required !== (selectedRung !== "need")) {
    fail("implementation-need-mismatch", `${path}.implementation_required`);
  }
}

/**
 * @param {unknown} value
 * @param {{ rung: string, evidence: string }} selected
 * @param {string} path
 */
function validateDecision(value, selected, path) {
  const decision = plainRecord(value, path);
  exactKeys(decision, DECISION_FIELDS, path);
  equal(decision.selected_rung, selected.rung, `${path}.selected_rung`);
  equal(decision.rationale, selected.evidence, `${path}.rationale`);
  return {
    selected_rung: selected.rung,
    rationale: selected.evidence,
  };
}

/**
 * @param {{ kinds: string[] }} complexity
 * @param {Record<string, { applicable: boolean }>} safety
 */
function requiredCheckReasons(complexity, safety) {
  const reasons = CHECK_TRIGGER_KINDS.filter((kind) =>
    complexity.kinds.includes(kind),
  );
  if (safety.security.applicable && !reasons.includes("security")) {
    reasons.push("security");
  }
  return reasons;
}

/** @param {unknown} value @param {string[]} reasons @param {string} path */
function validateInputCheck(value, reasons, path) {
  const check = plainRecord(value, path);
  exactKeys(check, INPUT_CHECK_FIELDS, path);
  const required = reasons.length > 0;
  const argv = validateCheckArgv(check.argv, required, `${path}.argv`);
  const expectedEvidence = validateExpectedEvidence(
    check.expected_evidence,
    required,
    `${path}.expected_evidence`,
  );
  return {
    required,
    reason_kinds: [...reasons],
    argv,
    expected_evidence: expectedEvidence,
  };
}

/** @param {unknown} value @param {string[]} reasons @param {string} path */
function validatePacketCheck(value, reasons, path) {
  const check = plainRecord(value, path);
  exactKeys(check, PACKET_CHECK_FIELDS, path);
  const required = reasons.length > 0;
  equal(check.required, required, `${path}.required`);
  const reasonKinds = uniqueEnumList(
    check.reason_kinds,
    CHECK_TRIGGER_KINDS,
    `${path}.reason_kinds`,
    true,
  );
  if (
    reasonKinds.length !== reasons.length ||
    reasonKinds.some((reason, index) => reason !== reasons[index])
  ) {
    fail("check-reasons-mismatch", `${path}.reason_kinds`);
  }
  return {
    required,
    reason_kinds: [...reasons],
    argv: validateCheckArgv(check.argv, required, `${path}.argv`),
    expected_evidence: validateExpectedEvidence(
      check.expected_evidence,
      required,
      `${path}.expected_evidence`,
    ),
  };
}

/** @param {unknown} value @param {boolean} required @param {string} path */
function validateCheckArgv(value, required, path) {
  if (!required) {
    equal(value, null, path);
    return null;
  }
  const argv = list(value, path);
  if (argv.length < 1 || argv.length > 32) fail("invalid-argv-length", path);
  const result = argv.map((token, index) => {
    const tokenPath = `${path}[${index}]`;
    const text = fixedText(token, tokenPath, 200);
    if (!ARGV_TOKEN_PATTERN.test(text)) fail("unsafe-argv-token", tokenPath);
    return text;
  });
  if (!ALLOWED_CHECK_EXECUTABLES.includes(result[0])) {
    fail("executable-not-allowlisted", `${path}[0]`);
  }
  return result;
}

/** @param {unknown} value @param {boolean} required @param {string} path */
function validateExpectedEvidence(value, required, path) {
  if (!required) {
    equal(value, null, path);
    return null;
  }
  return safeText(value, path, 500);
}

/** @param {unknown} value @param {string} path */
function plainRecord(value, path) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail("not-a-plain-object", path);
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) {
    fail("unsafe-prototype", path);
  }
  const result = /** @type {Record<string, unknown>} */ (value);
  for (const key of Object.keys(result)) {
    if (FORBIDDEN_KEYS.has(key)) fail("unsafe-key", `${path}.${key}`);
  }
  return result;
}

/** @param {unknown} value @param {string} path */
function list(value, path) {
  if (!Array.isArray(value)) fail("not-an-array", path);
  return value;
}

/**
 * @param {Record<string, unknown>} value
 * @param {readonly string[]} expected
 * @param {string} path
 */
function exactKeys(value, expected, path) {
  for (const key of expected) {
    if (!Object.hasOwn(value, key)) fail("missing-field", `${path}.${key}`);
  }
  for (const key of Object.keys(value)) {
    if (!expected.includes(key)) fail("unknown-field", `${path}.${key}`);
  }
}

/** @param {unknown} value @param {string} path @param {number} maximum */
function safeText(value, path, maximum) {
  const result = fixedText(value, path, maximum);
  if (result !== result.trim() || /[\u0000-\u001f\u007f]/u.test(result)) {
    fail("unsafe-text", path);
  }
  return result;
}

/** @param {unknown} value @param {string} path @param {number} maximum */
function fixedText(value, path, maximum) {
  if (typeof value !== "string" || value.length < 1 || value.length > maximum) {
    fail("invalid-string", path);
  }
  if (value !== value.normalize("NFC")) fail("non-nfc", path);
  return value;
}

/**
 * @param {unknown} value
 * @param {string} path
 * @param {number} minimum
 * @param {number} maximum
 * @param {number} maximumLength
 */
function uniqueTextList(value, path, minimum, maximum, maximumLength) {
  const values = list(value, path);
  if (values.length < minimum || values.length > maximum) {
    fail("invalid-list-length", path);
  }
  const result = values.map((item, index) =>
    safeText(item, `${path}[${index}]`, maximumLength),
  );
  if (new Set(result).size !== result.length) fail("duplicate-items", path);
  return result;
}

/**
 * @param {unknown} value
 * @param {readonly string[]} allowed
 * @param {string} path
 * @param {boolean} [allowEmpty]
 */
function uniqueEnumList(value, allowed, path, allowEmpty = false) {
  const values = list(value, path);
  if ((!allowEmpty && values.length < 1) || values.length > allowed.length) {
    fail("invalid-list-length", path);
  }
  const result = values.map((item, index) => {
    const itemPath = `${path}[${index}]`;
    const entry = fixedText(item, itemPath, 32);
    if (!allowed.includes(entry)) fail("unsupported-value", itemPath);
    return entry;
  });
  if (new Set(result).size !== result.length) fail("duplicate-items", path);
  return result;
}

/** @param {unknown} actual @param {unknown} expected @param {string} path */
function equal(actual, expected, path) {
  if (actual !== expected) fail("unexpected-value", path);
}

/**
 * @template T
 * @param {T} value
 * @returns {T}
 */
function deepFreeze(value) {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export class BuildContractError extends TypeError {
  /** @param {string} code @param {string} path */
  constructor(code, path) {
    super(`Invalid Fairytail build decision at ${path}: ${code}`);
    this.name = "BuildContractError";
    this.code = code;
    this.path = path;
  }
}

/** @param {string} code @param {string} path @returns {never} */
function fail(code, path) {
  throw new BuildContractError(code, path);
}
