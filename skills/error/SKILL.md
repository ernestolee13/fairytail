---
name: error
description: Explain an observed failed coding action for a beginner with one evidence item, one tied cause, and one safe next step, without raw errors. Do not select for ordinary debugging, fixes, or implementation unless explanation is requested.
---

# Fairytail Error

The host may inspect the actual failure for diagnosis, but raw tool input,
output, code, commands, logs, errors, paths, prompts, profiles, and secrets must
never cross the Fairytail adapter or enter its local store.

1. Stabilize the environment before suggesting a retry.
2. Choose one reviewed scenario from the G005 `scenarios` command.
3. Reduce the observation to one bounded non-sensitive `failure.summary` with
   an opaque `evidence_id`, canonical `observed_at`, and `interrupted` boolean.
4. State one `cause` with `statement`, `confidence` (`low`, `medium`, or
   `high`), and `based_on_evidence_id` equal to that same evidence ID. Do not
   present an unsupported cause as certain.
5. Create a private mode `0600` input with the common surface fields plus only
   `failure` and `cause`, set `surface` to `error`, and call:

```sh
node "$CLAUDE_PLUGIN_ROOT/scripts/fairytail-g005.mjs" surface \
  --input "$FAIRYTAIL_G005_INPUT" \
  --data-dir "$CLAUDE_PLUGIN_DATA"
```

Delete the exact temporary input after parsing the response. Present
`stabilization`, `observed_evidence`, `one_evidenced_cause`, and
`one_safe_action` in that order. Fairytail does not retry, block, or execute the
action.
