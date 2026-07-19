#!/usr/bin/env node

import { lstat, mkdir, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { runLiveClaudeBenchmark } from "../src/benchmark/live-claude.mjs";
import { createG011Summary } from "../src/benchmark/g011-summary.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const options = argumentsFrom(process.argv.slice(2));
if (!options.acknowledgeApiSpend) {
  throw new Error("Use --acknowledge-api-spend for the five live runs");
}
const artifactRoot = resolve(required(options.artifacts, "--artifacts"));
const summaryPath = resolve(required(options.summary, "--summary"));
assertOutsideProject(root, artifactRoot);
await assertProspectiveRawArtifactRoot(root, artifactRoot);
await mkdir(artifactRoot, { recursive: true });
await assertSafeRawArtifactRoot(root, artifactRoot);
await mkdir(dirname(summaryPath), { recursive: true });

const runs = [];
const runPins = [];
for (let repetition = 1; repetition <= 5; repetition += 1) {
  const result = await runLiveClaudeBenchmark(root, {
    claudeBin: "claude",
    model: "claude-sonnet-4-6",
    arm: "fairytail-local",
    variant: "headline",
    artifactRoot,
    acknowledgeApiSpend: true,
    maxBudgetUsd: 0.25,
    timeoutMs: 300_000,
    effort: "high",
    repetition,
  });
  const record = result.record;
  if (
    record.outcome.completed.value !== true ||
    record.outcome.hard_gate_passed.value !== true
  ) {
    throw new Error(`G011 build run ${repetition} failed its hard gate`);
  }
  runPins.push({
    manifest_sha256: record.pins.manifest_sha256,
    file_set_sha256: record.pins.file_set_sha256,
    claude_cli_version: record.host_cli_version,
  });
  runs.push({
    repetition,
    complete: true,
    correctness_gate: record.outcome.correctness_gate.value,
    safety_gate: record.outcome.safety_gate.value,
    source_added_loc: measured(record.metrics.diff.source_added_loc),
    source_deleted_loc: measured(record.metrics.diff.source_deleted_loc),
    changed_file_count: measured(record.metrics.diff.changed_file_count),
    runtime_dependencies_added: measured(
      record.metrics.dependencies.runtime_added,
    ),
    input_total_tokens: measured(record.metrics.usage.input_total_tokens),
    output_tokens: measured(record.metrics.usage.output_tokens),
    estimated_cost_usd: measured(record.metrics.cost_usd),
    wall_time_ms: measured(record.metrics.latency.wall_time_ms),
    raw_events_sha256: record.artifacts.raw_events_sha256,
    diff_sha256: record.artifacts.diff_sha256,
  });
}

const commonPins = identicalRunPins(runPins);
if (!commonPins) throw new Error("G011 live run pins are unavailable");
const summary = await createG011Summary({ root, runs, commonPins });

await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);

/** @param {unknown} value @returns {any} */
function measured(value) {
  if (
    typeof value !== "object" ||
    value === null ||
    !("value" in value) ||
    value.value === null
  ) {
    throw new TypeError("Required benchmark metric is unavailable");
  }
  return /** @type {any} */ (value).value;
}

/** @param {any[]} runsValue */
function identicalRunPins(runsValue) {
  if (runsValue.length === 0) return null;
  const first = {
    manifest_sha256: runsValue[0].manifest_sha256,
    file_set_sha256: runsValue[0].file_set_sha256,
    claude_cli_version: runsValue[0].claude_cli_version,
  };
  if (
    runsValue.some(
      (run) =>
        run.manifest_sha256 !== first.manifest_sha256 ||
        run.file_set_sha256 !== first.file_set_sha256 ||
        run.claude_cli_version !== first.claude_cli_version,
    )
  ) {
    throw new Error(
      "G011 live runs do not share one manifest/file-set/CLI pin",
    );
  }
  return first;
}

/** @param {string} projectRoot @param {string} artifactRootValue */
function assertOutsideProject(projectRoot, artifactRootValue) {
  const path = relative(projectRoot, artifactRootValue);
  if (path === "" || (!path.startsWith("..") && !isAbsolute(path))) {
    throw new Error("Raw G011 artifacts must stay outside the repository");
  }
}

/** @param {string} projectRoot @param {string} artifactRootValue */
async function assertSafeRawArtifactRoot(projectRoot, artifactRootValue) {
  const info = await lstat(artifactRootValue);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error("Raw G011 artifact root must be a real directory");
  }
  assertOutsideProject(
    await realpath(projectRoot),
    await realpath(artifactRootValue),
  );
}

/**
 * Resolve the nearest existing ancestor before mkdir so an outside-looking path
 * cannot create its final directory inside the repository through a symlinked
 * parent. The completed directory is checked again after creation.
 *
 * @param {string} projectRoot
 * @param {string} artifactRootValue
 */
async function assertProspectiveRawArtifactRoot(
  projectRoot,
  artifactRootValue,
) {
  let existingAncestor = artifactRootValue;
  while (true) {
    try {
      await lstat(existingAncestor);
      break;
    } catch (error) {
      if (
        typeof error !== "object" ||
        error === null ||
        !("code" in error) ||
        error.code !== "ENOENT"
      ) {
        throw error;
      }
      const parent = dirname(existingAncestor);
      if (parent === existingAncestor) throw error;
      existingAncestor = parent;
    }
  }
  const projectedTarget = resolve(
    await realpath(existingAncestor),
    relative(existingAncestor, artifactRootValue),
  );
  assertOutsideProject(await realpath(projectRoot), projectedTarget);
}

/** @param {string[]} args */
function argumentsFrom(args) {
  /** @type {{ acknowledgeApiSpend: boolean, artifacts: string | undefined, summary: string | undefined }} */
  const parsed = {
    acknowledgeApiSpend: false,
    artifacts: undefined,
    summary: undefined,
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--acknowledge-api-spend") {
      parsed.acknowledgeApiSpend = true;
      continue;
    }
    const value = args[index + 1];
    if (!value) throw new TypeError(`${argument} requires a value`);
    if (argument === "--artifacts") parsed.artifacts = value;
    else if (argument === "--summary") parsed.summary = value;
    else throw new TypeError(`Unknown argument: ${argument}`);
    index += 1;
  }
  return parsed;
}

/** @param {string | undefined} value @param {string} flag */
function required(value, flag) {
  if (!value) throw new TypeError(`${flag} is required`);
  return value;
}
