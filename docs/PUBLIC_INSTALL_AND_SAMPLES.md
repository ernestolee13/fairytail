# Public install and sample results

This document records the v0.1.6 release checks that exercise Fairytail as a
user receives it, not only as source modules imported by unit tests. The final
gate is rerun from a fresh public clone before the release tag is published.

## Release stop condition

A release is not complete until all of the following pass from the release
commit or tag:

1. a fresh public clone and `npm ci`;
2. `npm run check:context-gate` in that clone;
3. Claude marketplace add, install, enable, load, disable, and uninstall;
4. Codex marketplace add, install, load, remove, and marketplace cleanup;
5. one bounded natural-language smoke set on each host;
6. the seven-step disposable Codex beginner journey;
7. a privacy scan of tracked files and generated public evidence.

## Natural-language activation matrix

The bounded smoke set samples the same semantic categories on Claude Code and
Codex:

| Kind                          | Prompt                                                         | Required observation                                             |
| ----------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------- |
| Positive, explicit            | `Use Fairytail to explain MCP for a beginner with an analogy.` | One reviewed MCP render                                          |
| Positive, initial design      | Korean first-app request connecting API, server, and database  | One bounded connected map in Korean                              |
| Positive, implementation      | Natural non-trivial repository feature request                 | Build policy selected; smallest safe diff; host verifies         |
| Negative, ordinary definition | `What is an API?`                                              | Host-default answer; concept renderer never runs                 |
| Negative, trivial edit        | `Change this button label from Save to Done.`                  | Host-default edit; Fairytail build and concept skills stay quiet |

The smoke is deliberately small. It tests routing boundaries and completion,
not answer preference or human comprehension. Exact host output can vary, so
the retained result records skill/tool selection, completion, elapsed time,
payload boundary, and whether repository exploration occurred. Raw streams are
kept out of the public repository when they contain machine paths or unrelated
host inventory.

## Deterministic sample

The public-clone demo command is:

```bash
npm run --silent demo
npm run --silent demo -- ko
```

It works before `npm ci`, accepts only exact English or Korean selection,
ignores stored profile data and its data-directory setting, uses default
in-memory first-use state, and renders the fixed API/server/database bundle. The
equivalent underlying command used as the performance oracle is:

```bash
node skills/fairytail-explain-concept/scripts/explain.mjs \
  --concept api,server,database \
  --locale ko
```

The current release returns one connected map backed by three reviewed concept
items in `1,581` UTF-8 bytes, below its `12 KiB` ceiling, with these effect
counters:

```json
{
  "model_calls": 0,
  "network_calls": 0,
  "execution_calls": 0
}
```

Across all 26 aliases and both locales, `52/52` direct renders pass and the
largest observed payload is `1,013` bytes.

## Host-specific boundary

Claude and Codex share the same `skills/`, runtime, reviewed content, and
schemas. Their activation surfaces differ:

- Claude Code and Codex read the same semantic selector in the shared concept
  skill description. There is no `UserPromptSubmit` keyword classifier and no
  Fairytail prompt-hook context injection.
- Codex additionally reads `agents/openai.yaml`. Build exposes a narrow
  non-trivial implementation intent; personalization, profile, and doctor stay
  explicit-only. Concept and onboarding expose their separate narrow intents.
- Codex `onboard`, `profile`, and `doctor` skills resolve the same private
  `${CODEX_HOME:-~/.codex}/fairytail` directory. Raw five-question answers stay
  in the interactive local terminal; status output contains no values or path.
- Claude can use the optional one-turn, tool-free analogy mapper and
  presentation arranger. Codex keeps concept rendering deterministic by
  default and permits model-filled noun slots only after manual
  personalization.

This means the deterministic output and byte limits are hard local invariants;
natural-language skill selection is an observed host integration behavior.

## Current local host result

The following v0.1.6 release-candidate observations were collected on
2026-07-19. They are bounded single runs, not cross-version guarantees.

| Surface                                    | Observation                                                           |
| ------------------------------------------ | --------------------------------------------------------------------- |
| Codex explicit `demo ko`                   | Installed renderer ran once and returned the connected Korean map     |
| Claude marketplace install + explicit demo | Installed, enabled, returned the same map, then uninstalled cleanly   |
| Codex natural non-trivial implementation   | Selected `build`; 22 source LOC + 30 test LOC; `4/4` cases passed     |
| Codex one-value package edit               | Build stayed unselected; one value changed; JSON parsed               |
| Codex ordinary API definition              | Concept stayed unselected; two-sentence host answer; no command       |
| Codex design-only layout advice            | Build and Concept stayed unselected; three host bullets; no command   |
| Codex natural first-app design             | Selected Concept; rendered one 1,581-byte Korean map with one command |

The paired Codex implementation probe used the same GPT-5.6 Sol prompt and
fixture in both arms. Native Codex added 38 source lines; Fairytail added 22.
Both final replies were 49 words. Full measurements and the higher Fairytail
input-token limitation are in [Performance](PERFORMANCE.md).

The Claude check proves the documented marketplace lifecycle and explicit demo
path only. This release does not claim that Claude and Codex make identical
natural-language selection decisions.

The current source tree also checks all 11 shared skill descriptions, the
64-prompt bilingual intent contract (48 Concept + 16 Build), plugin shape,
Claude strict plugin
validation, strict TypeScript, the focused context suite, and isolated
Claude/Codex install lifecycle smokes. The fresh public-clone rerun remains the
release stop condition.

## Automated beginner journey result

The Codex-specific first-use smoke runs with a disposable `CODEX_HOME` and one
fixed Korean non-coder fixture. It exercises commands, not subjective
preference:

| Task                                              | Result |
| ------------------------------------------------- | -----: |
| Fresh profile status requires onboarding          |   Pass |
| Five local questions save one user-authored truth |   Pass |
| Data directory/file permissions are `0700`/`0600` |   Pass |
| Doctor reports completion without raw answers     |   Pass |
| Missing personal map retains a reviewed analogy   |   Pass |
| Consent-bound API noun slots validate and persist |   Pass |
| Later API explanation reuses the personal map     |   Pass |

Result: **7/7**. The final direct renderer reports zero model, network, and
execution calls. This is an automated product-flow proxy, not a human
comprehension score. The consented novice pilot remains `0/3`.

## Practical strengths

- Explicit beginner and initial-design requests have a closed, fast fallback.
- Ordinary questions and trivial edits are not required to pay for the rich
  explanation structure.
- The profile remains user-authored rather than selecting a seed persona.
- English and Korean share canonical fact IDs and safety boundaries.
- The plugin installs beside existing harnesses without taking over their
  permissions or orchestration.

## Current limitations

- Natural-language routing can change with a host release.
- A saved profile does not make every analogy valid; missing or rejected maps
  fall back to neutral reviewed text.
- The structural `2/9 → 9/9` metric is not a comprehension score.
- The consented novice pilot remains `0/3`.
- Full-session token and cost comparisons require a same-batch host experiment;
  deterministic renderer bytes are not a substitute for that telemetry.
