import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { summarizeSeries } from "./statistics.mjs";

/**
 * Build the committed G011 summary shape from already completed live records.
 * Keeping this pure summary contract outside the spending runner lets offline
 * tests prove that a documented rerun will still satisfy the verifier.
 *
 * @param {{
 *   root: string,
 *   runs: Record<string, any>[],
 *   commonPins: { claude_cli_version: string, manifest_sha256: string, file_set_sha256: string },
 *   createdAt?: Date
 * }} input
 */
export async function createG011Summary(input) {
  if (input.runs.length !== 5) {
    throw new TypeError("G011 summary requires exactly five completed runs");
  }
  return {
    artifact_version: 2,
    benchmark_id: "g011-fairytail-current-build",
    created_at: (input.createdAt ?? new Date()).toISOString(),
    synthetic: false,
    publishable: false,
    verification_scope: "arithmetic-and-summary-pins-only",
    status: "pass",
    lane: "build",
    arm: "fairytail-current",
    task_id: "safe-relative-note-path",
    repetitions: input.runs.length,
    pins: {
      claude_cli_version: input.commonPins.claude_cli_version,
      model: "claude-sonnet-4-6",
      effort: "high",
      manifest_sha256: input.commonPins.manifest_sha256,
      file_set_sha256: input.commonPins.file_set_sha256,
      build_skill_sha256: hash(
        await readFile(resolve(input.root, "skills/build/SKILL.md")),
      ),
      ponytail_commit: "16f29800fd2681bdf24f3eb4ccffe38be3baec6b",
    },
    runs: input.runs,
    statistics: {
      source_added_loc: summarize(
        input.runs.map((run) => run.source_added_loc),
        "g011:source-added-loc",
      ),
      input_total_tokens: summarize(
        input.runs.map((run) => run.input_total_tokens),
        "g011:input-total-tokens",
      ),
      output_tokens: summarize(
        input.runs.map((run) => run.output_tokens),
        "g011:output-tokens",
      ),
      estimated_cost_usd: summarize(
        input.runs.map((run) => run.estimated_cost_usd),
        "g011:estimated-cost-usd",
      ),
      wall_time_ms: summarize(
        input.runs.map((run) => run.wall_time_ms),
        "g011:wall-time-ms",
      ),
    },
    limitations: [
      "This is a current Fairytail-only snapshot with no same-batch comparison arm.",
      "Repeated runs share one small task and do not represent independent task diversity.",
      "Claude Code cost is a client-side estimate rather than authoritative billing.",
      "Build-lane results do not measure human comprehension.",
      "Raw event directories stayed outside the repository; this summary retains gate values and source hashes only.",
      "Without the private raw streams and diffs, the committed summary independently verifies arithmetic and summary pins, not the recorded gate decisions.",
    ],
  };
}

/** @param {number[]} values @param {string} source */
function summarize(values, source) {
  const result = summarizeSeries(values, source);
  return {
    raw: result.raw.value,
    n: result.n.value,
    mean: result.mean.value,
    sample_sd: result.sample_sd.value,
    median: result.median.value,
    q1: result.q1.value,
    q3: result.q3.value,
    iqr: result.iqr.value,
  };
}

/** @param {Buffer} value */
function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}
