import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { basename, dirname, resolve } from "node:path";

import {
  CLAUDE_CLI_VERSION,
  DIAGNOSTIC_VARIANTS,
  HEADLINE_ARMS,
  PARENT_EFFORT,
  PARENT_MODEL_ID,
  PONYTAIL_COMMIT,
  RENDERER_MODEL_ID,
  isRecord,
  metric,
  unavailableMetric,
} from "./contracts.mjs";
import {
  analyzeWorkspaceDiff,
  createIsolatedGitWorkspace,
  runCommand,
} from "./diff.mjs";
import { loadAndVerifyManifest } from "./manifest.mjs";
import { validateBenchmarkRun } from "./record.mjs";
import {
  runScorerSelftests,
  scoreExplanationPair,
  scoreSafePathWorkspace,
} from "./scoring.mjs";
import { normalizeClaudeTelemetry, parseJsonLines } from "./telemetry.mjs";
import { loadAnalogyRuntime, resolveAnalogy } from "../analogy/engine.mjs";
import { completeOnboarding } from "../profile/onboarding.mjs";
import {
  LEARNING_SECTION_SLOTS,
  createLearningPacket,
} from "../learning/packet.mjs";
import {
  applyExplanationPatch,
  prepareLearningRender,
  validateExplanationPatch,
} from "../learning/render.mjs";

const RESULT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "verification"],
  properties: {
    summary: { type: "string" },
    verification: { type: "string" },
  },
};

export const SKILL_OVERRIDE_MODEL = RENDERER_MODEL_ID;

const EXPLANATION_PACKET_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "schema_version",
    "locale",
    "canonical_fact_hash",
    "concept_ids",
    "analogy",
    "breakpoint",
    "worked_example",
    "progressive_disclosure",
    "verification",
    "teach_back",
    "confusion_pair",
  ],
  properties: {
    schema_version: { const: 1 },
    locale: { enum: ["en", "ko"] },
    canonical_fact_hash: { type: "string", pattern: "^[a-f0-9]{64}$" },
    concept_ids: {
      type: "array",
      // Claude Code 2.1.214 validates --json-schema with a dialect that does
      // not accept Draft 2020-12 prefixItems. The deterministic scorer below
      // still enforces the exact ordered pair.
      items: { enum: ["path-traversal", "trust-boundary"] },
      minItems: 2,
      maxItems: 2,
    },
    analogy: {
      type: "object",
      additionalProperties: false,
      required: ["source_world", "relations"],
      properties: {
        source_world: { type: "string" },
        relations: {
          type: "array",
          minItems: 2,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["source_role", "target_role"],
            properties: {
              source_role: { type: "string" },
              target_role: { type: "string" },
            },
          },
        },
      },
    },
    breakpoint: { type: "string" },
    worked_example: {
      type: "object",
      additionalProperties: false,
      required: ["input", "steps"],
      properties: {
        input: { type: "string" },
        steps: { type: "array", minItems: 2, items: { type: "string" } },
      },
    },
    progressive_disclosure: {
      const: [
        "fact",
        "analogy",
        "breakpoint",
        "example",
        "verification",
        "teach_back",
      ],
    },
    verification: { type: "string" },
    teach_back: { type: "string" },
    confusion_pair: {
      type: "object",
      additionalProperties: false,
      required: ["left", "right", "diagnostic"],
      properties: {
        left: { type: "string" },
        right: { type: "string" },
        diagnostic: { type: "string" },
      },
    },
  },
};

export const RENDER_RESULT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["en", "ko"],
  properties: {
    en: {
      ...EXPLANATION_PACKET_SCHEMA,
      properties: {
        ...EXPLANATION_PACKET_SCHEMA.properties,
        locale: { const: "en" },
      },
    },
    ko: {
      ...EXPLANATION_PACKET_SCHEMA,
      properties: {
        ...EXPLANATION_PACKET_SCHEMA.properties,
        locale: { const: "ko" },
      },
    },
  },
};

const EXPLANATION_PATCH_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "schema_version",
    "packet_id",
    "protected_render_hash",
    "section_order",
    "section_detail",
  ],
  properties: {
    schema_version: { const: 1 },
    packet_id: { type: "string" },
    protected_render_hash: { type: "string", pattern: "^[a-f0-9]{64}$" },
    section_order: {
      type: "array",
      minItems: 8,
      maxItems: 8,
      uniqueItems: true,
      items: { enum: [...LEARNING_SECTION_SLOTS] },
    },
    section_detail: {
      type: "object",
      additionalProperties: false,
      required: [...LEARNING_SECTION_SLOTS],
      properties: Object.fromEntries(
        LEARNING_SECTION_SLOTS.map((slot) => [
          slot,
          { enum: ["full", "compact"] },
        ]),
      ),
    },
  },
};

/**
 * Build the exact Claude Code 2.1.214 invocation. No fallback model is passed.
 * Empty setting sources block user/project/local settings. API-key runs use
 * --bare and a disposable CLAUDE_CONFIG_DIR; OAuth/keychain runs omit --bare
 * so host authentication remains available while settings and MCP stay off.
 *
 * @param {{model: string, arm: string, variant?: string, pluginDir?: string, skillPluginDir?: string, prompt: string, maxBudgetUsd: number, effort?: string, authMode?: "api-key-bare"|"preserve-auth", pluginAgentType?: string, skillCommand?: string, tools?: string, allowedTools?: string, resultSchema?: Record<string, unknown>}} options
 */
export function buildClaudeInvocation(options) {
  assertFullClaudeModelId(options.model);
  const effort = options.effort ?? PARENT_EFFORT;
  if (effort !== PARENT_EFFORT) {
    throw new TypeError(
      `Comparable G010 runs require parent effort ${PARENT_EFFORT}`,
    );
  }
  if (!HEADLINE_ARMS.includes(/** @type {never} */ (options.arm))) {
    throw new TypeError(`Unknown arm: ${options.arm}`);
  }
  const variant = options.variant ?? "headline";
  if (
    variant !== "headline" &&
    !DIAGNOSTIC_VARIANTS.includes(/** @type {never} */ (variant))
  ) {
    throw new TypeError(`Unknown variant: ${variant}`);
  }
  if (variant !== "headline" && options.arm !== "fairytail-local") {
    throw new TypeError("Diagnostic variants are Fairytail-only");
  }
  if (!Number.isFinite(options.maxBudgetUsd) || options.maxBudgetUsd <= 0) {
    throw new TypeError("maxBudgetUsd must be a positive finite number");
  }
  if (options.maxBudgetUsd > 5) {
    throw new RangeError(
      "G010 live runner refuses budgets above USD 5 per cell",
    );
  }
  if (options.arm !== "baseline" && !options.pluginDir) {
    throw new TypeError(`${options.arm} requires an explicit plugin directory`);
  }
  if (variant === "fairytail-agent") {
    if (!options.pluginAgentType) {
      throw new TypeError(
        "fairytail-agent diagnostic requires the exact staged pluginAgentType",
      );
    }
  }
  if (
    variant === "fairytail-skill-override" &&
    (!options.skillCommand ||
      !options.skillCommand.startsWith("/") ||
      !options.skillPluginDir)
  ) {
    throw new TypeError(
      "fairytail-skill-override diagnostic requires a pinned skill plugin and slash skillCommand",
    );
  }

  let prompt = options.prompt;
  if (variant === "fairytail-skill-override") {
    prompt = `${options.skillCommand}\n\n${prompt}`;
  } else if (variant === "fairytail-agent") {
    prompt = `Use the Agent tool exactly once with subagent_type ${options.pluginAgentType}. Give that child only the validated closed presentation packet in this prompt. Do not delegate facts, code, safety, edits, or verification. Return its exact 8-slot order/detail patch without adding prose or fields.\n\n${prompt}`;
  }

  const tools =
    options.tools ??
    (variant === "fairytail-agent"
      ? "Agent"
      : variant === "fairytail-skill-override"
        ? ""
        : "Bash,Edit,Read,Write");
  const authMode = options.authMode ?? "preserve-auth";
  const args = [
    "--print",
    "--model",
    options.model,
    "--effort",
    effort,
    "--output-format",
    "stream-json",
    "--verbose",
    "--forward-subagent-text",
    "--include-hook-events",
    "--no-session-persistence",
    "--permission-mode",
    "dontAsk",
    "--tools",
    tools,
    "--setting-sources",
    authMode === "api-key-bare" ? "" : "project,local",
    "--strict-mcp-config",
    "--mcp-config",
    JSON.stringify({ mcpServers: {} }),
    "--prompt-suggestions",
    "false",
    "--max-budget-usd",
    String(options.maxBudgetUsd),
    // --allowedTools accepts a variadic value in Claude Code 2.1.214. Keep a
    // later named option after it so the baseline's positional prompt cannot
    // be consumed as another allowlist entry when no --plugin-dir follows.
    ...(options.allowedTools ? ["--allowedTools", options.allowedTools] : []),
    "--json-schema",
    JSON.stringify(options.resultSchema ?? RESULT_SCHEMA),
  ];
  if (authMode === "api-key-bare") {
    args.unshift("--bare");
  }
  if (options.pluginDir) args.push("--plugin-dir", options.pluginDir);
  if (options.skillPluginDir) args.push("--plugin-dir", options.skillPluginDir);
  args.push(prompt);
  return args;
}

/**
 * Explicit, credentialed live runner. Callers must acknowledge spend. All
 * deterministic scorer and pin checks run before Claude is launched.
 *
 * @param {string} pluginRoot
 * @param {{claudeBin: string, model: string, arm: string, variant?: string, artifactRoot: string, acknowledgeApiSpend: boolean, maxBudgetUsd?: number, timeoutMs?: number, effort?: string, ponytailPluginDir?: string, repetition?: number}} options
 */
export async function runLiveClaudeBenchmark(pluginRoot, options) {
  if (options.acknowledgeApiSpend !== true) {
    throw new Error(
      "Live model execution requires explicit acknowledgeApiSpend=true",
    );
  }
  assertFullClaudeModelId(options.model);
  assertComparableParentModel(options.model);
  assertRepetition(options.repetition ?? 1);
  if ((options.variant ?? "headline") !== "headline") {
    throw new Error(
      "Diagnostic renderer variants are excluded from the build lane; run them only against the pinned frozen-packet render fixture",
    );
  }
  const benchmarkRoot = resolve(pluginRoot, "benchmarks", "g010");
  const verified = await loadAndVerifyManifest(
    resolve(benchmarkRoot, "manifest.lock.json"),
  );
  await runScorerSelftests(benchmarkRoot);

  const versionResult = await runProcess(
    options.claudeBin,
    ["--version"],
    pluginRoot,
    process.env,
    10_000,
  );
  const version = versionResult.stdout.trim().split(" ")[0];
  if (versionResult.code !== 0 || version !== CLAUDE_CLI_VERSION) {
    throw new Error(
      `G010 pins Claude Code ${CLAUDE_CLI_VERSION}; observed ${versionResult.stdout.trim() || versionResult.stderr.trim()}`,
    );
  }

  let pluginSourceDir;
  let benchmarkPluginName;
  let activationCommand = "";
  /** @type {string[]} */
  const expectedPlugins = [];
  if (options.arm === "ponytail") {
    pluginSourceDir =
      options.ponytailPluginDir ?? process.env.PONYTAIL_PLUGIN_DIR;
    if (!pluginSourceDir) {
      throw new Error("PONYTAIL_PLUGIN_DIR is required for the Ponytail arm");
    }
    await assertPonytailHead(pluginSourceDir, verified.manifest);
    benchmarkPluginName = "ponytail-benchmark";
    activationCommand = "/ponytail-benchmark:ponytail";
    expectedPlugins.push(benchmarkPluginName);
  } else if (options.arm === "fairytail-local") {
    pluginSourceDir = pluginRoot;
    benchmarkPluginName = "fairytail-benchmark";
    activationCommand = "/fairytail-benchmark:build";
    expectedPlugins.push(benchmarkPluginName);
  }

  await mkdir(options.artifactRoot, { recursive: true });
  const runId = `g010-live-${options.arm}-${Date.now()}`;
  const runRoot = resolve(options.artifactRoot, runId);
  await mkdir(runRoot, { recursive: true });
  const pluginDir =
    pluginSourceDir && benchmarkPluginName
      ? await stageHookFreePlugin(
          pluginSourceDir,
          resolve(runRoot, "plugins", benchmarkPluginName),
          benchmarkPluginName,
          options.arm === "ponytail" ? ["skills/ponytail"] : ["skills/build"],
        )
      : undefined;
  const workspace = await createIsolatedGitWorkspace(
    resolve(benchmarkRoot, "fixtures", "safe-path", "base"),
    { artifactRoot: runRoot },
  );
  const configDir = resolve(runRoot, "claude-config");
  const apiKeyAvailable =
    typeof process.env.ANTHROPIC_API_KEY === "string" &&
    process.env.ANTHROPIC_API_KEY.length > 0;
  const authMode = apiKeyAvailable ? "api-key-bare" : "preserve-auth";
  if (apiKeyAvailable) await mkdir(configDir, { recursive: true });
  const task = await readFile(
    resolve(benchmarkRoot, "fixtures", "safe-path", "task.md"),
    "utf8",
  );
  const prompt = `${activationCommand ? `${activationCommand}\n\n` : ""}${task}\n\nWork only in the current repository. Finish by returning the requested structured summary.`;
  const args = buildClaudeInvocation({
    model: options.model,
    arm: options.arm,
    variant: options.variant,
    pluginDir,
    prompt,
    maxBudgetUsd: options.maxBudgetUsd ?? 0.25,
    effort: options.effort,
    authMode,
    // The fixture is disposable and the only permitted shell command is its
    // local Node regression check. This avoids dontAsk silently denying every
    // write while keeping network-capable shell commands outside the allowlist.
    allowedTools: "Edit,Read,Write,Bash(node *)",
  });
  const environment = isolatedClaudeEnvironment(
    apiKeyAvailable ? configDir : null,
  );

  const started = performance.now();
  const commandResult = await runProcess(
    options.claudeBin,
    args,
    workspace,
    environment,
    options.timeoutMs ?? 300_000,
  );
  const wallTimeMs = performance.now() - started;
  const parsed = parseJsonLines(commandResult.stdout);
  const telemetry = normalizeClaudeTelemetry(parsed.events, {
    wallTimeMs,
    modelRequested: options.model,
    delegationRequested: options.variant === "fairytail-agent",
    forwardSubagentText: true,
  });
  const taskScore = await scoreSafePathWorkspace(workspace);
  const diff = await analyzeWorkspaceDiff(workspace);
  const stdoutHash = sha256Text(commandResult.stdout);
  const stderrHash = sha256Text(commandResult.stderr);

  await Promise.all([
    writeFile(resolve(runRoot, "stdout.jsonl"), commandResult.stdout),
    writeFile(resolve(runRoot, "stderr.txt"), commandResult.stderr),
    writeFile(
      resolve(runRoot, "parse-errors.json"),
      `${JSON.stringify(parsed.errors, null, 2)}\n`,
    ),
    writeFile(resolve(runRoot, "diff.patch"), diff.patch.text),
    writeFile(
      resolve(runRoot, "score.json"),
      `${JSON.stringify(taskScore, null, 2)}\n`,
    ),
    writeFile(
      resolve(runRoot, "invocation.json"),
      `${JSON.stringify({ binary: basename(options.claudeBin), args: redactPrompt(args) }, null, 2)}\n`,
    ),
  ]);

  const resultFound = telemetry.raw.result_found === true;
  const initFound = telemetry.raw.init_found === true;
  const modelMatched = telemetry.model.exact_match.value === true;
  const pluginActivation = inspectPluginActivation(
    parsed.events,
    expectedPlugins,
  );
  const completed =
    commandResult.code === 0 &&
    !commandResult.timedOut &&
    parsed.errors.length === 0 &&
    resultFound &&
    initFound &&
    modelMatched &&
    pluginActivation.verified;
  const hardGate =
    completed &&
    taskScore.correctness.passed.value === true &&
    taskScore.safety.passed.value === true;
  const failureReason = completed
    ? "none"
    : failureReasonFor(
        commandResult,
        parsed.errors.length,
        resultFound,
        initFound,
        modelMatched,
        pluginActivation.verified,
      );

  const record = {
    schema_version: 1,
    benchmark_id: "g010",
    run_id: runId,
    created_at: new Date().toISOString(),
    synthetic: false,
    measurement_kind: "live-agent",
    lane: "build",
    complete: completed,
    publishable: false,
    host: "claude-code",
    host_cli_version: version,
    arm: options.arm,
    variant: options.variant ?? "headline",
    task_id: "safe-relative-note-path",
    repetition: options.repetition ?? 1,
    pins: {
      verified: modelMatched && pluginActivation.verified,
      manifest_sha256: verified.pins.manifest_sha256,
      file_set_sha256: verified.pins.file_set_sha256,
      ponytail_commit: verified.manifest.ponytail_commit,
      fixture_commit: await gitHead(workspace),
      model_requested: options.model,
      model_resolved: telemetry.model.resolved.value,
      effort_requested: options.effort ?? PARENT_EFFORT,
      cli_version: version,
      expected_plugins: expectedPlugins,
      plugin_activation_verified: pluginActivation.verified,
    },
    isolation: {
      workspace: `<artifact-root>/${runId}/workspace-*`,
      fresh_git_repository: true,
      claude_config_dir: apiKeyAvailable
        ? `<artifact-root>/${runId}/claude-config`
        : "<host-auth-config-preserved>",
      setting_sources: apiKeyAvailable ? [] : ["project", "local"],
      auth_mode: authMode,
      auth_isolation: apiKeyAvailable
        ? "api-key-disposable-config"
        : "inherited-auth-only",
      bare_mode: apiKeyAvailable,
      plugin_activation_mode: "explicit-hook-free-plugin-dir",
      plugin_activation: pluginActivation,
      hooks_suppressed_for_isolation: true,
      strict_mcp_config: true,
      automatic_fallback: false,
      max_budget_usd: options.maxBudgetUsd ?? 0.25,
    },
    outcome: {
      completed: metric(
        completed,
        "derived",
        "live-runner-completion-contract",
      ),
      exit_code:
        typeof commandResult.code === "number"
          ? metric(commandResult.code, "measured", "claude-process-exit")
          : unavailableMetric(
              "claude-process-exit",
              `Process ended by signal ${commandResult.signal ?? "unknown"}`,
            ),
      correctness_gate: taskScore.correctness.passed,
      safety_gate: taskScore.safety.passed,
      explanation_gate: unavailableMetric(
        "g010-build-lane",
        "Explanation presentation is measured in the frozen-packet render lane",
      ),
      hard_gate_passed: metric(
        hardGate,
        "derived",
        "completion-correctness-and-safety-conjunction",
      ),
      failure_reason: metric(
        failureReason,
        "measured",
        "live-runner-completion-contract",
      ),
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
      usage: telemetry.usage,
      cost_usd: telemetry.cost_usd,
      latency: telemetry.latency,
      delegation: telemetry.delegation,
      fallback: telemetry.fallback,
      explanation_proxy: {
        score: unavailableMetric(
          "g010-build-lane",
          "Explanation proxy is scored in the frozen-packet render lane",
        ),
        hard_gate_passed: unavailableMetric(
          "g010-build-lane",
          "Explanation proxy is scored in the frozen-packet render lane",
        ),
      },
      human_comprehension: unavailableMetric(
        "g010-study-boundary",
        "No novice human comprehension study has been run",
      ),
    },
    artifacts: {
      root: `<artifact-root>/${runId}`,
      raw_events: "stdout.jsonl",
      raw_events_sha256: stdoutHash,
      stderr: "stderr.txt",
      stderr_sha256: stderrHash,
      parse_errors: "parse-errors.json",
      diff: "diff.patch",
      diff_sha256: diff.patch.sha256,
      score: "score.json",
      invocation: "invocation.json",
    },
    limitations: [
      "Claude Code cost is a client-side estimate, not authoritative billing.",
      "Distinct parent_tool_use_id groups are a delegation proxy, not authoritative per-child billing attribution.",
      "The build lane intentionally does not claim human comprehension or explanation-render quality.",
      "A single repetition is not sufficient for a performance claim.",
      "OAuth/keychain mode omits --bare to preserve authentication; empty setting sources and strict MCP still block project/local settings and MCP, but this is weaker isolation than API-key bare mode.",
    ],
  };
  validateBenchmarkRun(record);
  await writeFile(
    resolve(runRoot, "run.json"),
    `${JSON.stringify(record, null, 2)}\n`,
  );
  return { record, artifactRoot: runRoot };
}

/**
 * Run the same frozen explanation packet through all three headline arms. This
 * is deliberately separate from code generation. Agent and skill-model routes
 * are diagnostic variants and never replace a headline arm.
 *
 * @param {string} pluginRoot
 * @param {{claudeBin: string, model: string, arm: string, variant?: string, rendererModel?: string, artifactRoot: string, acknowledgeApiSpend: boolean, maxBudgetUsd?: number, timeoutMs?: number, effort?: string, ponytailPluginDir?: string, repetition?: number}} options
 */
export async function runLiveClaudeRenderBenchmark(pluginRoot, options) {
  if (options.acknowledgeApiSpend !== true) {
    throw new Error(
      "Live model execution requires explicit acknowledgeApiSpend=true",
    );
  }
  assertFullClaudeModelId(options.model);
  assertComparableParentModel(options.model);
  assertRepetition(options.repetition ?? 1);
  const variant = options.variant ?? "headline";
  if (variant !== "headline" && options.arm !== "fairytail-local") {
    throw new TypeError("Diagnostic render variants are Fairytail-only");
  }
  if (
    options.rendererModel !== undefined &&
    options.rendererModel !== SKILL_OVERRIDE_MODEL
  ) {
    throw new TypeError(
      `Diagnostic renderer is pinned by the staged surface to ${SKILL_OVERRIDE_MODEL}`,
    );
  }

  const benchmarkRoot = resolve(pluginRoot, "benchmarks", "g010");
  const verified = await loadAndVerifyManifest(
    resolve(benchmarkRoot, "manifest.lock.json"),
  );
  await runScorerSelftests(benchmarkRoot);
  const versionResult = await runProcess(
    options.claudeBin,
    ["--version"],
    pluginRoot,
    process.env,
    10_000,
  );
  const version = versionResult.stdout.trim().split(" ")[0];
  if (versionResult.code !== 0 || version !== CLAUDE_CLI_VERSION) {
    throw new Error(
      `G010 pins Claude Code ${CLAUDE_CLI_VERSION}; observed ${versionResult.stdout.trim() || versionResult.stderr.trim()}`,
    );
  }

  let pluginSourceDir;
  let benchmarkPluginName;
  let activationCommand = "";
  /** @type {string[]} */
  const expectedPlugins = [];
  if (options.arm === "ponytail") {
    pluginSourceDir =
      options.ponytailPluginDir ?? process.env.PONYTAIL_PLUGIN_DIR;
    if (!pluginSourceDir) {
      throw new Error("PONYTAIL_PLUGIN_DIR is required for the Ponytail arm");
    }
    await assertPonytailHead(pluginSourceDir, verified.manifest);
    benchmarkPluginName = "ponytail-benchmark";
    activationCommand = "/ponytail-benchmark:ponytail";
  } else if (options.arm === "fairytail-local") {
    pluginSourceDir = pluginRoot;
    benchmarkPluginName = "fairytail-benchmark";
    if (variant === "headline") {
      activationCommand = "/fairytail-benchmark:fairytail-explain-concept";
    }
  }
  if (benchmarkPluginName) {
    expectedPlugins.push(benchmarkPluginName);
  }

  await mkdir(options.artifactRoot, { recursive: true });
  const runId = `g010-live-render-${options.arm}-${variant}-${Date.now()}`;
  const runRoot = resolve(options.artifactRoot, runId);
  await mkdir(runRoot, { recursive: true });
  const pluginDir =
    pluginSourceDir && benchmarkPluginName
      ? await stageHookFreePlugin(
          pluginSourceDir,
          resolve(runRoot, "plugins", benchmarkPluginName),
          benchmarkPluginName,
          options.arm === "ponytail"
            ? ["skills/ponytail"]
            : variant === "fairytail-agent"
              ? ["agents/fairytail-explainer.md"]
              : ["skills/fairytail-explain-concept"],
        )
      : undefined;
  const skillPluginDir =
    variant === "fairytail-skill-override"
      ? resolve(benchmarkRoot, "diagnostics", "skill-override-plugin")
      : undefined;
  if (skillPluginDir) {
    expectedPlugins.push("g010-skill-override");
  }

  const workspace = await createIsolatedGitWorkspace(
    resolve(benchmarkRoot, "fixtures", "safe-path", "base"),
    { artifactRoot: runRoot },
  );
  const diagnostic = variant !== "headline";
  const preparedDiagnostic = diagnostic
    ? await createClosedDiagnosticPacket(pluginRoot, options.model)
    : null;
  const frozenPacket = diagnostic
    ? JSON.stringify(preparedDiagnostic?.packet)
    : await readFile(
        resolve(benchmarkRoot, "fixtures", "explanation", "frozen-packet.json"),
        "utf8",
      );
  const prompt = diagnostic
    ? `The packet below is already validated and has a complete deterministic fallback. Return only an exact 8-slot order/detail patch. Do not emit or rewrite protected content.\n\n${frozenPacket}`
    : `${activationCommand ? `${activationCommand}\n\n` : ""}Render the exact same immutable packet in English and Korean. Preserve its canonical hash, concept IDs, facts, safety boundary, and verification meaning. Add no field or factual claim. Return only the structured output.\n\n${frozenPacket}`;
  const apiKeyAvailable =
    typeof process.env.ANTHROPIC_API_KEY === "string" &&
    process.env.ANTHROPIC_API_KEY.length > 0;
  const authMode = apiKeyAvailable ? "api-key-bare" : "preserve-auth";
  const configDir = resolve(runRoot, "claude-config");
  if (apiKeyAvailable) await mkdir(configDir, { recursive: true });
  const args = buildClaudeInvocation({
    model: options.model,
    arm: options.arm,
    variant,
    pluginDir,
    skillPluginDir,
    prompt,
    maxBudgetUsd: options.maxBudgetUsd ?? 0.15,
    effort: options.effort,
    authMode,
    tools: variant === "headline" ? "" : undefined,
    resultSchema: diagnostic ? EXPLANATION_PATCH_SCHEMA : RENDER_RESULT_SCHEMA,
    pluginAgentType:
      variant === "fairytail-agent"
        ? "fairytail-benchmark:fairytail-explainer"
        : undefined,
    skillCommand:
      variant === "fairytail-skill-override"
        ? "/g010-skill-override:render"
        : undefined,
  });
  const environment = isolatedClaudeEnvironment(
    apiKeyAvailable ? configDir : null,
  );

  const started = performance.now();
  const commandResult = await runProcess(
    options.claudeBin,
    args,
    workspace,
    environment,
    options.timeoutMs ?? 180_000,
  );
  const wallTimeMs = performance.now() - started;
  const parsed = parseJsonLines(commandResult.stdout);
  const telemetry = normalizeClaudeTelemetry(parsed.events, {
    wallTimeMs,
    modelRequested: options.model,
    delegationRequested: variant === "fairytail-agent",
    forwardSubagentText: true,
  });
  const output = structuredOutputFromEvents(parsed.events);
  let explanationEvidence;
  let explanationMetrics;
  let packetCorrect;
  let packetSafe;
  if (diagnostic && preparedDiagnostic) {
    let validPatch = false;
    try {
      validateExplanationPatch(output, preparedDiagnostic.packet);
      validPatch = true;
    } catch {
      validPatch = false;
    }
    const applied = applyExplanationPatch(preparedDiagnostic, output);
    const protectedHashPreserved =
      typeof output === "object" &&
      output !== null &&
      !Array.isArray(output) &&
      output.protected_render_hash ===
        preparedDiagnostic.packet.protected_render_hash;
    packetCorrect = validPatch;
    packetSafe = protectedHashPreserved;
    explanationEvidence = {
      label: "closed 8-slot presentation patch proxy; not human comprehension",
      valid_patch: validPatch,
      protected_hash_preserved: protectedHashPreserved,
      applied_status: applied.status,
      fallback_reason: applied.fallback_reason,
    };
    explanationMetrics = {
      score: metric(
        Number(validPatch) + Number(protectedHashPreserved),
        "derived",
        "closed-explanation-patch-validator",
      ),
      maximum: metric(2, "measured", "closed-explanation-patch-validator"),
      hard_gate_passed: metric(
        validPatch && protectedHashPreserved,
        "derived",
        "closed-explanation-patch-validator",
      ),
    };
  } else {
    const explanation = scoreExplanationPair(output?.en, output?.ko, {
      canonicalFactHash:
        "5e9a7d2d58f2676a42e4fa1c5bc7d30c75041b27a4ccf1d2256e46feadf87158",
      conceptIds: ["path-traversal", "trust-boundary"],
      privacyCanary: "PRIVATE_PROFILE_CANARY",
    });
    packetCorrect =
      explanation.packets.en.dimensions.canonical_fact_hash &&
      explanation.packets.ko.dimensions.canonical_fact_hash &&
      explanation.packets.en.dimensions.concept_ids &&
      explanation.packets.ko.dimensions.concept_ids;
    packetSafe =
      explanation.packets.en.dimensions.privacy_canary_absent &&
      explanation.packets.ko.dimensions.privacy_canary_absent;
    explanationEvidence = explanation;
    explanationMetrics = {
      score: explanation.score,
      maximum: explanation.maximum,
      hard_gate_passed: explanation.hard_gate_passed,
    };
  }
  const diff = await analyzeWorkspaceDiff(workspace);
  const pluginActivation = inspectPluginActivation(
    parsed.events,
    expectedPlugins,
  );
  const modelMatched = telemetry.model.exact_match.value === true;
  const diagnosticModelRequested = diagnostic ? SKILL_OVERRIDE_MODEL : null;
  const diagnosticModelMatched = diagnosticModelRequested
    ? modelUsageIncludes(telemetry.raw.model_usage, diagnosticModelRequested)
    : true;
  const agentCapability =
    variant === "fairytail-agent"
      ? inspectAgentCapability(
          parsed.events,
          "fairytail-benchmark:fairytail-explainer",
        )
      : { verified: true, expected: null, observed: null, reason: null };
  const resultFound = telemetry.raw.result_found === true;
  const initFound = telemetry.raw.init_found === true;
  const outputFound = output !== null;
  const completed =
    commandResult.code === 0 &&
    !commandResult.timedOut &&
    parsed.errors.length === 0 &&
    resultFound &&
    initFound &&
    outputFound &&
    modelMatched &&
    diagnosticModelMatched &&
    pluginActivation.verified &&
    agentCapability.verified;
  const noWorkspaceChanges = diff.changed_file_count.value === 0;
  packetCorrect = outputFound && packetCorrect && noWorkspaceChanges;
  const explanationPassed = explanationMetrics.hard_gate_passed.value === true;
  const hardGate =
    completed && packetCorrect && packetSafe && explanationPassed;
  const stdoutHash = sha256Text(commandResult.stdout);
  const stderrHash = sha256Text(commandResult.stderr);

  await Promise.all([
    writeFile(resolve(runRoot, "stdout.jsonl"), commandResult.stdout),
    writeFile(resolve(runRoot, "stderr.txt"), commandResult.stderr),
    writeFile(
      resolve(runRoot, "parse-errors.json"),
      `${JSON.stringify(parsed.errors, null, 2)}\n`,
    ),
    writeFile(resolve(runRoot, "diff.patch"), diff.patch.text),
    writeFile(
      resolve(runRoot, "rendered-packets.json"),
      `${JSON.stringify(output, null, 2)}\n`,
    ),
    writeFile(
      resolve(runRoot, "score.json"),
      `${JSON.stringify(explanationEvidence, null, 2)}\n`,
    ),
    writeFile(
      resolve(runRoot, "invocation.json"),
      `${JSON.stringify({ binary: basename(options.claudeBin), args: redactPrompt(args) }, null, 2)}\n`,
    ),
  ]);

  const record = {
    schema_version: 1,
    benchmark_id: "g010",
    run_id: runId,
    created_at: new Date().toISOString(),
    synthetic: false,
    measurement_kind: "live-agent",
    lane: "render",
    complete: completed,
    publishable: false,
    host: "claude-code",
    host_cli_version: version,
    arm: options.arm,
    variant,
    task_id: "frozen-safe-path-explanation",
    repetition: options.repetition ?? 1,
    pins: {
      verified:
        modelMatched &&
        diagnosticModelMatched &&
        pluginActivation.verified &&
        agentCapability.verified,
      manifest_sha256: verified.pins.manifest_sha256,
      file_set_sha256: verified.pins.file_set_sha256,
      ponytail_commit: verified.manifest.ponytail_commit,
      fixture_commit: await gitHead(workspace),
      model_requested: options.model,
      model_resolved: telemetry.model.resolved.value,
      effort_requested: options.effort ?? PARENT_EFFORT,
      renderer_model_requested: diagnosticModelRequested,
      renderer_model_observed: diagnosticModelMatched
        ? diagnosticModelRequested
        : null,
      cli_version: version,
      expected_plugins: expectedPlugins,
      plugin_activation_verified: pluginActivation.verified,
      agent_capability_verified: agentCapability.verified,
    },
    isolation: {
      workspace: `<artifact-root>/${runId}/workspace-*`,
      fresh_git_repository: true,
      claude_config_dir: apiKeyAvailable
        ? `<artifact-root>/${runId}/claude-config`
        : "<host-auth-config-preserved>",
      setting_sources: apiKeyAvailable ? [] : ["project", "local"],
      auth_mode: authMode,
      auth_isolation: apiKeyAvailable
        ? "api-key-disposable-config"
        : "inherited-auth-only",
      bare_mode: apiKeyAvailable,
      plugin_activation_mode: "explicit-hook-free-plugin-dir",
      plugin_activation: pluginActivation,
      agent_capability: agentCapability,
      hooks_suppressed_for_isolation: true,
      strict_mcp_config: true,
      automatic_fallback: false,
      max_budget_usd: options.maxBudgetUsd ?? 0.15,
    },
    outcome: {
      completed: metric(
        completed,
        "derived",
        "live-render-completion-contract",
      ),
      exit_code:
        typeof commandResult.code === "number"
          ? metric(commandResult.code, "measured", "claude-process-exit")
          : unavailableMetric(
              "claude-process-exit",
              `Process ended by signal ${commandResult.signal ?? "unknown"}`,
            ),
      correctness_gate: metric(
        packetCorrect,
        "derived",
        "frozen-packet-fact-and-no-edit-contract",
      ),
      safety_gate: metric(
        packetSafe,
        "derived",
        "frozen-packet-privacy-contract",
      ),
      explanation_gate: explanationMetrics.hard_gate_passed,
      hard_gate_passed: metric(
        hardGate,
        "derived",
        "completion-fact-safety-explanation-conjunction",
      ),
      failure_reason: metric(
        hardGate ? "none" : "render-contract-or-runtime-failure",
        "measured",
        "live-render-completion-contract",
      ),
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
      usage: telemetry.usage,
      cost_usd: telemetry.cost_usd,
      latency: telemetry.latency,
      delegation: telemetry.delegation,
      fallback: telemetry.fallback,
      explanation_proxy: {
        score: explanationMetrics.score,
        maximum: explanationMetrics.maximum,
        hard_gate_passed: explanationMetrics.hard_gate_passed,
      },
      human_comprehension: unavailableMetric(
        "g010-study-boundary",
        "No novice human comprehension study has been run; this is a structural proxy only",
      ),
    },
    artifacts: {
      root: `<artifact-root>/${runId}`,
      raw_events: "stdout.jsonl",
      raw_events_sha256: stdoutHash,
      stderr: "stderr.txt",
      stderr_sha256: stderrHash,
      parse_errors: "parse-errors.json",
      rendered_packets: "rendered-packets.json",
      diff: "diff.patch",
      diff_sha256: diff.patch.sha256,
      score: "score.json",
      invocation: "invocation.json",
    },
    limitations: [
      "The explanation score is a structural explanation-support proxy, not human comprehension.",
      "Claude Code cost is a client-side estimate, not authoritative billing.",
      "A skill override requires a separate two-turn cache experiment before any cache-cost claim.",
      "A single repetition is not sufficient for a performance claim.",
    ],
  };
  validateBenchmarkRun(record);
  await writeFile(
    resolve(runRoot, "run.json"),
    `${JSON.stringify(record, null, 2)}\n`,
  );
  return { record, artifactRoot: runRoot };
}

/**
 * Run an actual two-user-message diagnostic in one non-persistent Claude
 * process. Turn 1 takes the agent or skill-model route. Turn 2 returns to the
 * pinned parent and is rejected if it delegates again.
 *
 * @param {string} pluginRoot
 * @param {{claudeBin: string, model: string, variant: "fairytail-agent"|"fairytail-skill-override", artifactRoot: string, acknowledgeApiSpend: boolean, maxBudgetUsd?: number, timeoutMs?: number, effort?: string}} options
 */
export async function runLiveClaudeTwoTurnDiagnostic(pluginRoot, options) {
  if (options.acknowledgeApiSpend !== true) {
    throw new Error(
      "Live model execution requires explicit acknowledgeApiSpend=true",
    );
  }
  assertComparableParentModel(options.model);
  if (!DIAGNOSTIC_VARIANTS.includes(options.variant)) {
    throw new TypeError(
      "Two-turn diagnostic requires an agent or skill variant",
    );
  }

  const benchmarkRoot = resolve(pluginRoot, "benchmarks", "g010");
  const verified = await loadAndVerifyManifest(
    resolve(benchmarkRoot, "manifest.lock.json"),
  );
  await runScorerSelftests(benchmarkRoot);
  const versionResult = await runProcess(
    options.claudeBin,
    ["--version"],
    pluginRoot,
    process.env,
    10_000,
  );
  const version = versionResult.stdout.trim().split(" ")[0];
  if (versionResult.code !== 0 || version !== CLAUDE_CLI_VERSION) {
    throw new Error(
      `G010 pins Claude Code ${CLAUDE_CLI_VERSION}; observed ${versionResult.stdout.trim() || versionResult.stderr.trim()}`,
    );
  }

  await mkdir(options.artifactRoot, { recursive: true });
  const runId = `g010-live-two-turn-${options.variant}-${Date.now()}`;
  const runRoot = resolve(options.artifactRoot, runId);
  await mkdir(runRoot, { recursive: true });
  const pluginDir = await stageHookFreePlugin(
    pluginRoot,
    resolve(runRoot, "plugins", "fairytail-benchmark"),
    "fairytail-benchmark",
    options.variant === "fairytail-agent"
      ? ["agents/fairytail-explainer.md"]
      : ["skills/fairytail-explain-concept"],
  );
  const skillPluginDir =
    options.variant === "fairytail-skill-override"
      ? resolve(benchmarkRoot, "diagnostics", "skill-override-plugin")
      : undefined;
  const expectedPlugins = [
    "fairytail-benchmark",
    ...(skillPluginDir ? ["g010-skill-override"] : []),
  ];
  const workspace = await createIsolatedGitWorkspace(
    resolve(benchmarkRoot, "fixtures", "safe-path", "base"),
    { artifactRoot: runRoot },
  );
  const prepared = await createClosedDiagnosticPacket(
    pluginRoot,
    options.model,
  );
  const packet = JSON.stringify(prepared.packet);
  const firstPrompt = `The packet below is already validated and has a complete deterministic fallback. Return only an exact 8-slot order/detail patch. Do not emit or rewrite protected content.\n\n${packet}`;
  const secondPrompt = `This is the parent-return turn after the optional presentation route. Do not invoke any tool, Agent, subagent, slash command, or skill. As the pinned parent model, return only an exact 8-slot order/detail patch for the same immutable packet.\n\n${packet}`;
  const apiKeyAvailable =
    typeof process.env.ANTHROPIC_API_KEY === "string" &&
    process.env.ANTHROPIC_API_KEY.length > 0;
  const authMode = apiKeyAvailable ? "api-key-bare" : "preserve-auth";
  const configDir = resolve(runRoot, "claude-config");
  if (apiKeyAvailable) await mkdir(configDir, { recursive: true });
  const args = buildClaudeInvocation({
    model: options.model,
    arm: "fairytail-local",
    variant: options.variant,
    pluginDir,
    skillPluginDir,
    prompt: firstPrompt,
    maxBudgetUsd: options.maxBudgetUsd ?? 0.3,
    effort: options.effort,
    authMode,
    resultSchema: EXPLANATION_PATCH_SCHEMA,
    pluginAgentType:
      options.variant === "fairytail-agent"
        ? "fairytail-benchmark:fairytail-explainer"
        : undefined,
    skillCommand:
      options.variant === "fairytail-skill-override"
        ? "/g010-skill-override:render"
        : undefined,
  });
  const stream = createTwoTurnStreamInvocation(args, secondPrompt);
  const environment = isolatedClaudeEnvironment(
    apiKeyAvailable ? configDir : null,
  );

  const started = performance.now();
  const commandResult = await runTwoTurnProcess(
    options.claudeBin,
    stream.args,
    workspace,
    environment,
    options.timeoutMs ?? 300_000,
    stream.messages,
  );
  const wallTimeMs = performance.now() - started;
  const parsed = parseJsonLines(commandResult.stdout);
  const segments = splitResultSegments(parsed.events);
  const firstInit = parsed.events.find(
    (event) => event.type === "system" && event.subtype === "init",
  );
  /** @type {Record<string, unknown> | null} */
  let previousModelUsage = null;
  const turns = segments.map((segment, index) => {
    const hasOwnInit = segment.some(
      (event) => event.type === "system" && event.subtype === "init",
    );
    const events =
      hasOwnInit || index === 0 || !firstInit
        ? segment
        : [firstInit, ...segment];
    const result = [...events]
      .reverse()
      .find((event) => event.type === "result");
    const currentModelUsage = isRecord(result?.modelUsage)
      ? result.modelUsage
      : null;
    const telemetryEvents =
      index === 0 || !currentModelUsage || !previousModelUsage
        ? events
        : replaceResultModelUsage(
            events,
            subtractModelUsage(currentModelUsage, previousModelUsage),
          );
    if (currentModelUsage) previousModelUsage = currentModelUsage;
    const turnModelRequested =
      index === 0 && options.variant === "fairytail-skill-override"
        ? RENDERER_MODEL_ID
        : PARENT_MODEL_ID;
    const telemetry = normalizeClaudeTelemetry(telemetryEvents, {
      wallTimeMs: index === segments.length - 1 ? wallTimeMs : undefined,
      modelRequested: turnModelRequested,
      delegationRequested: index === 0 && options.variant === "fairytail-agent",
      forwardSubagentText: true,
    });
    const output = structuredOutputFromEvents(events);
    let validPatch = false;
    try {
      validateExplanationPatch(output, prepared.packet);
      validPatch = true;
    } catch {
      validPatch = false;
    }
    return {
      turn: index + 1,
      route: index === 0 ? options.variant : "parent-return",
      output_valid: validPatch,
      model: telemetry.model,
      usage: telemetry.usage,
      cost_usd: telemetry.cost_usd,
      latency: telemetry.latency,
      delegation: telemetry.delegation,
      fallback: telemetry.fallback,
      raw: telemetry.raw,
    };
  });
  const pluginActivation = inspectPluginActivation(
    parsed.events,
    expectedPlugins,
  );
  const agentCapability =
    options.variant === "fairytail-agent"
      ? inspectAgentCapability(
          parsed.events,
          "fairytail-benchmark:fairytail-explainer",
        )
      : { verified: true, expected: null, observed: null, reason: null };
  const diff = await analyzeWorkspaceDiff(workspace);
  const first = turns[0];
  const second = turns[1];
  const completed =
    commandResult.code === 0 &&
    !commandResult.timedOut &&
    parsed.errors.length === 0 &&
    segments.length === 2 &&
    commandResult.messagesWritten === 2 &&
    commandResult.firstResultObserved === true &&
    pluginActivation.verified &&
    agentCapability.verified &&
    first?.output_valid === true &&
    second?.output_valid === true &&
    first?.model.exact_match.value === true &&
    second?.model.exact_match.value === true &&
    modelUsageIncludes(first?.raw.model_usage, RENDERER_MODEL_ID) &&
    modelUsageIncludes(second?.raw.model_usage, PARENT_MODEL_ID) &&
    second?.delegation.child_group_count.value === 0 &&
    diff.changed_file_count.value === 0;
  const stdoutHash = sha256Text(commandResult.stdout);
  const stderrHash = sha256Text(commandResult.stderr);

  const diagnostic = {
    schema_version: 1,
    benchmark_id: "g010",
    kind: "single-process-two-turn-parent-return-diagnostic",
    diagnostic_id: runId,
    created_at: new Date().toISOString(),
    synthetic: false,
    complete: completed,
    variant: options.variant,
    turns_expected: 2,
    turns,
    savings_claimed: false,
    pins: {
      verified:
        pluginActivation.verified &&
        agentCapability.verified &&
        first?.model.exact_match.value === true &&
        second?.model.exact_match.value === true &&
        modelUsageIncludes(first?.raw.model_usage, RENDERER_MODEL_ID) &&
        modelUsageIncludes(second?.raw.model_usage, PARENT_MODEL_ID),
      manifest_sha256: verified.pins.manifest_sha256,
      file_set_sha256: verified.pins.file_set_sha256,
      model_requested: options.model,
      effort_requested: options.effort ?? PARENT_EFFORT,
      renderer_model_requested: RENDERER_MODEL_ID,
      first_turn_model_requested:
        options.variant === "fairytail-skill-override"
          ? RENDERER_MODEL_ID
          : PARENT_MODEL_ID,
      second_turn_model_requested: PARENT_MODEL_ID,
      cli_version: version,
      expected_plugins: expectedPlugins,
      plugin_activation_verified: pluginActivation.verified,
      agent_capability_verified: agentCapability.verified,
    },
    isolation: {
      one_process: true,
      streamed_user_messages: 2,
      result_gated_second_message: true,
      no_session_persistence: true,
      auth_mode: authMode,
      auth_isolation: apiKeyAvailable
        ? "api-key-disposable-config"
        : "inherited-auth-only",
      hooks_suppressed_for_isolation: true,
      strict_mcp_config: true,
      automatic_fallback: false,
    },
    artifacts: {
      root: `<artifact-root>/${runId}`,
      raw_events: "stdout.jsonl",
      raw_events_sha256: stdoutHash,
      stderr: "stderr.txt",
      stderr_sha256: stderrHash,
      diff: "diff.patch",
      diff_sha256: diff.patch.sha256,
      parse_errors: "parse-errors.json",
      invocation: "invocation.json",
    },
    limitations: [
      "Two turns measure one process and one conversation, but Claude Code modelUsage is per-model aggregate telemetry rather than authoritative per-turn billing attribution.",
      "No cache or cost saving is claimed automatically from this diagnostic.",
      "Claude Code cost remains a client-side estimate, not authoritative billing.",
    ],
  };
  await Promise.all([
    writeFile(resolve(runRoot, "stdout.jsonl"), commandResult.stdout),
    writeFile(resolve(runRoot, "stderr.txt"), commandResult.stderr),
    writeFile(resolve(runRoot, "diff.patch"), diff.patch.text),
    writeFile(
      resolve(runRoot, "parse-errors.json"),
      `${JSON.stringify(parsed.errors, null, 2)}\n`,
    ),
    writeFile(
      resolve(runRoot, "invocation.json"),
      `${JSON.stringify({ binary: basename(options.claudeBin), args: stream.args, streamed_messages: 2, streaming_strategy: "write-second-after-first-result" }, null, 2)}\n`,
    ),
    writeFile(
      resolve(runRoot, "diagnostic.json"),
      `${JSON.stringify(diagnostic, null, 2)}\n`,
    ),
  ]);
  return { diagnostic, artifactRoot: runRoot };
}

/**
 * Convert a one-shot invocation whose final argument is the first prompt into
 * one non-persistent two-message stream. Exported for an offline contract test.
 *
 * @param {string[]} oneShotArgs
 * @param {string} secondPrompt
 */
export function createTwoTurnStreamInvocation(oneShotArgs, secondPrompt) {
  const args = [...oneShotArgs];
  const firstPrompt = args.pop();
  if (
    typeof firstPrompt !== "string" ||
    firstPrompt.length === 0 ||
    typeof secondPrompt !== "string" ||
    secondPrompt.length === 0
  ) {
    throw new TypeError("Two non-empty diagnostic prompts are required");
  }
  args.push("--input-format", "stream-json", "--replay-user-messages");
  const messages = [
    sdkUserMessage(firstPrompt),
    sdkUserMessage(secondPrompt),
  ].map((message) => `${JSON.stringify(message)}\n`);
  return { args, messages, input: messages.join("") };
}

/** @param {string} model */
export function assertFullClaudeModelId(model) {
  if (
    typeof model !== "string" ||
    !/^claude-[a-z0-9]+(?:-[a-z0-9]+){2,}$/u.test(model) ||
    /-(?:latest|current)$/u.test(model)
  ) {
    throw new TypeError(
      "A full pinned Claude model ID is required; aliases such as opus, sonnet, haiku, and *-latest are rejected",
    );
  }
}

/** @param {string} model */
export function assertComparableParentModel(model) {
  if (model !== PARENT_MODEL_ID) {
    throw new TypeError(
      `Comparable G010 runs require parent model ${PARENT_MODEL_ID}; use a separately named exploratory benchmark for ${model}`,
    );
  }
}

/** @param {number} repetition */
function assertRepetition(repetition) {
  if (!Number.isInteger(repetition) || repetition < 1) {
    throw new TypeError("repetition must be an integer of at least 1");
  }
}

/** @param {string} pluginDir @param {unknown} manifestValue */
export async function assertPonytailHead(pluginDir, manifestValue) {
  const result = await runCommand("git", ["rev-parse", "HEAD"], pluginDir);
  const observed = result.stdout.trim();
  if (observed !== PONYTAIL_COMMIT) {
    throw new Error(
      `PONYTAIL_PLUGIN_DIR must be checkout ${PONYTAIL_COMMIT}; observed ${observed}`,
    );
  }
  if (
    !isRecord(manifestValue) ||
    !isRecord(manifestValue.ponytail_source_pins)
  ) {
    throw new TypeError("Manifest is missing Ponytail source pins");
  }
  for (const [relativePath, expectedHash] of Object.entries(
    manifestValue.ponytail_source_pins,
  )) {
    if (typeof expectedHash !== "string") {
      throw new TypeError(`Invalid Ponytail source pin for ${relativePath}`);
    }
    const actualHash = createHash("sha256")
      .update(await readFile(resolve(pluginDir, relativePath)))
      .digest("hex");
    if (actualHash !== expectedHash) {
      throw new Error(
        `Ponytail source hash mismatch for ${relativePath}: expected ${expectedHash}, got ${actualHash}`,
      );
    }
  }
  return observed;
}

/**
 * Stage only declarative skill/agent/data surfaces. Hook manifests and scripts
 * are deliberately absent so OAuth-mode benchmarks cannot write into the
 * user's real Claude configuration. The source tree remains hash/commit pinned.
 *
 * @param {string} sourceDir
 * @param {string} destination
 * @param {string} pluginName
 * @param {string[]} surfacePaths
 */
export async function stageHookFreePlugin(
  sourceDir,
  destination,
  pluginName,
  surfacePaths,
) {
  await mkdir(resolve(destination, ".claude-plugin"), { recursive: true });
  const sourceManifest = JSON.parse(
    await readFile(resolve(sourceDir, ".claude-plugin", "plugin.json"), "utf8"),
  );
  const manifest = {
    name: pluginName,
    version:
      typeof sourceManifest.version === "string"
        ? sourceManifest.version
        : "0.0.0-benchmark",
    description: `Hook-free G010 staging copy of ${typeof sourceManifest.name === "string" ? sourceManifest.name : pluginName}`,
  };
  await writeFile(
    resolve(destination, ".claude-plugin", "plugin.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  for (const relativePath of surfacePaths) {
    await copyIfPresent(
      resolve(sourceDir, relativePath),
      resolve(destination, relativePath),
    );
  }
  return destination;
}

/** @param {string} source @param {string} destination */
async function copyIfPresent(source, destination) {
  try {
    await mkdir(dirname(destination), { recursive: true });
    await cp(source, destination, { recursive: true, force: true });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return;
    }
    throw error;
  }
}

/** @param {string|null} configDir */
function isolatedClaudeEnvironment(configDir) {
  /** @type {NodeJS.ProcessEnv} */
  const environment = { ...process.env };
  if (configDir !== null) environment.CLAUDE_CONFIG_DIR = configDir;
  for (const name of [
    "ANTHROPIC_MODEL",
    "CLAUDE_CODE_SUBAGENT_MODEL",
    "CLAUDE_CODE_EFFORT_LEVEL",
    "CLAUDE_PLUGIN_DATA",
  ]) {
    delete environment[name];
  }
  environment.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = "1";
  return environment;
}

/**
 * `--plugin-dir` proves only that a path was requested. Publication requires
 * system/init evidence that each expected plugin actually loaded without a
 * reported plugin error.
 *
 * @param {Record<string, unknown>[]} events
 * @param {string[]} expectedPlugins
 */
export function inspectPluginActivation(events, expectedPlugins) {
  const init = events.find(
    (event) => event.type === "system" && event.subtype === "init",
  );
  if (!init || !Object.hasOwn(init, "plugins")) {
    return {
      verified: false,
      expected: expectedPlugins,
      observed: null,
      reason: "system/init did not report plugin activation",
    };
  }
  const observed = init.plugins;
  const serialized = JSON.stringify(observed).toLowerCase();
  const pluginErrors = init.plugin_errors ?? init.pluginErrors;
  const hasErrors = Array.isArray(pluginErrors) && pluginErrors.length > 0;
  const verified =
    !hasErrors &&
    (expectedPlugins.length === 0
      ? !/(?:fairytail|ponytail|g010-skill-override)/u.test(serialized)
      : expectedPlugins.every((name) => serialized.includes(name)));
  return {
    verified,
    expected: expectedPlugins,
    observed,
    reason: verified
      ? null
      : hasErrors
        ? "system/init reported plugin errors"
        : "expected plugin was not present in system/init",
  };
}

/**
 * @param {Record<string, unknown>[]} events
 * @param {string} expectedAgent
 */
export function inspectAgentCapability(events, expectedAgent) {
  const init = events.find(
    (event) => event.type === "system" && event.subtype === "init",
  );
  if (!init || !Object.hasOwn(init, "agents")) {
    return {
      verified: false,
      expected: expectedAgent,
      observed: null,
      reason: "system/init did not report agent capabilities",
    };
  }
  const observed = init.agents;
  const serialized = JSON.stringify(observed);
  const verified = serialized.includes(expectedAgent);
  return {
    verified,
    expected: expectedAgent,
    observed,
    reason: verified
      ? null
      : "expected plugin agent was not present in system/init",
  };
}

/** @param {Record<string, unknown>[]} events */
export function structuredOutputFromEvents(events) {
  const result = [...events].reverse().find((event) => event.type === "result");
  if (!result) return null;
  const raw = result.structured_output ?? result.structuredOutput;
  if (isRecord(raw)) return raw;
  if (typeof raw !== "string") return null;
  try {
    const parsed = JSON.parse(raw);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** @param {unknown} value @param {string} model */
export function modelUsageIncludes(value, model) {
  return isRecord(value) && Object.hasOwn(value, model);
}

/** @param {string} text */
function sha256Text(text) {
  return createHash("sha256").update(text).digest("hex");
}

/** @param {string} pluginRoot @param {string} parentModel */
async function createClosedDiagnosticPacket(pluginRoot, parentModel) {
  const now = new Date("2026-07-18T12:00:00.000Z");
  const runtime = await loadAnalogyRuntime(pluginRoot, now);
  const completed = completeOnboarding(
    {
      background_categories: ["education"],
      familiar_labels: [],
      coding_actions: ["none"],
      presentation_preference: "analogy_first",
      safety_concerns: ["none"],
      language: "en",
    },
    "approve",
    now,
  );
  const resolution = await resolveAnalogy(runtime, {
    profile: completed.profile,
    scenarioId: "S04",
    regressionCatalog: true,
  });
  const packet = createLearningPacket(runtime, {
    scenarioId: "S04",
    resolution,
    requestedLocale: "en-US",
    buildPacketHash: "b".repeat(64),
    producer: {
      role: "primary_reasoning_model",
      model_id: parentModel,
      packet_validated: true,
      parent_model_changed: false,
    },
    verifiedTaskResult: {
      result_id: "g010-render",
      status: "verified",
      outcome: "changed",
      summary: "The presentation boundary passed its focused checks.",
      verification: {
        check_id: "render-tests",
        status: "passed",
        evidence_id: "render-run-g010",
      },
    },
  });
  return prepareLearningRender(packet);
}

/** @param {string} workspace */
async function gitHead(workspace) {
  return (
    await runCommand("git", ["rev-parse", "HEAD"], workspace)
  ).stdout.trim();
}

/**
 * @param {{code: number|null, signal: NodeJS.Signals|null, timedOut: boolean}} result
 * @param {number} parseErrorCount
 * @param {boolean} resultFound
 * @param {boolean} initFound
 * @param {boolean} modelMatched
 * @param {boolean} pluginActivated
 */
function failureReasonFor(
  result,
  parseErrorCount,
  resultFound,
  initFound,
  modelMatched,
  pluginActivated,
) {
  if (result.timedOut) return "timeout";
  if (result.code !== 0)
    return `claude-exit-${result.code ?? result.signal ?? "unknown"}`;
  if (parseErrorCount > 0) return "malformed-stream-json";
  if (!initFound) return "missing-system-init";
  if (!resultFound) return "missing-result-event";
  if (!modelMatched) return "model-substituted-or-unresolved";
  if (!pluginActivated) return "plugin-activation-unverified";
  return "incomplete";
}

/** @param {string[]} args */
function redactPrompt(args) {
  return args.map((value, index) =>
    index === args.length - 1 ? "<benchmark-prompt>" : value,
  );
}

/** @param {string} content */
function sdkUserMessage(content) {
  return {
    type: "user",
    message: { role: "user", content },
    parent_tool_use_id: null,
  };
}

/** @param {Record<string, unknown>[]} events */
function splitResultSegments(events) {
  /** @type {Record<string, unknown>[][]} */
  const segments = [];
  let start = 0;
  for (const [index, event] of events.entries()) {
    if (event.type !== "result") continue;
    segments.push(events.slice(start, index + 1));
    start = index + 1;
  }
  return segments;
}

/**
 * Replace only the terminal result event's cumulative modelUsage map. The raw
 * stdout remains untouched in the retained artifact.
 *
 * @param {Record<string, unknown>[]} events
 * @param {Record<string, unknown>} modelUsage
 */
function replaceResultModelUsage(events, modelUsage) {
  let replaced = false;
  return [...events]
    .reverse()
    .map((event) => {
      if (replaced || event.type !== "result") return event;
      replaced = true;
      return { ...event, modelUsage };
    })
    .reverse();
}

/**
 * Claude Code reports result.modelUsage cumulatively in a streamed multi-turn
 * process. Subtract the prior snapshot so each turn record does not double
 * count the earlier renderer. If a provider ever resets a counter, retain the
 * current per-turn value instead of inventing a negative measurement.
 *
 * @param {Record<string, unknown>} current
 * @param {Record<string, unknown>} previous
 */
export function subtractModelUsage(current, previous) {
  const cumulativeFields = [
    "inputTokens",
    "outputTokens",
    "cacheReadInputTokens",
    "cacheCreationInputTokens",
    "webSearchRequests",
    "costUSD",
  ];
  /** @type {Record<string, unknown>} */
  const delta = {};
  for (const [model, currentValue] of Object.entries(current)) {
    if (!isRecord(currentValue)) continue;
    const previousValue = isRecord(previous[model]) ? previous[model] : null;
    if (!previousValue) {
      delta[model] = currentValue;
      continue;
    }
    const entry = { ...currentValue };
    let activity = false;
    for (const field of cumulativeFields) {
      const now = currentValue[field];
      const before = previousValue[field];
      if (typeof now !== "number" || !Number.isFinite(now)) continue;
      const difference =
        typeof before === "number" && Number.isFinite(before) && now >= before
          ? now - before
          : now;
      entry[field] = difference;
      if (difference !== 0) activity = true;
    }
    if (activity) delta[model] = entry;
  }
  return delta;
}

/**
 * @param {string} command
 * @param {string[]} args
 * @param {string} cwd
 * @param {NodeJS.ProcessEnv} env
 * @param {number} timeoutMs
 */
function runProcess(command, args, cwd, env, timeoutMs) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    const timer = setTimeout(() => {
      timedOut = true;
      if (process.platform === "win32") child.kill("SIGTERM");
      else if (child.pid !== undefined) process.kill(-child.pid, "SIGTERM");
    }, timeoutMs);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolveResult({ stdout, stderr, code, signal, timedOut });
    });
  });
}

/**
 * @param {string} command
 * @param {string[]} args
 * @param {string} cwd
 * @param {NodeJS.ProcessEnv} env
 * @param {number} timeoutMs
 * @param {string[]} messages
 */
export function runTwoTurnProcess(
  command,
  args,
  cwd,
  env,
  timeoutMs,
  messages,
) {
  if (
    !Array.isArray(messages) ||
    messages.length !== 2 ||
    messages.some(
      (message) => typeof message !== "string" || !message.endsWith("\n"),
    )
  ) {
    throw new TypeError("Two newline-terminated stream messages are required");
  }
  return new Promise((resolveResult, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let lineBuffer = "";
    let timedOut = false;
    let settled = false;
    let messagesWritten = 0;
    let firstResultObserved = false;
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      lineBuffer += text;
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let event;
        try {
          event = JSON.parse(line);
        } catch {
          continue;
        }
        if (
          !firstResultObserved &&
          isRecord(event) &&
          event.type === "result" &&
          (event.parent_tool_use_id === null ||
            event.parent_tool_use_id === undefined)
        ) {
          firstResultObserved = true;
          messagesWritten += 1;
          child.stdin.end(messages[1]);
        }
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    child.stdin.on("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    messagesWritten += 1;
    child.stdin.write(messages[0]);
    const timer = setTimeout(() => {
      timedOut = true;
      if (process.platform === "win32") child.kill("SIGTERM");
      else if (child.pid !== undefined) process.kill(-child.pid, "SIGTERM");
    }, timeoutMs);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      resolveResult({
        stdout,
        stderr,
        code,
        signal,
        timedOut,
        messagesWritten,
        firstResultObserved,
      });
    });
  });
}
