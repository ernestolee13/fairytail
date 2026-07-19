export const G012_EXAMPLE_PROMPT =
  "Add a safe, read-only task lookup through the existing API. I’m new to coding—explain what an API is using a restaurant-kitchen picture.";

export const G012_VISUAL_CONTRACT = Object.freeze({
  schema_version: 1,
  evidence_id: "g012-jargon-to-clarity-v1",
  comparison_kind: "reviewed-jargon-to-familiar-flow-illustration",
  concepts: Object.freeze([
    "process-server",
    "api-request-response",
    "credential-api-key-access-token",
    "database-table-query",
    "mcp-tool-resource",
  ]),
  approved_profile_labels: Object.freeze([
    "Restaurant kitchen workflow",
    "dedicated supplier line",
    "service counter",
    "temporary station pass",
    "order ledger",
  ]),
  claim_boundary:
    "The left side is a deliberately jargon-dense synthetic formatter, not retained default-host output. The right side is a reviewed familiar-flow illustration using synthetic approved labels; it is not production personalization output or human-comprehension evidence.",
  source_pins: Object.freeze([
    "scripts/generate-g012-readme-evidence.mjs",
    "docs/assets/evidence/terminal-evidence.json",
    "src/learning/terminal.mjs",
    "src/analogy/personalized.mjs",
  ]),
});

/** @param {Record<string, any>} evidence */
export function evaluateG012ReadmeVisual(evidence) {
  const concepts = Array.isArray(evidence.concepts) ? evidence.concepts : [];
  const screenshot = isRecord(evidence.screenshot) ? evidence.screenshot : {};
  const passed =
    evidence.schema_version === G012_VISUAL_CONTRACT.schema_version &&
    evidence.evidence_id === G012_VISUAL_CONTRACT.evidence_id &&
    evidence.comparison_kind === G012_VISUAL_CONTRACT.comparison_kind &&
    evidence.synthetic_fixture === true &&
    evidence.not_a_host_session_capture === true &&
    evidence.same_read_only_scenario === true &&
    evidence.model_calls === 0 &&
    evidence.model_output_tokens === 0 &&
    evidence.network_calls === 0 &&
    evidence.profile_fixture_kind === "synthetic-approved-labels" &&
    evidence.production_personalization_path_exercised === false &&
    exactOrderedStrings(concepts, G012_VISUAL_CONTRACT.concepts) &&
    exactOrderedStrings(
      evidence.approved_profile_labels,
      G012_VISUAL_CONTRACT.approved_profile_labels,
    ) &&
    evidence.claim_boundary === G012_VISUAL_CONTRACT.claim_boundary &&
    validSha256Record(
      evidence.canonical_fact_set_hashes,
      G012_VISUAL_CONTRACT.concepts,
    ) &&
    validSha256Record(evidence.source_pins, G012_VISUAL_CONTRACT.source_pins) &&
    exactRecordKeys(screenshot, [
      "chromium_version",
      "browser_distribution_pinned",
      "viewport",
      "jargon_sha256",
      "clarity_sha256",
      "html_sha256",
      "png_sha256",
    ]) &&
    typeof screenshot.chromium_version === "string" &&
    screenshot.chromium_version.length > 0 &&
    screenshot.browser_distribution_pinned === false &&
    screenshot.viewport === "1800x1080" &&
    [
      screenshot.jargon_sha256,
      screenshot.clarity_sha256,
      screenshot.html_sha256,
      screenshot.png_sha256,
    ].every(isSha256);
  return Object.freeze({
    comparison_kind: evidence.comparison_kind,
    concepts,
    model_calls: evidence.model_calls,
    network_calls: evidence.network_calls,
    profile_fixture_kind: evidence.profile_fixture_kind,
    production_personalization_path_exercised:
      evidence.production_personalization_path_exercised,
    passed,
    claim_boundary: evidence.claim_boundary,
  });
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** @param {unknown} value */
function isSha256(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
}

/** @param {unknown} value @param {readonly string[]} expected */
function exactOrderedStrings(value, expected) {
  return (
    Array.isArray(value) &&
    value.every((item) => typeof item === "string") &&
    JSON.stringify(value) === JSON.stringify(expected)
  );
}

/** @param {unknown} value @param {readonly string[]} expected */
function exactRecordKeys(value, expected) {
  return (
    isRecord(value) &&
    JSON.stringify(Object.keys(value).sort()) ===
      JSON.stringify([...expected].sort())
  );
}

/** @param {unknown} value @param {readonly string[]} expected */
function validSha256Record(value, expected) {
  return (
    exactRecordKeys(value, expected) &&
    Object.values(/** @type {Record<string, unknown>} */ (value)).every(
      isSha256,
    )
  );
}
