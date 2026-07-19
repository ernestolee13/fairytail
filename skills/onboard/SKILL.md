---
name: onboard
description: Set up or resume Fairytail's private five-question profile for language, background, and familiar analogies. Never collect answers in chat.
---

# Fairytail Onboarding

Keep the user's raw background answers out of the model conversation. The
interactive questionnaire runs in the user's own terminal and saves one
private local profile as the source of truth.

First, run the non-sensitive status command for the active host.

In Claude Code:

```sh
node "${CLAUDE_PLUGIN_ROOT}/scripts/fairytail-profile.mjs" status \
  --host claude --data-dir "${CLAUDE_PLUGIN_DATA}"
```

In Codex, use the absolute directory containing this selected `SKILL.md`
without searching for it:

```sh
node <this-skill-directory>/../../scripts/fairytail-profile.mjs status \
  --host codex
```

If `onboardingRequired` is `false`, summarize only the non-sensitive status and
stop. If it is `true`, do not ask the five questions in chat. Give the user the
matching command below to paste into a separate local terminal:

```sh
# Claude Code installation
node "${CLAUDE_PLUGIN_ROOT}/scripts/fairytail-profile.mjs" onboard \
  --host claude --data-dir "${CLAUDE_PLUGIN_DATA}" --locale en

# Codex installation
node <this-skill-directory>/../../scripts/fairytail-profile.mjs onboard \
  --host codex --locale en
```

Use `--locale ko` when the user is speaking Korean or requests Korean. Locale
selection is setup, not a sixth profile question. Ask the user only to return
after the terminal flow says the profile was saved; then rerun status.

The first two questions accept the user's own familiar contexts, roles,
objects, and routines. They never classify the user into a seed persona. The
local flow separately shows the complete local profile and the exact approved
field projection. Host conversation is still subject to the host's configured
model service; local profile persistence does not change that.
