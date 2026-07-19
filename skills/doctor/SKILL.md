---
name: doctor
description: Manual Fairytail diagnostic for onboarding, private storage, rendering, and host boundaries. Never use for project, test, dependency, environment, or code diagnosis; require explicit Fairytail Doctor invocation.
---

# Fairytail Doctor

Manual command only. This is a Fairytail management command, not a general
software doctor. If the user did not explicitly invoke this skill, stop.

Run the deterministic local diagnostic first and summarize its JSON faithfully.

```sh
# Codex: use the absolute directory containing this selected SKILL.md
node <this-skill-directory>/../../scripts/fairytail-doctor.mjs --host codex

# Claude Code
node "${CLAUDE_PLUGIN_ROOT}/scripts/fairytail-doctor.mjs" \
  --host claude --data-dir "${CLAUDE_PLUGIN_DATA}"
```

Make these limitations explicit:

- `onboarding` contains status only. It never includes raw answers or a local path. Never use `profile preview` as a diagnostic.
- The user-authored local profile is the source of truth. A mapper may fill only consent-bound noun slots; local code supplies facts, relations, limits, and safety.
- English is canonical, Korean is reviewed, and unsupported locales fall back to English.
- The Ponytail-derived build ladder is semantically limited to non-trivial repository implementation and never overrides safety exceptions.
- Direct explanations are deterministic. An optional model may arrange validated presentation or noun slots only; it cannot change code, safety, permissions, or verification.
- Fairytail can block only verified Red/P0 patterns exposed through Claude Code `PreToolUse`; it does not secure unexposed host actions.
- Logs exclude prompts, raw profiles, tool input/output, secrets, and local paths.
- Structural explanation proxies and simulated beginner journeys are not evidence of human comprehension or general token savings.
