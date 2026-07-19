import {
  invalidMetric,
  isRecord,
  metric,
  unavailableMetric,
} from "./contracts.mjs";

/**
 * Parse newline-delimited JSON without discarding malformed lines.
 *
 * @param {string} text
 */
export function parseJsonLines(text) {
  /** @type {Record<string, unknown>[]} */
  const events = [];
  /** @type {{line: number, text: string, reason: string}[]} */
  const errors = [];

  for (const [index, rawLine] of text.split(/\r?\n/u).entries()) {
    const line = rawLine.trim();
    if (!line) continue;
    try {
      const parsed = JSON.parse(line);
      if (!isRecord(parsed)) {
        errors.push({
          line: index + 1,
          text: line,
          reason: "JSON value is not an object",
        });
      } else {
        events.push(parsed);
      }
    } catch (error) {
      errors.push({
        line: index + 1,
        text: line,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { events, errors };
}

/**
 * Claude Code result usage follows Anthropic semantics: input_tokens excludes
 * cache reads and cache creation. The normalized total therefore sums all
 * three categories. Missing cache fields remain unavailable rather than being
 * silently coerced to zero.
 *
 * @param {Record<string, unknown>[]} events
 * @param {{wallTimeMs?: number, modelRequested?: string, delegationRequested?: boolean, forwardSubagentText?: boolean}} [options]
 */
export function normalizeClaudeTelemetry(events, options = {}) {
  const result = [...events].reverse().find((event) => event.type === "result");
  const init = events.find(
    (event) => event.type === "system" && event.subtype === "init",
  );
  const usage = result && isRecord(result.usage) ? result.usage : null;
  const modelUsage =
    result && isRecord(result.modelUsage) ? result.modelUsage : null;
  const aggregate = aggregateClaudeModelUsage(modelUsage);
  const source = "claude-code:result.usage";

  const topLevel = {
    input_fresh_tokens: numericField(usage, "input_tokens", source),
    input_cache_read_tokens: numericField(
      usage,
      "cache_read_input_tokens",
      source,
    ),
    input_cache_create_tokens: numericField(
      usage,
      "cache_creation_input_tokens",
      source,
    ),
    output_tokens: numericField(usage, "output_tokens", source),
  };
  const fresh = aggregate?.input_fresh_tokens ?? topLevel.input_fresh_tokens;
  const cacheRead =
    aggregate?.input_cache_read_tokens ?? topLevel.input_cache_read_tokens;
  const cacheCreate =
    aggregate?.input_cache_create_tokens ?? topLevel.input_cache_create_tokens;
  const output = aggregate?.output_tokens ?? topLevel.output_tokens;

  const totalInput = allNumeric([fresh, cacheRead, cacheCreate])
    ? metric(
        Number(fresh.value) +
          Number(cacheRead.value) +
          Number(cacheCreate.value),
        "derived",
        "anthropic-token-contract",
      )
    : unavailableMetric(
        "anthropic-token-contract",
        "Cannot derive total input until fresh, cache-read, and cache-create fields are all reported",
      );

  const resultModel =
    result && typeof result.model === "string" ? result.model : null;
  const modelResolved =
    resultModel !== null
      ? metric(resultModel, "measured", "claude-code:result.model")
      : init && typeof init.model === "string"
        ? metric(init.model, "measured", "claude-code:system.init.model")
        : unavailableMetric(
            "claude-code:result.model|system.init.model",
            "Resolved model was not reported",
          );
  const modelRequested = options.modelRequested
    ? metric(
        options.modelRequested,
        "measured",
        "benchmark-runner:cli-argument",
      )
    : unavailableMetric(
        "benchmark-runner:cli-argument",
        "No requested model was supplied to the normalizer",
      );
  const modelMatch =
    options.modelRequested && typeof modelResolved.value === "string"
      ? metric(
          modelResolved.value === options.modelRequested,
          "derived",
          "benchmark-runner:model-resolution-check",
        )
      : unavailableMetric(
          "benchmark-runner:model-resolution-check",
          "Requested or resolved model is unavailable",
        );

  const childEvents = events.filter(
    (event) =>
      typeof event.parent_tool_use_id === "string" &&
      event.parent_tool_use_id.length > 0,
  );
  const childGroups = new Set(
    childEvents.map((event) => String(event.parent_tool_use_id)),
  );
  const childSource = "claude-code:stream-json.parent_tool_use_id";
  const canObserveChildren = options.forwardSubagentText === true;

  return {
    host: "claude-code",
    usage: {
      input_fresh_tokens: fresh,
      input_cache_read_tokens: cacheRead,
      input_cache_create_tokens: cacheCreate,
      input_total_tokens: totalInput,
      output_tokens: output,
      reasoning_output_tokens: unavailableMetric(
        source,
        "Claude Code result telemetry does not expose a separate reasoning-output token field",
      ),
    },
    cost_usd:
      aggregate?.cost_usd ??
      numericField(result, "total_cost_usd", "claude-code:result", {
        status: "estimated",
        missingReason:
          "Claude Code did not report its client-side cost estimate",
      }),
    latency: {
      wall_time_ms:
        typeof options.wallTimeMs === "number" &&
        Number.isFinite(options.wallTimeMs)
          ? metric(
              options.wallTimeMs,
              "measured",
              "benchmark-runner:monotonic-clock",
            )
          : unavailableMetric(
              "benchmark-runner:monotonic-clock",
              "Wall time was not supplied",
            ),
      provider_duration_ms: numericField(
        result,
        "duration_ms",
        "claude-code:result",
      ),
      provider_api_duration_ms: numericField(
        result,
        "duration_api_ms",
        "claude-code:result",
      ),
    },
    model: {
      requested: modelRequested,
      resolved: modelResolved,
      exact_match: modelMatch,
    },
    delegation: {
      requested: metric(
        options.delegationRequested === true,
        "measured",
        "benchmark-runner:variant-contract",
      ),
      child_event_count: canObserveChildren
        ? metric(childEvents.length, "measured", childSource)
        : unavailableMetric(
            childSource,
            "--forward-subagent-text was not confirmed",
          ),
      child_group_count: canObserveChildren
        ? metric(childGroups.size, "derived", childSource)
        : unavailableMetric(
            childSource,
            "--forward-subagent-text was not confirmed",
          ),
      per_child_usage: unavailableMetric(
        "claude-code:result.modelUsage",
        "Claude Code aggregate model usage does not authoritatively attribute tokens to individual child agents",
      ),
      per_model_usage: modelUsage
        ? metric(modelUsage, "measured", "claude-code:result.modelUsage")
        : unavailableMetric(
            "claude-code:result.modelUsage",
            "Per-model usage was not reported",
          ),
    },
    fallback: {
      automatic_fallback_enabled: metric(
        false,
        "measured",
        "benchmark-runner:cli-contract",
      ),
      fallback_used: metric(false, "measured", "benchmark-runner:cli-contract"),
      reason: metric(
        "automatic fallback intentionally disabled",
        "measured",
        "benchmark-runner:cli-contract",
      ),
    },
    raw: {
      result_found: result !== undefined,
      init_found: init !== undefined,
      model_usage: modelUsage,
      top_level_usage: usage,
      usage_source:
        aggregate === null ? "result.usage" : "sum(result.modelUsage[*])",
    },
  };
}

/**
 * Claude Code 2.1.214 may report zeroes at result.usage while modelUsage holds
 * the actual counters. Sum every resolved-model entry for system totals. A
 * partially missing entry invalidates aggregation rather than becoming zero.
 *
 * @param {Record<string, unknown>|null} modelUsage
 */
function aggregateClaudeModelUsage(modelUsage) {
  if (!modelUsage || Object.keys(modelUsage).length === 0) return null;
  const entries = Object.entries(modelUsage);
  const fields = [
    "inputTokens",
    "cacheReadInputTokens",
    "cacheCreationInputTokens",
    "outputTokens",
    "costUSD",
  ];
  if (
    entries.some(
      ([, value]) =>
        !isRecord(value) ||
        fields.some(
          (field) =>
            typeof value[field] !== "number" ||
            !Number.isFinite(value[field]) ||
            Number(value[field]) < 0,
        ),
    )
  ) {
    return null;
  }
  /** @param {string} field */
  const sum = (field) =>
    entries.reduce(
      (total, [, value]) =>
        total + Number(/** @type {Record<string, unknown>} */ (value)[field]),
      0,
    );
  const aggregateSource = "claude-code:sum(result.modelUsage[*])";
  return {
    input_fresh_tokens: metric(sum("inputTokens"), "derived", aggregateSource),
    input_cache_read_tokens: metric(
      sum("cacheReadInputTokens"),
      "derived",
      aggregateSource,
    ),
    input_cache_create_tokens: metric(
      sum("cacheCreationInputTokens"),
      "derived",
      aggregateSource,
    ),
    output_tokens: metric(sum("outputTokens"), "derived", aggregateSource),
    cost_usd: metric(sum("costUSD"), "estimated", aggregateSource),
  };
}

/**
 * Codex currently reports cached_input_tokens as a subset of input_tokens.
 * Never add the two. Uncached input is derived by subtraction only when the
 * counters are internally consistent. Cache creation is not exposed.
 *
 * @param {Record<string, unknown>[]} events
 * @param {{wallTimeMs?: number, modelRequested?: string}} [options]
 */
export function normalizeCodexTelemetry(events, options = {}) {
  const completed = [...events]
    .reverse()
    .find((event) => event.type === "turn.completed" && isRecord(event.usage));
  const usage = completed && isRecord(completed.usage) ? completed.usage : null;
  const source = "codex-exec:turn.completed.usage";
  const input = numericField(usage, "input_tokens", source);
  const cached = numericField(usage, "cached_input_tokens", source);
  const output = numericField(usage, "output_tokens", source);
  const reasoning = numericField(usage, "reasoning_output_tokens", source);

  let fresh;
  if (allNumeric([input, cached])) {
    const difference = Number(input.value) - Number(cached.value);
    fresh =
      difference >= 0
        ? metric(difference, "derived", "openai-cached-input-subset-contract")
        : invalidMetric(
            "openai-cached-input-subset-contract",
            "cached_input_tokens exceeds input_tokens",
          );
  } else {
    fresh = unavailableMetric(
      "openai-cached-input-subset-contract",
      "Input and cached-input counters are both required",
    );
  }

  return {
    host: "codex-exec",
    usage: {
      input_fresh_tokens: fresh,
      input_cache_read_tokens: cached,
      input_cache_create_tokens: unavailableMetric(
        source,
        "Codex turn telemetry does not expose cache-creation tokens",
      ),
      input_total_tokens: input,
      output_tokens: output,
      reasoning_output_tokens: reasoning,
    },
    cost_usd: unavailableMetric(
      "codex-exec:jsonl",
      "Codex CLI JSONL does not report USD cost; subscription cost must not be guessed",
    ),
    latency: {
      wall_time_ms:
        typeof options.wallTimeMs === "number" &&
        Number.isFinite(options.wallTimeMs)
          ? metric(
              options.wallTimeMs,
              "measured",
              "benchmark-runner:monotonic-clock",
            )
          : unavailableMetric(
              "benchmark-runner:monotonic-clock",
              "Wall time was not supplied",
            ),
      provider_duration_ms: unavailableMetric(
        "codex-exec:jsonl",
        "No provider duration was reported in the turn.completed event",
      ),
    },
    model: {
      requested: options.modelRequested
        ? metric(
            options.modelRequested,
            "measured",
            "benchmark-runner:cli-argument",
          )
        : unavailableMetric(
            "benchmark-runner:cli-argument",
            "No requested model was supplied",
          ),
      resolved: unavailableMetric(
        "codex-exec:jsonl",
        "Resolved model was not present in supplied events",
      ),
    },
    delegation: {
      requested: unavailableMetric(
        "codex-exec:jsonl",
        "Delegation intent was not supplied",
      ),
      child_group_count: unavailableMetric(
        "codex-exec:jsonl",
        "Per-agent attribution is not guaranteed by Codex JSONL",
      ),
      per_child_usage: unavailableMetric(
        "codex-exec:jsonl",
        "Per-agent token attribution is not guaranteed by Codex JSONL",
      ),
    },
    fallback: {
      automatic_fallback_enabled: metric(
        false,
        "measured",
        "benchmark-runner:cli-contract",
      ),
      fallback_used: unavailableMetric(
        "codex-exec:jsonl",
        "No fallback event was supplied",
      ),
    },
  };
}

/**
 * @param {Record<string, unknown>|null|undefined} object
 * @param {string} field
 * @param {string} source
 * @param {{status?: "measured"|"estimated", missingReason?: string}} [options]
 */
function numericField(object, field, source, options = {}) {
  const value = object?.[field];
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return metric(value, options.status ?? "measured", `${source}.${field}`);
  }
  return unavailableMetric(
    `${source}.${field}`,
    options.missingReason ??
      `${field} was not reported as a non-negative finite number`,
  );
}

/** @param {{value: unknown, status: string}[]} values */
function allNumeric(values) {
  return values.every(
    (item) =>
      (item.status === "measured" ||
        item.status === "derived" ||
        item.status === "estimated") &&
      typeof item.value === "number" &&
      Number.isFinite(item.value),
  );
}
