#!/usr/bin/env node

import { dirname, resolve } from "node:path";
import { stderr, stdout } from "node:process";
import { fileURLToPath } from "node:url";

import { PARENT_MODEL_ID } from "../src/benchmark/contracts.mjs";
import { runOfflineSyntheticBenchmark } from "../src/benchmark/harness.mjs";
import { runLiveClaudeRenderBenchmark } from "../src/benchmark/live-claude.mjs";
import { runLiveClaudeSuite } from "../src/benchmark/suite.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

try {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    stdout.write(helpText());
  } else if (options.liveClaude) {
    const common = {
      claudeBin:
        options.claudeBin ?? process.env.FAIRYTAIL_CLAUDE_BIN ?? "claude",
      model: options.model ?? PARENT_MODEL_ID,
      artifactRoot: resolve(required(options.artifacts, "--artifacts")),
      acknowledgeApiSpend: options.acknowledgeApiSpend,
      maxBudgetUsd: options.maxBudgetUsd,
      timeoutMs: options.timeoutMs,
      effort: options.effort,
      ponytailPluginDir: options.ponytailPluginDir,
    };
    if (
      options.variant === "fairytail-agent" ||
      options.variant === "fairytail-skill-override"
    ) {
      const result = await runLiveClaudeRenderBenchmark(root, {
        ...common,
        arm: required(options.arm, "--arm"),
        variant: options.variant,
      });
      stdout.write(`${JSON.stringify(result.record, null, 2)}\n`);
    } else {
      const result = await runLiveClaudeSuite(root, {
        ...common,
        repetitions: options.repetitions,
        seed: options.seed,
        lane: options.lane,
        includeCacheDiagnostic: options.cacheDiagnostic,
      });
      stdout.write(`${JSON.stringify(result.suite, null, 2)}\n`);
    }
  } else {
    const result = await runOfflineSyntheticBenchmark(root, {
      artifactRoot: options.artifacts ? resolve(options.artifacts) : undefined,
    });
    stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }
} catch (error) {
  stderr.write(
    `G010 benchmark failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}

/** @param {string[]} args */
function parseArguments(args) {
  /** @type {{help: boolean, liveClaude: boolean, acknowledgeApiSpend: boolean, cacheDiagnostic: boolean, model?: string, arm?: string, variant?: string, artifacts?: string, claudeBin?: string, maxBudgetUsd?: number, timeoutMs?: number, effort?: string, ponytailPluginDir?: string, repetitions: number, seed: string, lane: "build"|"render"|"both"}} */
  const result = {
    help: false,
    liveClaude: false,
    acknowledgeApiSpend: false,
    cacheDiagnostic: false,
    repetitions: 1,
    seed: "g010-default-seed",
    lane: "both",
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") result.help = true;
    else if (argument === "--live-claude") result.liveClaude = true;
    else if (argument === "--acknowledge-api-spend") {
      result.acknowledgeApiSpend = true;
    } else if (argument === "--cache-diagnostic") {
      result.cacheDiagnostic = true;
    } else {
      const value = args[index + 1];
      if (value === undefined) {
        throw new TypeError(`${argument} requires a value`);
      }
      if (argument === "--model") result.model = value;
      else if (argument === "--arm") result.arm = value;
      else if (argument === "--variant") result.variant = value;
      else if (argument === "--artifacts") result.artifacts = value;
      else if (argument === "--claude-bin") result.claudeBin = value;
      else if (argument === "--max-budget-usd") {
        result.maxBudgetUsd = Number(value);
      } else if (argument === "--timeout-ms") {
        result.timeoutMs = Number(value);
      } else if (argument === "--effort") result.effort = value;
      else if (argument === "--ponytail-plugin-dir") {
        result.ponytailPluginDir = value;
      } else if (argument === "--repetitions") {
        result.repetitions = Number(value);
      } else if (argument === "--seed") result.seed = value;
      else if (argument === "--lane") {
        if (value !== "build" && value !== "render" && value !== "both") {
          throw new TypeError("--lane must be build, render, or both");
        }
        result.lane = value;
      } else throw new TypeError(`Unknown argument: ${argument}`);
      index += 1;
    }
  }
  return result;
}

/** @param {string|number|boolean|undefined} value @param {string} flag */
function required(value, flag) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${flag} is required`);
  }
  return value;
}

function helpText() {
  return `G010 benchmark

Offline deterministic CI (default; no network/model):
  node scripts/benchmark-g010.mjs [--artifacts DIR]

Explicit live Claude suite:
  node scripts/benchmark-g010.mjs --live-claude --acknowledge-api-spend \
    --model claude-sonnet-4-6 --lane both --repetitions 5 --seed discovery-1 \
    --cache-diagnostic \
    --artifacts DIR --ponytail-plugin-dir DIR

The headline suite always runs baseline, pinned Ponytail, and Fairytail-local in
a balanced seed-recorded order. Ponytail must be exact commit
16f29800fd2681bdf24f3eb4ccffe38be3baec6b with its pinned skill bytes.
Diagnostic render-only variants require --arm fairytail-local and either
--variant fairytail-agent or --variant fairytail-skill-override.
Automatic model fallback is intentionally unsupported.
`;
}
