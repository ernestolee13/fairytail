import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, relative, resolve } from "node:path";

import {
  CLAUDE_CLI_VERSION,
  HEADLINE_ARMS,
  PARENT_EFFORT,
  PARENT_MODEL_ID,
  RENDERER_MODEL_ID,
  isRecord,
  assertMetricEnvelope,
} from "./contracts.mjs";
import { runOfflineSyntheticBenchmark } from "./harness.mjs";
import { loadAndVerifyManifest } from "./manifest.mjs";
import { assertPublishableRun, validateBenchmarkRun } from "./record.mjs";
import { runScorerSelftests } from "./scoring.mjs";
import { balancedArmOrders, summarizeHeadlineRuns } from "./suite.mjs";
import { parseJsonLines } from "./telemetry.mjs";

/** @param {string} pluginRoot */
export async function verifyStaticBenchmarkAssets(pluginRoot) {
  const benchmarkRoot = resolve(pluginRoot, "benchmarks", "g010");
  const manifest = await loadAndVerifyManifest(
    resolve(benchmarkRoot, "manifest.lock.json"),
  );
  const selftest = await runScorerSelftests(benchmarkRoot);
  const synthetic = JSON.parse(
    await readFile(
      resolve(benchmarkRoot, "results", "synthetic-selftest.json"),
      "utf8",
    ),
  );
  verifyRunSuite(synthetic, false);
  const placeholder = JSON.parse(
    await readFile(
      resolve(benchmarkRoot, "results", "measured-results.json"),
      "utf8",
    ),
  );
  verifyMeasuredPlaceholder(placeholder);

  const temporaryArtifacts = await mkdtemp(
    resolve(tmpdir(), "fairytail-g010-verify-"),
  );
  try {
    const regenerated = await runOfflineSyntheticBenchmark(pluginRoot, {
      artifactRoot: temporaryArtifacts,
    });
    if (JSON.stringify(regenerated) !== JSON.stringify(synthetic)) {
      throw new Error(
        "Committed synthetic selftest artifact does not match deterministic regeneration",
      );
    }
  } finally {
    await rm(temporaryArtifacts, { recursive: true, force: true });
  }

  return {
    status: "pass",
    offline: true,
    model_calls: 0,
    network_calls: 0,
    manifest: manifest.pins,
    scorer_selftest: selftest,
    synthetic_runs: synthetic.runs.length,
    measured_results: "unavailable",
    publication_guard: "synthetic and incomplete artifacts rejected",
  };
}

/**
 * @param {unknown} artifact
 * @param {boolean} requirePublishable
 */
export function verifyRunSuite(artifact, requirePublishable) {
  if (!isRecord(artifact) || artifact.benchmark_id !== "g010") {
    throw new TypeError("Expected a G010 artifact object");
  }
  if (!Array.isArray(artifact.runs)) {
    throw new TypeError("Artifact runs must be an array");
  }
  if (requirePublishable && artifact.runs.length === 0) {
    throw new Error("Publishable artifact must contain at least one run");
  }
  for (const run of artifact.runs) {
    if (requirePublishable) assertPublishableRun(run);
    else validateBenchmarkRun(run);
  }
  if (requirePublishable && artifact.synthetic === true) {
    throw new Error("Synthetic suites are not publishable");
  }
  if (requirePublishable) assertPublishableSuiteStructure(artifact);
  return artifact;
}

/**
 * Verify the suite contract and the bytes referenced by every raw artifact.
 * The artifact path is required so placeholder paths cannot pass publication.
 *
 * @param {unknown} artifact
 * @param {string} artifactPath
 */
export async function verifyPublishableSuite(artifact, artifactPath) {
  verifyRunSuite(artifact, true);
  const suiteRoot = dirname(resolve(artifactPath));
  const suite = /** @type {Record<string, any>} */ (artifact);
  const diagnostics = suite.cache_diagnostic.variants;
  for (const run of [...suite.runs, ...diagnostics]) {
    const artifacts = run.artifacts;
    if (!isRecord(artifacts) || typeof artifacts.root !== "string") {
      throw new TypeError(`Run ${run.run_id} has no relative artifact root`);
    }
    const runRoot = resolve(suiteRoot, artifacts.root);
    const escape = relative(suiteRoot, runRoot);
    if (escape.startsWith("..") || resolve(runRoot) === resolve(suiteRoot)) {
      throw new Error(`Run ${run.run_id} artifact root escapes the suite`);
    }
    for (const [pathField, hashField] of [
      ["raw_events", "raw_events_sha256"],
      ["stderr", "stderr_sha256"],
      ["diff", "diff_sha256"],
    ]) {
      const path = artifacts[pathField];
      const expectedHash = artifacts[hashField];
      if (
        typeof path !== "string" ||
        typeof expectedHash !== "string" ||
        !/^[a-f0-9]{64}$/u.test(expectedHash)
      ) {
        throw new TypeError(
          `Run ${run.run_id} is missing ${pathField}/${hashField}`,
        );
      }
      const artifactFile = resolve(runRoot, path);
      const fileEscape = relative(runRoot, artifactFile);
      if (fileEscape.startsWith("..") || artifactFile === runRoot) {
        throw new Error(`Run ${run.run_id} ${pathField} escapes its run root`);
      }
      const bytes = await readFile(artifactFile);
      const actualHash = createHash("sha256").update(bytes).digest("hex");
      if (actualHash !== expectedHash) {
        throw new Error(`Run ${run.run_id} ${pathField} hash mismatch`);
      }
      if (
        pathField === "raw_events" &&
        run.kind === "single-process-two-turn-parent-return-diagnostic"
      ) {
        const parsed = parseJsonLines(bytes.toString("utf8"));
        const resultCount = parsed.events.filter(
          (event) => event.type === "result",
        ).length;
        const initCount = parsed.events.filter(
          (event) => event.type === "system" && event.subtype === "init",
        ).length;
        const replayedUserCount = parsed.events.filter(
          (event) => event.type === "user",
        ).length;
        if (
          parsed.errors.length !== 0 ||
          resultCount !== 2 ||
          initCount < 1 ||
          replayedUserCount < 2
        ) {
          throw new Error(
            `Diagnostic ${run.diagnostic_id} is not one streamed two-turn session`,
          );
        }
      }
    }
  }
  return artifact;
}

/** @param {unknown} artifactValue */
export function assertPublishableSuiteStructure(artifactValue) {
  if (!isRecord(artifactValue) || !Array.isArray(artifactValue.runs)) {
    throw new TypeError("Publishable suite must contain runs");
  }
  if (
    artifactValue.kind !== "live-headline-suite" ||
    artifactValue.synthetic !== false ||
    artifactValue.publishable !== false ||
    !Array.isArray(artifactValue.lanes) ||
    JSON.stringify(artifactValue.lanes) !==
      JSON.stringify(["build", "render"]) ||
    !Number.isInteger(artifactValue.repetitions) ||
    Number(artifactValue.repetitions) < 5
  ) {
    throw new Error("Publishable suite top-level contract is incomplete");
  }
  const repetitions = Number(artifactValue.repetitions);
  const runs = artifactValue.runs.map(
    (run) => /** @type {Record<string, any>} */ (assertPublishableRun(run)),
  );
  if (runs.length !== repetitions * HEADLINE_ARMS.length * 2) {
    throw new Error(
      "Suite run count does not match lanes, arms, and repetitions",
    );
  }
  if (
    !Array.isArray(artifactValue.execution_order) ||
    artifactValue.execution_order.length !== runs.length
  ) {
    throw new Error("Suite execution order does not match headline runs");
  }
  if (
    typeof artifactValue.seed !== "string" ||
    artifactValue.seed.length === 0
  ) {
    throw new Error("Publishable suite requires a recorded randomization seed");
  }
  const expectedOrders = balancedArmOrders(repetitions, artifactValue.seed);
  const expectedExecution = [];
  for (const lane of ["build", "render"]) {
    for (const order of expectedOrders) {
      for (const [orderIndex, arm] of order.arms.entries()) {
        const run = runs.find(
          (candidate) =>
            candidate.lane === lane &&
            candidate.repetition === order.repetition &&
            candidate.arm === arm,
        );
        if (
          !run ||
          run.isolation?.suite_seed !== artifactValue.seed ||
          JSON.stringify(run.isolation?.suite_arm_order) !==
            JSON.stringify(order.arms) ||
          run.isolation?.suite_order_index !== orderIndex
        ) {
          throw new Error("Run isolation does not match balanced suite order");
        }
        expectedExecution.push({
          lane,
          repetition: order.repetition,
          order_index: orderIndex,
          arm,
          run_id: run.run_id,
        });
      }
    }
  }
  if (
    JSON.stringify(artifactValue.execution_order) !==
    JSON.stringify(expectedExecution)
  ) {
    throw new Error("Recorded execution order differs from seeded arm order");
  }
  if (runs.some((run) => run.variant !== "headline")) {
    throw new Error("Diagnostic variants cannot enter headline publication");
  }
  const lanes = new Set(runs.map((run) => run.lane));
  if (!lanes.has("build") || !lanes.has("render") || lanes.size !== 2) {
    throw new Error(
      "Publishable G010 requires separate build and render lanes",
    );
  }

  const comparablePins = [
    "manifest_sha256",
    "file_set_sha256",
    "ponytail_commit",
    "model_requested",
    "effort_requested",
    "cli_version",
  ];
  const first = runs[0];
  for (const run of runs) {
    if (run.host_cli_version !== CLAUDE_CLI_VERSION) {
      throw new Error(`Run ${run.run_id} has an unpinned Claude CLI`);
    }
    if (
      !isRecord(run.pins) ||
      run.pins.model_requested !== PARENT_MODEL_ID ||
      run.pins.effort_requested !== PARENT_EFFORT
    ) {
      throw new Error(`Run ${run.run_id} has an unpinned parent model`);
    }
    for (const key of comparablePins) {
      if (run.pins[key] !== first.pins[key]) {
        throw new Error(`Run ${run.run_id} differs on comparable pin ${key}`);
      }
    }
    for (const path of [
      ["metrics", "usage", "input_fresh_tokens"],
      ["metrics", "usage", "input_cache_read_tokens"],
      ["metrics", "usage", "input_cache_create_tokens"],
      ["metrics", "usage", "input_total_tokens"],
      ["metrics", "usage", "output_tokens"],
    ]) {
      requireMetric(run, path, ["measured", "derived"]);
    }
    requireMetric(
      run,
      ["metrics", "cost_usd"],
      ["measured", "derived", "estimated"],
    );
    requireMetric(run, ["metrics", "latency", "wall_time_ms"], ["measured"]);
    requireMetric(
      run,
      ["metrics", "delegation", "child_group_count"],
      ["measured", "derived"],
    );
    requireMetric(
      run,
      ["metrics", "fallback", "fallback_used"],
      ["measured", "derived"],
    );
    if (run.lane === "render") {
      requireTrueGate(run, "explanation_gate");
      requireMetric(
        run,
        ["metrics", "explanation_proxy", "score"],
        ["measured", "derived"],
      );
    }
  }

  /** @type {Map<string, Map<string, Record<string, any>[]>>} */
  const cells = new Map();
  for (const run of runs) {
    const key = `${run.lane}\0${run.task_id}`;
    const cell = cells.get(key) ?? new Map();
    const armRuns = cell.get(run.arm) ?? [];
    armRuns.push(run);
    cell.set(run.arm, armRuns);
    cells.set(key, cell);
  }
  if (cells.size !== 2) {
    throw new Error("Publishable G010 requires exactly one task per lane");
  }
  const expectedRepetitions = Array.from(
    { length: repetitions },
    (_, index) => index + 1,
  );
  for (const [key, cell] of cells) {
    for (const arm of HEADLINE_ARMS) {
      const armRuns = cell.get(arm) ?? [];
      const observed = armRuns
        .map((run) => run.repetition)
        .sort((left, right) => left - right);
      if (
        armRuns.length !== repetitions ||
        new Set(observed).size !== repetitions ||
        JSON.stringify(observed) !== JSON.stringify(expectedRepetitions)
      ) {
        throw new Error(
          `Publishable cell ${key} has missing or duplicate repetitions for ${arm}`,
        );
      }
    }
  }
  const recomputedStatistics = summarizeHeadlineRuns(runs);
  if (
    JSON.stringify(artifactValue.statistics) !==
    JSON.stringify(recomputedStatistics)
  ) {
    throw new Error("Suite statistics do not match recomputed raw-run values");
  }
  assertTwoTurnCacheDiagnostic(
    artifactValue.cache_diagnostic,
    /** @type {Record<string, any>} */ (first.pins),
  );
  return artifactValue;
}

/** @param {unknown} value @param {Record<string, any>} headlinePins */
function assertTwoTurnCacheDiagnostic(value, headlinePins) {
  if (
    !isRecord(value) ||
    value.kind !==
      "single-process-two-turn-agent-vs-skill-parent-return-diagnostic" ||
    value.savings_claimed !== false ||
    !Array.isArray(value.variants) ||
    value.variants.length !== 2
  ) {
    throw new Error(
      "A single-process two-turn agent-vs-skill parent-return diagnostic is required",
    );
  }
  const diagnostic = /** @type {Record<string, any>} */ (value);
  const variants = /** @type {Record<string, any>[]} */ (diagnostic.variants);
  for (const variant of ["fairytail-agent", "fairytail-skill-override"]) {
    const run = variants.find((candidate) => candidate.variant === variant);
    if (
      !run ||
      run.kind !== "single-process-two-turn-parent-return-diagnostic" ||
      run.synthetic !== false ||
      run.complete !== true ||
      run.turns_expected !== 2 ||
      run.savings_claimed !== false ||
      !Array.isArray(run.turns) ||
      run.turns.length !== 2 ||
      !isRecord(run.pins) ||
      run.pins.verified !== true ||
      run.pins.manifest_sha256 !== headlinePins.manifest_sha256 ||
      run.pins.file_set_sha256 !== headlinePins.file_set_sha256 ||
      run.pins.model_requested !== PARENT_MODEL_ID ||
      run.pins.effort_requested !== PARENT_EFFORT ||
      run.pins.renderer_model_requested !== RENDERER_MODEL_ID ||
      run.pins.first_turn_model_requested !==
        (variant === "fairytail-skill-override"
          ? RENDERER_MODEL_ID
          : PARENT_MODEL_ID) ||
      run.pins.second_turn_model_requested !== PARENT_MODEL_ID ||
      run.pins.cli_version !== CLAUDE_CLI_VERSION ||
      run.pins.plugin_activation_verified !== true ||
      (variant === "fairytail-agent" &&
        run.pins.agent_capability_verified !== true) ||
      run.isolation?.one_process !== true ||
      run.isolation?.streamed_user_messages !== 2 ||
      run.isolation?.result_gated_second_message !== true ||
      run.isolation?.no_session_persistence !== true ||
      run.isolation?.hooks_suppressed_for_isolation !== true
    ) {
      throw new Error(`Cache diagnostic ${variant} is incomplete or unpinned`);
    }
    const [first, second] = run.turns;
    if (
      first.turn !== 1 ||
      first.route !== variant ||
      second.turn !== 2 ||
      second.route !== "parent-return" ||
      first.output_valid !== true ||
      second.output_valid !== true ||
      first.model?.requested?.value !==
        (variant === "fairytail-skill-override"
          ? RENDERER_MODEL_ID
          : PARENT_MODEL_ID) ||
      second.model?.requested?.value !== PARENT_MODEL_ID ||
      first.model?.exact_match?.value !== true ||
      second.model?.exact_match?.value !== true ||
      !isRecord(first.raw?.model_usage) ||
      !Object.hasOwn(first.raw.model_usage, RENDERER_MODEL_ID) ||
      !isRecord(second.raw?.model_usage) ||
      !Object.hasOwn(second.raw.model_usage, PARENT_MODEL_ID) ||
      first.delegation?.requested?.value !== (variant === "fairytail-agent") ||
      second.delegation?.requested?.value !== false ||
      second.delegation?.child_group_count?.value !== 0
    ) {
      throw new Error(
        `Cache diagnostic ${variant} lacks parent-return evidence`,
      );
    }
    for (const turn of [first, second]) {
      if (
        !isRecord(turn.usage) ||
        !isRecord(turn.cost_usd) ||
        !isRecord(turn.latency) ||
        !isRecord(turn.delegation)
      ) {
        throw new Error(`Cache diagnostic ${variant} turn telemetry is absent`);
      }
      requireMetric(
        turn,
        ["usage", "input_cache_read_tokens"],
        ["measured", "derived"],
      );
      requireMetric(
        turn,
        ["usage", "input_cache_create_tokens"],
        ["measured", "derived"],
      );
      requireMetric(
        turn,
        ["usage", "input_total_tokens"],
        ["measured", "derived"],
      );
      requireMetric(turn, ["usage", "output_tokens"], ["measured", "derived"]);
      requireMetric(turn, ["cost_usd"], ["measured", "derived", "estimated"]);
    }
    if (
      !Array.isArray(run.limitations) ||
      /** @type {string[]} */ (run.limitations).every(
        (item) => !/No cache or cost saving/u.test(item),
      )
    ) {
      throw new Error(
        `Cache diagnostic ${variant} must explicitly forbid an automatic saving claim`,
      );
    }
  }
}

/** @param {Record<string, any>} run @param {string} gate */
function requireTrueGate(run, gate) {
  const value = run.outcome?.[gate];
  assertMetricEnvelope(value);
  if (value.value !== true) {
    throw new Error(`Run ${run.run_id} failed ${gate}`);
  }
}

/** @param {Record<string, any>} run @param {string[]} path @param {string[]} statuses */
function requireMetric(run, path, statuses) {
  let value = run;
  for (const key of path) value = value?.[key];
  assertMetricEnvelope(value);
  if (!statuses.includes(value.status) || value.value === null) {
    throw new Error(
      `Run ${run.run_id} lacks publishable ${path.join(".")} telemetry`,
    );
  }
}

/** @param {unknown} placeholder */
function verifyMeasuredPlaceholder(placeholder) {
  if (
    !isRecord(placeholder) ||
    placeholder.kind !== "measured-results-placeholder" ||
    placeholder.publishable !== false ||
    placeholder.synthetic !== false ||
    !Array.isArray(placeholder.runs) ||
    placeholder.runs.length !== 0
  ) {
    throw new TypeError("Measured-results placeholder contract is invalid");
  }
  assertMetricEnvelope(placeholder.status);
  if (
    !isRecord(placeholder.status) ||
    placeholder.status.status !== "unavailable"
  ) {
    throw new TypeError("Measured-results placeholder must be unavailable");
  }
  try {
    verifyRunSuite(placeholder, true);
  } catch {
    return placeholder;
  }
  throw new Error(
    "Measured-results placeholder unexpectedly passed publication guard",
  );
}
