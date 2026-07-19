---
name: profile
description: Manual Fairytail profile management for preferences, analogy mode, reset, export, or deletion. Never use for performance profiling, accounts, or project config; require explicit Fairytail Profile invocation.
---

# Fairytail Profile

Manual command only. This is a Fairytail management command, not a profiler or
general account or project profile. If the user did not explicitly invoke this
skill, stop.

Run the non-sensitive status command first. In Codex, use the absolute selected
skill directory; in Claude Code, use the plugin variables.

```sh
# Codex
node <this-skill-directory>/../../scripts/fairytail-profile.mjs status --host codex

# Claude Code
node "${CLAUDE_PLUGIN_ROOT}/scripts/fairytail-profile.mjs" status \
  --host claude --data-dir "${CLAUDE_PLUGIN_DATA}"
```

Profile values are not injected into this skill. `status` is the only operation
the host agent may run automatically. Never run `edit` or `preview` through a
host tool: both can expose raw profile values in tool output. Give the matching
command for the user to paste into a separate local terminal. For any other
operation, act only after the user explicitly requests that profile change.
The base command is:

```sh
# Codex
node <this-skill-directory>/../../scripts/fairytail-profile.mjs <operation> --host codex

# Claude Code
node "${CLAUDE_PLUGIN_ROOT}/scripts/fairytail-profile.mjs" <operation> \
  --host claude --data-dir "${CLAUDE_PLUGIN_DATA}"
```

Supported operations are `edit`, `preview`, `neutral`, `no-analogy`, `reset`,
`delete`, and `export <new-local-file>`. `edit` and `preview` must run in a
separate local terminal so raw values remain local. Export refuses to overwrite
an existing destination.

Reset and delete affect only the exact Fairytail profile file. The three
bundled seed worlds are regression fixtures, not user categories. An approved
profile may fill bounded analogy noun slots only; canonical facts, safety,
permissions, code, and verification remain outside that boundary.
