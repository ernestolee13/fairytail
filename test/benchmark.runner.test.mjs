import assert from "node:assert/strict";
import test from "node:test";

import { PARENT_MODEL_ID } from "../src/benchmark/contracts.mjs";
import {
  assertComparableParentModel,
  assertFullClaudeModelId,
  buildClaudeInvocation,
  createTwoTurnStreamInvocation,
  inspectAgentCapability,
  inspectPluginActivation,
  RENDER_RESULT_SCHEMA,
  runTwoTurnProcess,
  structuredOutputFromEvents,
  subtractModelUsage,
} from "../src/benchmark/live-claude.mjs";

const model = PARENT_MODEL_ID;

test("Claude live invocation is isolated, bounded, streamed, and has no automatic fallback", () => {
  const args = buildClaudeInvocation({
    model,
    arm: "baseline",
    prompt: "implement fixture",
    maxBudgetUsd: 0.25,
    authMode: "api-key-bare",
    allowedTools: "Edit,Read,Write,Bash(node *)",
  });
  assert.ok(args.includes("--bare"));
  assert.ok(args.includes("--forward-subagent-text"));
  assert.ok(args.includes("--no-session-persistence"));
  assert.ok(args.includes("--strict-mcp-config"));
  assert.equal(args[args.indexOf("--setting-sources") + 1], "");
  assert.equal(args[args.indexOf("--model") + 1], model);
  assert.equal(args[args.indexOf("--max-budget-usd") + 1], "0.25");
  assert.ok(!args.includes("--fallback-model"));
  assert.ok(!args.includes("--plugin-dir"));
  assert.equal(
    args[args.indexOf("--allowedTools") + 1],
    "Edit,Read,Write,Bash(node *)",
  );
  assert.ok(args.indexOf("--allowedTools") < args.indexOf("--json-schema"));
  assert.equal(args.at(-1), "implement fixture");
});

test("render schema stays compatible with the pinned Claude CLI dialect", () => {
  const serialized = JSON.stringify(RENDER_RESULT_SCHEMA);
  assert.doesNotMatch(serialized, /prefixItems/u);
  assert.deepEqual(
    RENDER_RESULT_SCHEMA.properties.en.properties.concept_ids.items,
    { enum: ["path-traversal", "trust-boundary"] },
  );
});

test("OAuth mode preserves authentication while suppressing settings and MCP", () => {
  const args = buildClaudeInvocation({
    model,
    arm: "baseline",
    prompt: "implement fixture",
    maxBudgetUsd: 0.25,
    authMode: "preserve-auth",
  });
  assert.ok(!args.includes("--bare"));
  assert.equal(args[args.indexOf("--setting-sources") + 1], "project,local");
  assert.equal(
    args[args.indexOf("--mcp-config") + 1],
    JSON.stringify({ mcpServers: {} }),
  );
});

test("non-baseline arms use explicit plugin directories and diagnostics remain variants", () => {
  const agentArgs = buildClaudeInvocation({
    model,
    arm: "fairytail-local",
    variant: "fairytail-agent",
    pluginDir: "/tmp/fairytail-plugin",
    pluginAgentType: "fairytail-benchmark:fairytail-explainer",
    prompt: "render",
    maxBudgetUsd: 0.25,
  });
  assert.equal(
    agentArgs[agentArgs.indexOf("--plugin-dir") + 1],
    "/tmp/fairytail-plugin",
  );
  assert.ok(!agentArgs.includes("--agent"));
  assert.ok(!agentArgs.includes("--agents"));
  assert.equal(agentArgs[agentArgs.indexOf("--tools") + 1], "Agent");
  assert.match(
    String(agentArgs.at(-1)),
    /fairytail-benchmark:fairytail-explainer/u,
  );

  const skillArgs = buildClaudeInvocation({
    model,
    arm: "fairytail-local",
    variant: "fairytail-skill-override",
    pluginDir: "/tmp/fairytail-plugin",
    skillPluginDir: "/tmp/g010-skill-plugin",
    skillCommand: "/g010-skill-override:render",
    prompt: "render",
    maxBudgetUsd: 0.25,
  });
  assert.match(String(skillArgs.at(-1)), /^\/g010-skill-override:render/u);
});

test("aliases, latest pointers, invalid routing, and excessive budgets fail before execution", () => {
  assert.throws(() => assertFullClaudeModelId("sonnet"), /full pinned/u);
  assert.throws(
    () => assertFullClaudeModelId("claude-sonnet-latest"),
    /full pinned/u,
  );
  assert.throws(
    () => assertComparableParentModel("claude-sonnet-4-5-20250929"),
    /Comparable G010 runs/u,
  );
  assert.throws(() =>
    buildClaudeInvocation({
      model,
      arm: "ponytail",
      prompt: "x",
      maxBudgetUsd: 0.25,
    }),
  );
  assert.throws(() =>
    buildClaudeInvocation({
      model,
      arm: "baseline",
      variant: "fairytail-agent",
      prompt: "x",
      maxBudgetUsd: 0.25,
    }),
  );
  assert.throws(() =>
    buildClaudeInvocation({
      model,
      arm: "baseline",
      prompt: "x",
      maxBudgetUsd: 5.01,
    }),
  );
  assert.throws(
    () =>
      buildClaudeInvocation({
        model,
        arm: "baseline",
        prompt: "x",
        maxBudgetUsd: 0.25,
        effort: "low",
      }),
    /parent effort high/u,
  );
});

test("init and result evidence must name the staged capability exactly", () => {
  const events = [
    {
      type: "system",
      subtype: "init",
      plugins: [{ name: "fairytail-benchmark" }],
      agents: ["fairytail-benchmark:fairytail-explainer"],
    },
    {
      type: "result",
      structured_output: JSON.stringify({ schema_version: 1 }),
    },
  ];
  assert.equal(
    inspectPluginActivation(events, ["fairytail-benchmark"]).verified,
    true,
  );
  assert.equal(
    inspectAgentCapability(events, "fairytail-benchmark:fairytail-explainer")
      .verified,
    true,
  );
  assert.deepEqual(structuredOutputFromEvents(events), { schema_version: 1 });
});

test("cache diagnostic becomes two streamed user messages in one non-persistent invocation", () => {
  const oneShot = buildClaudeInvocation({
    model,
    arm: "fairytail-local",
    variant: "fairytail-skill-override",
    pluginDir: "/tmp/fairytail-plugin",
    skillPluginDir: "/tmp/g010-skill-plugin",
    skillCommand: "/g010-skill-override:render",
    prompt: "first packet",
    maxBudgetUsd: 0.3,
  });
  const stream = createTwoTurnStreamInvocation(oneShot, "parent return packet");
  assert.ok(stream.args.includes("--no-session-persistence"));
  assert.equal(
    stream.args[stream.args.indexOf("--input-format") + 1],
    "stream-json",
  );
  assert.ok(stream.args.includes("--replay-user-messages"));
  const messages = stream.input
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(messages.length, 2);
  assert.match(messages[0].message.content, /^\/g010-skill-override:render/u);
  assert.equal(messages[1].message.content, "parent return packet");
  assert.ok(messages.every((message) => message.parent_tool_use_id === null));
});

test("second streamed message is withheld until the first result event", async () => {
  const childProgram = `
    import readline from "node:readline";
    const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
    let turn = 0;
    for await (const line of input) {
      const message = JSON.parse(line);
      turn += 1;
      process.stdout.write(JSON.stringify({ type: "user", message: message.message, parent_tool_use_id: null }) + "\\n");
      process.stdout.write(JSON.stringify({ type: "result", subtype: "success", structured_output: { turn } }) + "\\n");
    }
  `;
  const messages = ["first", "second"].map(
    (content) =>
      `${JSON.stringify({ type: "user", message: { role: "user", content }, parent_tool_use_id: null })}\n`,
  );
  const result = await runTwoTurnProcess(
    process.execPath,
    ["--input-type=module", "--eval", childProgram],
    process.cwd(),
    process.env,
    5_000,
    messages,
  );
  /** @type {Record<string, any>[]} */
  const events = /** @type {string} */ (result.stdout)
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));

  assert.equal(result.code, 0);
  assert.equal(result.firstResultObserved, true);
  assert.equal(result.messagesWritten, 2);
  assert.deepEqual(
    events
      .filter((event) => event.type === "result")
      .map((event) => event.structured_output.turn),
    [1, 2],
  );
});

test("cumulative multi-turn model usage is converted to a non-negative turn delta", () => {
  assert.deepEqual(
    subtractModelUsage(
      {
        haiku: {
          inputTokens: 10,
          outputTokens: 20,
          cacheReadInputTokens: 30,
          cacheCreationInputTokens: 40,
          costUSD: 0.02,
          contextWindow: 200000,
        },
        sonnet: {
          inputTokens: 3,
          outputTokens: 7,
          cacheReadInputTokens: 100,
          cacheCreationInputTokens: 50,
          costUSD: 0.08,
          contextWindow: 200000,
        },
      },
      {
        haiku: {
          inputTokens: 10,
          outputTokens: 20,
          cacheReadInputTokens: 30,
          cacheCreationInputTokens: 40,
          costUSD: 0.02,
          contextWindow: 200000,
        },
      },
    ),
    {
      sonnet: {
        inputTokens: 3,
        outputTokens: 7,
        cacheReadInputTokens: 100,
        cacheCreationInputTokens: 50,
        costUSD: 0.08,
        contextWindow: 200000,
      },
    },
  );
});
