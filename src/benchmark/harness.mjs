import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { HEADLINE_ARMS, metric, unavailableMetric } from "./contracts.mjs";
import {
  analyzeWorkspaceDiff,
  applyWorkspaceOverlay,
  createIsolatedGitWorkspace,
} from "./diff.mjs";
import { loadAndVerifyManifest } from "./manifest.mjs";
import { validateBenchmarkRun } from "./record.mjs";
import {
  runScorerSelftests,
  scoreExplanationPair,
  scoreSafePathWorkspace,
} from "./scoring.mjs";
import { summarizeSeries } from "./statistics.mjs";

const FIXED_CREATED_AT = "2026-07-18T00:00:00.000Z";

/**
 * Offline deterministic instrument run. It invokes no model and no network.
 * Its output is synthetic evidence about the harness, never product evidence.
 *
 * @param {string} pluginRoot
 * @param {{artifactRoot?: string}} [options]
 */
export async function runOfflineSyntheticBenchmark(pluginRoot, options = {}) {
  const benchmarkRoot = resolve(pluginRoot, "benchmarks", "g010");
  const manifestPath = resolve(benchmarkRoot, "manifest.lock.json");
  const verified = await loadAndVerifyManifest(manifestPath);
  const scorerSelftest = await runScorerSelftests(benchmarkRoot);
  const artifactRoot =
    options.artifactRoot ??
    (await mkdtemp(join(tmpdir(), "fairytail-g010-offline-artifacts-")));
  await mkdir(artifactRoot, { recursive: true });

  const explanationRoot = resolve(benchmarkRoot, "fixtures", "explanation");
  const [english, korean] = await Promise.all(
    ["good-en.json", "good-ko.json"].map(async (name) =>
      JSON.parse(await readFile(resolve(explanationRoot, name), "utf8")),
    ),
  );
  const explanation = scoreExplanationPair(english, korean, {
    canonicalFactHash:
      "5e9a7d2d58f2676a42e4fa1c5bc7d30c75041b27a4ccf1d2256e46feadf87158",
    conceptIds: ["path-traversal", "trust-boundary"],
    privacyCanary: "PRIVATE_PROFILE_CANARY",
  });

  const fixtureRoot = resolve(benchmarkRoot, "fixtures", "safe-path");
  const runs = [];
  for (const arm of HEADLINE_ARMS) {
    const runArtifactRoot = resolve(artifactRoot, "runs", arm);
    await mkdir(runArtifactRoot, { recursive: true });
    const workspace = await createIsolatedGitWorkspace(
      resolve(fixtureRoot, "base"),
      { artifactRoot: runArtifactRoot },
    );
    await applyWorkspaceOverlay(resolve(fixtureRoot, "arms", arm), workspace);
    const taskScore = await scoreSafePathWorkspace(workspace);
    const diff = await analyzeWorkspaceDiff(workspace);
    await writeFile(resolve(runArtifactRoot, "diff.patch"), diff.patch.text);
    await writeFile(
      resolve(runArtifactRoot, "score.json"),
      `${JSON.stringify(taskScore, null, 2)}\n`,
    );

    const explanationGate = explanation.hard_gate_passed;
    const hardGate =
      taskScore.correctness.passed.value === true &&
      taskScore.safety.passed.value === true &&
      explanationGate.value === true;

    const record = {
      schema_version: 1,
      benchmark_id: "g010",
      run_id: `g010-synthetic-safe-path-${arm}-r1`,
      created_at: FIXED_CREATED_AT,
      synthetic: true,
      measurement_kind: "synthetic-fixture",
      lane: "end-to-end",
      complete: true,
      publishable: false,
      host: "offline-fixture",
      host_cli_version: null,
      arm,
      variant: "headline",
      task_id: "safe-relative-note-path",
      repetition: 1,
      pins: {
        verified: true,
        manifest_sha256: verified.pins.manifest_sha256,
        file_set_sha256: verified.pins.file_set_sha256,
        ponytail_commit: verified.manifest.ponytail_commit,
        fixture_commit: "temporary-git-fixture-HEAD",
        model_requested: null,
        model_resolved: null,
      },
      isolation: {
        workspace: "<temporary-git-workspace>",
        fresh_git_repository: true,
        settings_sources: [],
        network_calls: 0,
        model_calls: 0,
      },
      outcome: {
        completed: metric(true, "measured", "offline-fixture-runner"),
        exit_code: metric(0, "measured", "offline-fixture-runner"),
        correctness_gate: taskScore.correctness.passed,
        safety_gate: taskScore.safety.passed,
        explanation_gate: explanationGate,
        hard_gate_passed: metric(
          hardGate,
          "derived",
          "correctness-safety-and-applicable-explanation-conjunction",
        ),
        failure_reason: metric("none", "measured", "offline-fixture-runner"),
      },
      metrics: {
        diff: {
          source_added_loc: diff.source.added_loc,
          source_deleted_loc: diff.source.deleted_loc,
          source_file_count: diff.source.file_count,
          test_added_loc: diff.test.added_loc,
          test_deleted_loc: diff.test.deleted_loc,
          test_file_count: diff.test.file_count,
          changed_file_count: diff.changed_file_count,
          lock_file_count: diff.lock_file_count,
        },
        dependencies: diff.dependencies,
        usage: unavailableUsage("No model call occurs in deterministic CI"),
        cost_usd: unavailableMetric(
          "offline-fixture-runner",
          "No model call occurs in deterministic CI",
        ),
        latency: {
          wall_time_ms: unavailableMetric(
            "offline-fixture-runner",
            "Harness runtime is not agent latency and is intentionally not compared",
          ),
          provider_duration_ms: unavailableMetric(
            "offline-fixture-runner",
            "No provider call occurs in deterministic CI",
          ),
        },
        delegation: {
          requested: metric(false, "measured", "offline-fixture-runner"),
          child_group_count: metric(0, "measured", "offline-fixture-runner"),
          per_child_usage: unavailableMetric(
            "offline-fixture-runner",
            "No child agent is launched in deterministic CI",
          ),
        },
        fallback: {
          automatic_fallback_enabled: metric(
            false,
            "measured",
            "offline-fixture-runner",
          ),
          fallback_used: metric(false, "measured", "offline-fixture-runner"),
          reason: metric(
            "not applicable",
            "measured",
            "offline-fixture-runner",
          ),
        },
        explanation_proxy: {
          score: explanation.score,
          maximum: explanation.maximum,
          hard_gate_passed: explanation.hard_gate_passed,
        },
        human_comprehension: unavailableMetric(
          "g010-study-boundary",
          "No novice human comprehension study has been run",
        ),
      },
      artifacts: {
        workspace: `runs/${arm}/workspace-*`,
        diff: `runs/${arm}/diff.patch`,
        diff_sha256: diff.patch.sha256,
        score: `runs/${arm}/score.json`,
      },
      limitations: [
        "Synthetic fixtures validate instrumentation only; they are not agent performance results.",
        "One fixture cannot establish cross-task variance or human comprehension.",
        "No tokens, cost, provider latency, model resolution, or delegation overhead are measured offline.",
      ],
    };
    validateBenchmarkRun(record);
    runs.push(record);
  }

  const sourceAddedByArm = Object.fromEntries(
    runs.map((run) => [
      run.arm,
      summarizeSeries(
        [Number(run.metrics.diff.source_added_loc.value)],
        `synthetic:${run.arm}:source-added-loc`,
      ),
    ]),
  );

  return {
    artifact_version: 1,
    benchmark_id: "g010",
    kind: "synthetic-selftest",
    synthetic: true,
    publishable: false,
    created_at: FIXED_CREATED_AT,
    pins: verified.pins,
    scorer_selftest: scorerSelftest,
    runs,
    statistics: {
      source_added_loc_by_arm: sourceAddedByArm,
      limitations: [
        "n=1 fixture summaries expose the statistics shape; sample SD is correctly unavailable.",
        "Publishable stochastic runs should use at least five discovery repetitions and preferably ten per cell.",
        "Report per-task outcomes and use task-level resampling rather than treating repetitions as independent tasks.",
      ],
    },
    artifact_root: "<runtime-artifact-root>",
    artifact_contract_sha256: createHash("sha256")
      .update(
        runs
          .map((run) => `${run.run_id}\0${run.artifacts.diff_sha256}\n`)
          .join(""),
      )
      .digest("hex"),
  };
}

/** @param {string} reason */
export function unavailableUsage(reason) {
  return {
    input_fresh_tokens: unavailableMetric("benchmark-telemetry", reason),
    input_cache_read_tokens: unavailableMetric("benchmark-telemetry", reason),
    input_cache_create_tokens: unavailableMetric("benchmark-telemetry", reason),
    input_total_tokens: unavailableMetric("benchmark-telemetry", reason),
    output_tokens: unavailableMetric("benchmark-telemetry", reason),
    reasoning_output_tokens: unavailableMetric("benchmark-telemetry", reason),
  };
}
