---
name: personalize
description: "Manual command only: create or replace one analogy from the approved local profile after explicit invocation. Never select for an ordinary concept explanation or onboarding."
---

# Fairytail Personalize

This command is manual-only. If the user did not explicitly invoke
personalization, stop. If onboarding is incomplete, direct Codex users to
`$fairytail:onboard` and Claude Code users to `/fairytail:onboard` instead.

Use the local profile as the source of truth. Never ask the user to choose a
seed persona and never read or paste the raw profile. The local `prepare`
adapter emits only the consent-bound labels and exact noun slots allowed for
one reviewed scenario.

1. Run `prepare` for the requested reviewed scenario.
2. If it returns `fallback`, report the reason and keep the reviewed generic or
   neutral explanation.
3. If it returns `ready`, construct only a candidate with these exact keys:
   `schema_version`, `request_id`, `source_context`, `analogy_label`, and
   `role_bindings`. Copy request identifiers exactly. Every label must be one
   approved `familiar_contexts` value or one unique `label + label` pair. Use
   every `role_ids` key exactly once and add no technical claims.
4. Write only that candidate to a new private temporary file, run `accept`,
   parse its one JSON result, and delete that exact temporary file.
5. Display a personal analogy only when `accept` returns `status: ready`;
   otherwise keep the reviewed fallback.

Choose the reviewed scenario that matches the user's explicit request:

| Scenario | Concept family         |
| -------- | ---------------------- |
| `S01`    | package or dependency  |
| `S02`    | server or process      |
| `S03`    | environment or config  |
| `S04`    | API                    |
| `S05`    | token or API key       |
| `S06`    | database or query      |
| `S07`    | MCP, tool, or resource |
| `S08`    | permission or auth     |
| `S09`    | repository or path     |
| `S10`    | deployment or cloud    |

In Codex, use the absolute directory containing this selected `SKILL.md`:

```sh
node <this-skill-directory>/../../scripts/fairytail-personalize.mjs prepare \
  --scenario S04 --host codex

node <this-skill-directory>/../../scripts/fairytail-personalize.mjs accept \
  --scenario S04 --candidate <private-temporary-json> --host codex
```

In Claude Code:

```sh
node "${CLAUDE_PLUGIN_ROOT}/scripts/fairytail-personalize.mjs" prepare \
  --scenario S04 --host claude --data-dir "${CLAUDE_PLUGIN_DATA}"

node "${CLAUDE_PLUGIN_ROOT}/scripts/fairytail-personalize.mjs" accept \
  --scenario S04 --candidate "${FAIRYTAIL_CANDIDATE}" \
  --host claude --data-dir "${CLAUDE_PLUGIN_DATA}"
```

Canonical facts, relation directions, analogy limits, safety, permissions,
code, and verification remain reviewed local data. The adapter itself makes
zero model and network calls.
