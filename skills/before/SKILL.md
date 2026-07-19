---
name: before
description: "Manual command only: after explicit invocation, render Fairytail's pre-action explanation. Never auto-select for routine or trivial edits."
---

# Fairytail Before

This command is manual-only. If it was not explicitly invoked, stop.

Keep the host harness in charge of reasoning, permissions, execution, and
verification. This command explains an action; it never approves or runs it.

1. Choose one reviewed scenario from `node "$CLAUDE_PLUGIN_ROOT/scripts/fairytail-g005.mjs" scenarios`.
2. Create a private temporary directory and a mode `0600` JSON input containing
   exactly `schema_version`, `surface`, `interaction_id`, `scenario_id`,
   `requested_locale`, `started_at`, and `action`.
3. Set `surface` to `before`. `action` contains only `actor`, `target`, and
   `expected_change`.
4. Use a bounded non-sensitive summary. Never include source code, raw commands,
   host paths, prompts, profiles, secrets, logs, or learning history.
5. Run:

```sh
node "$CLAUDE_PLUGIN_ROOT/scripts/fairytail-g005.mjs" surface \
  --input "$FAIRYTAIL_G005_INPUT" \
  --data-dir "$CLAUDE_PLUGIN_DATA"
```

Delete the exact temporary input after parsing the response. Show `card.core`
first and preserve every risk, rollback, and evidence statement.
