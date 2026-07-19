import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeClaudeTelemetry,
  normalizeCodexTelemetry,
  parseJsonLines,
} from "../src/benchmark/telemetry.mjs";
import { PARENT_MODEL_ID } from "../src/benchmark/contracts.mjs";

test("Claude normalization keeps fresh, cache-read, and cache-create input separate", () => {
  const telemetry = normalizeClaudeTelemetry(
    [
      { type: "system", subtype: "init", model: PARENT_MODEL_ID },
      { type: "assistant", parent_tool_use_id: "toolu_child_1" },
      {
        type: "result",
        duration_ms: 500,
        duration_api_ms: 400,
        total_cost_usd: 0.012,
        usage: {
          input_tokens: 10,
          cache_read_input_tokens: 20,
          cache_creation_input_tokens: 5,
          output_tokens: 4,
        },
      },
    ],
    {
      wallTimeMs: 600,
      modelRequested: PARENT_MODEL_ID,
      delegationRequested: true,
      forwardSubagentText: true,
    },
  );
  assert.equal(telemetry.usage.input_fresh_tokens.value, 10);
  assert.equal(telemetry.usage.input_cache_read_tokens.value, 20);
  assert.equal(telemetry.usage.input_cache_create_tokens.value, 5);
  assert.equal(telemetry.usage.input_total_tokens.value, 35);
  assert.equal(telemetry.cost_usd.status, "estimated");
  assert.equal(telemetry.delegation.child_group_count.value, 1);
  assert.equal(telemetry.model.exact_match.value, true);
});

test("Claude modelUsage overrides misleading zero top-level counters and aggregates every model", () => {
  const telemetry = normalizeClaudeTelemetry(
    [
      { type: "system", subtype: "init", model: PARENT_MODEL_ID },
      {
        type: "result",
        total_cost_usd: 0,
        usage: {
          input_tokens: 0,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
          output_tokens: 0,
        },
        modelUsage: {
          [PARENT_MODEL_ID]: {
            inputTokens: 530,
            cacheReadInputTokens: 6195,
            cacheCreationInputTokens: 158,
            outputTokens: 72,
            costUSD: 0.019,
          },
          "claude-haiku-4-5-20251001": {
            inputTokens: 12,
            cacheReadInputTokens: 20,
            cacheCreationInputTokens: 4,
            outputTokens: 8,
            costUSD: 0.001,
          },
        },
      },
    ],
    { modelRequested: PARENT_MODEL_ID },
  );
  assert.equal(telemetry.usage.input_fresh_tokens.value, 542);
  assert.equal(telemetry.usage.input_cache_read_tokens.value, 6215);
  assert.equal(telemetry.usage.input_cache_create_tokens.value, 162);
  assert.equal(telemetry.usage.input_total_tokens.value, 6919);
  assert.equal(telemetry.usage.output_tokens.value, 80);
  assert.equal(telemetry.cost_usd.value, 0.02);
  assert.equal(telemetry.raw.usage_source, "sum(result.modelUsage[*])");
});

test("Claude result model identifies a skill override ahead of the process init model", () => {
  const rendererModel = "claude-haiku-4-5-20251001";
  const telemetry = normalizeClaudeTelemetry(
    [
      { type: "system", subtype: "init", model: PARENT_MODEL_ID },
      {
        type: "result",
        model: rendererModel,
        usage: {
          input_tokens: 1,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
          output_tokens: 1,
        },
      },
    ],
    { modelRequested: rendererModel },
  );
  assert.equal(telemetry.model.resolved.value, rendererModel);
  assert.equal(telemetry.model.resolved.source, "claude-code:result.model");
  assert.equal(telemetry.model.exact_match.value, true);
});

test("missing Claude cache counters remain unavailable instead of becoming zero", () => {
  const telemetry = normalizeClaudeTelemetry([
    {
      type: "result",
      usage: {
        input_tokens: 10,
        cache_read_input_tokens: 0,
        output_tokens: 2,
      },
    },
  ]);
  assert.equal(telemetry.usage.input_cache_read_tokens.value, 0);
  assert.equal(telemetry.usage.input_cache_create_tokens.value, null);
  assert.equal(telemetry.usage.input_cache_create_tokens.status, "unavailable");
  assert.equal(telemetry.usage.input_total_tokens.value, null);
});

test("Codex cached input is a subset and is never added to input total", () => {
  const telemetry = normalizeCodexTelemetry([
    {
      type: "turn.completed",
      usage: {
        input_tokens: 100,
        cached_input_tokens: 60,
        output_tokens: 8,
        reasoning_output_tokens: 2,
      },
    },
  ]);
  assert.equal(telemetry.usage.input_total_tokens.value, 100);
  assert.equal(telemetry.usage.input_cache_read_tokens.value, 60);
  assert.equal(telemetry.usage.input_fresh_tokens.value, 40);
  assert.equal(telemetry.usage.input_cache_create_tokens.status, "unavailable");
  assert.equal(telemetry.cost_usd.status, "unavailable");
});

test("impossible Codex cache counters are invalid and JSONL parse errors are retained", () => {
  const telemetry = normalizeCodexTelemetry([
    {
      type: "turn.completed",
      usage: {
        input_tokens: 10,
        cached_input_tokens: 11,
        output_tokens: 1,
        reasoning_output_tokens: 0,
      },
    },
  ]);
  assert.equal(telemetry.usage.input_fresh_tokens.status, "invalid");
  assert.equal(telemetry.usage.input_fresh_tokens.value, null);

  const parsed = parseJsonLines('{"type":"ok"}\nnot-json\n');
  assert.equal(parsed.events.length, 1);
  assert.equal(parsed.errors.length, 1);
  assert.equal(parsed.errors[0].line, 2);
});
