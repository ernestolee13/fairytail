import { resolve as resolvePath } from "node:path";

import { loadAnalogyRuntimeSafe, resolveAnalogy } from "../analogy/engine.mjs";
import { formatDirectConceptTerminal } from "../learning/terminal.mjs";
import { renderScenarioForLocale } from "../locale/present.mjs";
import { loadProfile } from "../profile/store.mjs";
import {
  beginnerSummaryForScenario,
  genericAnalogyForScenario,
  genericFirstAppMap,
} from "./generic-analogy.mjs";

export const DIRECT_CONCEPT_SCHEMA_VERSION = 1;
export const DIRECT_CONCEPT_MAX_OUTPUT_BYTES = 4 * 1024;
export const DIRECT_CONCEPT_BUNDLE_MAX_OUTPUT_BYTES =
  3 * DIRECT_CONCEPT_MAX_OUTPUT_BYTES;

const INPUT_KEYS = ["pluginRoot", "dataDir", "concept", "requestedLocale"];
const CONCEPT_SCENARIOS = Object.freeze({
  package: "S01",
  dependency: "S01",
  server: "S02",
  process: "S02",
  environment: "S03",
  config: "S03",
  api: "S04",
  "api-key": "S05",
  "access-token": "S05",
  "llm-token": "S05",
  token: "S05",
  database: "S06",
  db: "S06",
  query: "S06",
  mcp: "S07",
  tool: "S07",
  resource: "S07",
  permission: "S08",
  authentication: "S08",
  authorization: "S08",
  repository: "S09",
  repo: "S09",
  path: "S09",
  deploy: "S10",
  cloud: "S10",
  remote: "S10",
});
export const DIRECT_CONCEPT_ALIASES = Object.freeze(
  Object.keys(CONCEPT_SCENARIOS),
);

/**
 * Render one reviewed beginner concept through the shortest production path.
 * This boundary reads only bundled content and an optional local profile. It
 * never invokes a model, network client, command, or repository-discovery tool.
 *
 * @param {unknown} value
 */
export async function prepareDirectConcept(value) {
  const input = plainRecord(value, "direct concept input");
  exactKeys(input, INPUT_KEYS, "direct concept input");
  const pluginRoot = localPath(input.pluginRoot, "pluginRoot");
  const dataDir =
    input.dataDir === null ? null : localPath(input.dataDir, "dataDir");
  const concept = conceptKey(input.concept);
  const requestedLocale = locale(input.requestedLocale);
  const scenarioId = CONCEPT_SCENARIOS[concept];

  const [safeRuntime, loadedProfile] = await Promise.all([
    loadAnalogyRuntimeSafe(pluginRoot),
    loadProfile(dataDir ?? undefined),
  ]);
  const resolution = await resolveAnalogy(safeRuntime.runtime, {
    profile: loadedProfile.profile,
    scenarioId,
    ...(dataDir === null ? {} : { dataDir }),
  });
  const localized = renderScenarioForLocale(
    safeRuntime.runtime,
    scenarioId,
    resolution,
    requestedLocale,
  );
  const genericReason = genericFallbackReason(loadedProfile, resolution);
  const genericAnalogy =
    genericReason === null
      ? null
      : genericAnalogyForScenario(scenarioId, requestedLocale);
  const beginnerSummary = beginnerSummaryForScenario(
    scenarioId,
    requestedLocale,
  );
  if (beginnerSummary === null) {
    throw new TypeError("direct concept has no reviewed beginner summary");
  }
  const presentation = withDirectPresentation(
    localized,
    scenarioId,
    beginnerSummary,
    genericAnalogy,
  );
  const explanation = formatDirectConceptTerminal(presentation);
  const outputBytes = Buffer.byteLength(explanation, "utf8");
  if (outputBytes > DIRECT_CONCEPT_MAX_OUTPUT_BYTES) {
    throw new TypeError("direct concept output exceeds the fixed byte limit");
  }

  return deepFreeze({
    schema_version: DIRECT_CONCEPT_SCHEMA_VERSION,
    status: "ready",
    concept,
    scenario_id: scenarioId,
    route: "deterministic_inline",
    locale: localized.locale,
    analogy: {
      kind: genericAnalogy ? "generic" : resolution.kind,
      reason: genericReason ?? resolution.reason,
    },
    explanation,
    output_bytes: outputBytes,
    effects: {
      model_calls: 0,
      network_calls: resolution.network_calls,
      execution_calls: 0,
    },
  });
}

/**
 * A user who approved personalization should keep a useful reviewed analogy
 * while the optional noun-slot mapping is still absent. Neutral and explicit
 * no-analogy preferences remain authoritative.
 *
 * @param {Awaited<ReturnType<typeof loadProfile>>} loadedProfile
 * @param {Awaited<ReturnType<typeof resolveAnalogy>>} resolution
 */
function genericFallbackReason(loadedProfile, resolution) {
  if (resolution.kind !== "neutral") return null;
  if (loadedProfile.needsOnboarding) return "profile-not-set";
  return resolution.reason === "personalized-mapping-required"
    ? "personalized-mapping-pending"
    : null;
}

/**
 * Add compact direct-presentation fields to a copy. Canonical content and
 * profile resolution remain unchanged.
 *
 * @param {Record<string, any>} localized
 * @param {string} scenarioId
 * @param {string} beginnerSummary
 * @param {Readonly<{ label: string, relations: readonly Record<string, string>[], breakpoint: string }> | null} generic
 */
function withDirectPresentation(
  localized,
  scenarioId,
  beginnerSummary,
  generic,
) {
  const output = structuredClone(localized);
  output.beginner_summary = beginnerSummary;
  if (generic === null) return output;
  output.content.analogy_or_neutral_fallback = {
    kind: "mapped",
    mapping_id: `generic:${scenarioId}`,
    analogy_concept_id: `generic:${scenarioId}`,
    profile_world_id: "generic-first-use",
    label: generic.label,
    preserved_relations: structuredClone(generic.relations),
    neutral_comparison: [],
    controls: ["no_analogy"],
  };
  output.content.analogy_breakpoint = {
    kind: "mapped-limit",
    non_mappings: [generic.breakpoint],
    breakpoint: generic.breakpoint,
  };
  return output;
}

/**
 * Render up to three reviewed concepts for an explicitly requested initial
 * design walkthrough. The small fixed ceiling keeps the rich path bounded.
 *
 * @param {unknown} value
 */
export async function prepareDirectConceptBundle(value) {
  const input = plainRecord(value, "direct concept bundle input");
  exactKeys(
    input,
    ["pluginRoot", "dataDir", "concepts", "requestedLocale"],
    "direct concept bundle input",
  );
  if (
    !Array.isArray(input.concepts) ||
    input.concepts.length === 0 ||
    input.concepts.length > 3
  ) {
    throw new TypeError("concepts must contain between one and three aliases");
  }
  const concepts = input.concepts.map(conceptKey);
  const requestedLocale = locale(input.requestedLocale);
  if (new Set(concepts).size !== concepts.length) {
    throw new TypeError("concepts must not contain duplicates");
  }
  const renderedItems = await Promise.all(
    concepts.map((concept) =>
      prepareDirectConcept({
        pluginRoot: input.pluginRoot,
        dataDir: input.dataDir,
        concept,
        requestedLocale,
      }),
    ),
  );
  const items = renderedItems.filter(
    (item, index) =>
      renderedItems.findIndex(
        (candidate) => candidate.scenario_id === item.scenario_id,
      ) === index,
  );
  const firstAppMap =
    concepts.length === 3 &&
    [...concepts].sort().join(",") === "api,database,server" &&
    items.every((item) => item.analogy.kind === "generic")
      ? genericFirstAppMap(requestedLocale)
      : null;
  const explanation =
    firstAppMap ??
    `${items.map((item) => item.explanation.trimEnd()).join("\n\n---\n\n")}\n`;
  const outputBytes = Buffer.byteLength(explanation, "utf8");
  if (outputBytes > DIRECT_CONCEPT_BUNDLE_MAX_OUTPUT_BYTES) {
    throw new TypeError("direct concept bundle exceeds the fixed byte limit");
  }
  return deepFreeze({
    schema_version: DIRECT_CONCEPT_SCHEMA_VERSION,
    status: "ready",
    route: "deterministic_inline",
    concepts,
    items,
    explanation,
    output_bytes: outputBytes,
    effects: {
      model_calls: 0,
      network_calls: items.reduce(
        (total, item) => total + item.effects.network_calls,
        0,
      ),
      execution_calls: 0,
    },
  });
}

/** @param {unknown} value */
function conceptKey(value) {
  if (
    typeof value !== "string" ||
    value !== value.normalize("NFC") ||
    !Object.hasOwn(CONCEPT_SCENARIOS, value)
  ) {
    throw new TypeError("concept is not in the reviewed direct catalog");
  }
  return /** @type {keyof typeof CONCEPT_SCENARIOS} */ (value);
}

/** @param {unknown} value */
function locale(value) {
  if (value !== "en" && value !== "ko") {
    throw new TypeError("requestedLocale must be en or ko");
  }
  return value;
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

/** @template T @param {T} value @returns {Readonly<T>} */
function deepFreeze(value) {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
