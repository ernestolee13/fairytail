import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";

import { HEADLINE_ARMS } from "./contracts.mjs";
import {
  runLiveClaudeBenchmark,
  runLiveClaudeRenderBenchmark,
  runLiveClaudeTwoTurnDiagnostic,
} from "./live-claude.mjs";
import { summarizeSeries } from "./statistics.mjs";

/**
 * Run balanced, seed-recorded headline cells. Diagnostic variants remain
 * separate single-cell experiments and are intentionally excluded here.
 *
 * @param {string} pluginRoot
 * @param {{claudeBin: string, model: string, artifactRoot: string, acknowledgeApiSpend: boolean, repetitions: number, seed: string, lane?: "build"|"render"|"both", includeCacheDiagnostic?: boolean, maxBudgetUsd?: number, timeoutMs?: number, effort?: string, ponytailPluginDir?: string}} options
 */
export async function runLiveClaudeSuite(pluginRoot, options) {
  assertRepetitions(options.repetitions);
  if (typeof options.seed !== "string" || options.seed.length === 0) {
    throw new TypeError("Suite seed must be a non-empty string");
  }
  const laneOption = options.lane ?? "both";
  if (!["build", "render", "both"].includes(laneOption)) {
    throw new TypeError(`Unsupported suite lane: ${laneOption}`);
  }
  const lanes = laneOption === "both" ? ["build", "render"] : [laneOption];
  const orders = balancedArmOrders(options.repetitions, options.seed);
  await mkdir(options.artifactRoot, { recursive: true });

  /** @type {Record<string, any>[]} */
  const runs = [];
  const executionOrder = [];
  for (const lane of lanes) {
    for (const order of orders) {
      for (const [orderIndex, arm] of order.arms.entries()) {
        const runner =
          lane === "build"
            ? runLiveClaudeBenchmark
            : runLiveClaudeRenderBenchmark;
        const result = await runner(pluginRoot, {
          claudeBin: options.claudeBin,
          model: options.model,
          arm,
          variant: "headline",
          artifactRoot: options.artifactRoot,
          acknowledgeApiSpend: options.acknowledgeApiSpend,
          maxBudgetUsd: options.maxBudgetUsd,
          timeoutMs: options.timeoutMs,
          effort: options.effort,
          ponytailPluginDir: options.ponytailPluginDir,
          repetition: order.repetition,
        });
        const record = /** @type {Record<string, any>} */ (result.record);
        record.isolation.suite_seed = options.seed;
        record.isolation.suite_arm_order = [...order.arms];
        record.isolation.suite_order_index = orderIndex;
        record.artifacts.root = relative(
          options.artifactRoot,
          result.artifactRoot,
        );
        await writeFile(
          resolve(result.artifactRoot, "run.json"),
          `${JSON.stringify(record, null, 2)}\n`,
        );
        runs.push(record);
        executionOrder.push({
          lane,
          repetition: order.repetition,
          order_index: orderIndex,
          arm,
          run_id: record.run_id,
        });
      }
    }
  }

  const cacheDiagnostic = options.includeCacheDiagnostic
    ? await runCacheDiagnostic(pluginRoot, options)
    : null;
  const suite = {
    artifact_version: 1,
    benchmark_id: "g010",
    kind: "live-headline-suite",
    synthetic: false,
    publishable: false,
    created_at: new Date().toISOString(),
    seed: options.seed,
    repetitions: options.repetitions,
    lanes,
    execution_order: executionOrder,
    runs,
    statistics: summarizeHeadlineRuns(runs),
    cache_diagnostic: cacheDiagnostic,
  };
  const suitePath = resolve(options.artifactRoot, "suite.json");
  await writeFile(suitePath, `${JSON.stringify(suite, null, 2)}\n`);
  return { suite, suitePath };
}

/** @param {number} repetitions @param {string} seed */
export function balancedArmOrders(repetitions, seed) {
  assertRepetitions(repetitions);
  if (typeof seed !== "string" || seed.length === 0) {
    throw new TypeError("Suite seed must be a non-empty string");
  }
  const random = seededRandom(seed);
  const base = [...HEADLINE_ARMS];
  for (let index = base.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [base[index], base[swap]] = [base[swap], base[index]];
  }
  return Array.from({ length: repetitions }, (_, index) => ({
    repetition: index + 1,
    arms: [
      ...base.slice(index % base.length),
      ...base.slice(0, index % base.length),
    ],
  }));
}

/** @param {Record<string, any>[]} runs */
export function summarizeHeadlineRuns(runs) {
  /** @type {Record<string, any>} */
  const result = {};
  for (const lane of ["build", "render"]) {
    const laneRuns = runs.filter((run) => run.lane === lane);
    if (laneRuns.length === 0) continue;
    result[lane] = {};
    for (const arm of HEADLINE_ARMS) {
      const cells = laneRuns.filter((run) => run.arm === arm);
      result[lane][arm] = {
        source_added_loc: summarizeMetric(
          cells,
          ["metrics", "diff", "source_added_loc"],
          `${lane}:${arm}:source-added-loc`,
        ),
        input_total_tokens: summarizeMetric(
          cells,
          ["metrics", "usage", "input_total_tokens"],
          `${lane}:${arm}:input-total-tokens`,
        ),
        output_tokens: summarizeMetric(
          cells,
          ["metrics", "usage", "output_tokens"],
          `${lane}:${arm}:output-tokens`,
        ),
        cost_usd: summarizeMetric(
          cells,
          ["metrics", "cost_usd"],
          `${lane}:${arm}:cost-usd`,
        ),
        wall_time_ms: summarizeMetric(
          cells,
          ["metrics", "latency", "wall_time_ms"],
          `${lane}:${arm}:wall-time-ms`,
        ),
        explanation_proxy_score: summarizeMetric(
          cells,
          ["metrics", "explanation_proxy", "score"],
          `${lane}:${arm}:explanation-proxy-score`,
        ),
      };
    }
  }
  return result;
}

/**
 * One process receives two streamed user messages per route: optional renderer
 * first, then a parent-only return turn. No saving is inferred automatically.
 *
 * @param {string} pluginRoot
 * @param {{claudeBin: string, model: string, artifactRoot: string, acknowledgeApiSpend: boolean, maxBudgetUsd?: number, timeoutMs?: number, effort?: string, ponytailPluginDir?: string}} options
 */
async function runCacheDiagnostic(pluginRoot, options) {
  /** @type {Record<string, any>[]} */
  const variants = [];
  const routes = /** @type {const} */ ([
    "fairytail-agent",
    "fairytail-skill-override",
  ]);
  for (const variant of routes) {
    const result = await runLiveClaudeTwoTurnDiagnostic(pluginRoot, {
      claudeBin: options.claudeBin,
      model: options.model,
      variant,
      artifactRoot: options.artifactRoot,
      acknowledgeApiSpend: options.acknowledgeApiSpend,
      maxBudgetUsd: options.maxBudgetUsd,
      timeoutMs: options.timeoutMs,
      effort: options.effort,
    });
    const diagnostic = /** @type {Record<string, any>} */ (result.diagnostic);
    diagnostic.artifacts.root = relative(
      options.artifactRoot,
      result.artifactRoot,
    );
    await writeFile(
      resolve(result.artifactRoot, "diagnostic.json"),
      `${JSON.stringify(diagnostic, null, 2)}\n`,
    );
    variants.push(diagnostic);
  }
  return {
    kind: "single-process-two-turn-agent-vs-skill-parent-return-diagnostic",
    savings_claimed: false,
    variants,
  };
}

/** @param {Record<string, any>[]} runs @param {string[]} path @param {string} source */
function summarizeMetric(runs, path, source) {
  const values = runs.flatMap((run) => {
    let value = run;
    for (const key of path) value = value?.[key];
    return typeof value?.value === "number" && Number.isFinite(value.value)
      ? [value.value]
      : [];
  });
  return summarizeSeries(values, source);
}

/** @param {number} repetitions */
function assertRepetitions(repetitions) {
  if (!Number.isInteger(repetitions) || repetitions < 1) {
    throw new TypeError("repetitions must be an integer of at least 1");
  }
}

/** @param {string} seed */
function seededRandom(seed) {
  let state = createHash("sha256").update(seed).digest().readUInt32LE(0);
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
