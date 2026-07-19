import assert from "node:assert/strict";
import test from "node:test";

import {
  redactEvent,
  redactJsonLines,
} from "../scripts/publish-g010-measured.mjs";

test("publication redaction removes host identity, opaque ids, and hidden reasoning", () => {
  const input = [
    JSON.stringify({
      type: "system",
      subtype: "init",
      cwd: "/private/tmp/g010/run",
      session_id: "84965620-62cc-406f-9c4a-a94067168dc0",
      uuid: "ee54d5c0-84c6-4891-8d46-b3fdb7e59e65",
      memory_paths: { auto: "/Users/alice/.claude/memory" },
      slash_commands: ["private-command"],
      skills: ["private-skill"],
      model: "claude-sonnet-4-6",
      plugins: [
        {
          name: "fairytail-benchmark",
          path: "/Users/alice/Library/Mobile Documents/private-plugin",
        },
        {
          name: "already-redacted",
          path: "<host-home>/Library/private-plugin",
        },
      ],
    }),
    JSON.stringify({
      type: "assistant",
      session_id: "84965620-62cc-406f-9c4a-a94067168dc0",
      request_id: "req_abc123",
      message: {
        id: "msg_abc123",
        content: [
          { type: "thinking", thinking: "private chain", signature: "secret" },
          {
            type: "text",
            text: "Use /private/tmp/g010/run and notify alice@example.com with toolu_abc123",
          },
        ],
      },
    }),
    JSON.stringify({ type: "rate_limit_event", utilization: 0.75 }),
  ].join("\n");

  const output = redactJsonLines(input, ["/private/tmp/g010"]);
  assert.doesNotMatch(
    output,
    /alice|Library|Mobile Documents|session_id|private chain|rate_limit|req_abc|msg_abc|toolu_abc/u,
  );
  assert.match(output, /<artifact-root>\/run/u);
  assert.match(output, /<email>/u);
  assert.match(output, /<opaque-id>/u);
  assert.match(output, /fairytail-benchmark/u);
  assert.match(output, /claude-sonnet-4-6/u);
});

test("thinking-only and account-usage events are omitted", () => {
  assert.equal(redactEvent({ type: "rate_limit_event" }), null);
  assert.equal(
    redactEvent({ type: "system", subtype: "thinking_tokens" }),
    null,
  );
  assert.equal(
    redactEvent({
      type: "assistant",
      message: { content: [{ type: "thinking", thinking: "hidden" }] },
    }),
    null,
  );
});
