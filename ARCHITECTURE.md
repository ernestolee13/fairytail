# Fairytail architecture

Fairytail separates implementation efficiency from explanation depth. The host
agent remains responsible for planning, code, permissions, execution, and
verification. Fairytail adds a narrowly selected minimal-build policy and a
bounded beginner-explanation layer without taking over the host's workflow.

## Request routing

```text
ordinary definition ───────────────────────► host-default answer
trivial edit ──────────────────────────────► host-default edit path

non-trivial repository implementation ───────► minimal-build skill
explicit build override ─────────────────────┘          │
                                                        ▼
                                              smallest correct implementation

Claude/Codex semantic skill selection ─────────► shared skill description
                                                   │ selected body
explicit slash or $ invocation ───────────────────┤
                                                   │
                                                   ▼
                                           bundled script
                                                   │
                                                   ▼
                                          Direct concept route
                                                   │
                                                   ▼
                                          reviewed alias, max 3
                                                   │
                   saved profile + cached map ─────┤
                                                   ▼
                                        deterministic EN/KO text
                                        fixed byte ceiling
```

The rich route is intentionally narrow. A single ordinary definition such as
“What is an API?” should remain on the host-default answer path. An explicit
request such as “Use Fairytail to explain API with an analogy” is eligible for
the reviewed route. An initial-design walkthrough may select up to three
distinct reviewed concept aliases in one response.

Claude Code and Codex both select the shared concept skill from the semantic
intent in its frontmatter description. Positive intent includes an explicit
Fairytail request, a requested beginner/plain-language walkthrough, confusion,
an analogy or personalization request, a concept distinction, or initial
system design.
Negative intent for the concept skill includes ordinary short definitions,
unsupported concepts, routine planning, implementation, fixing, review, and
trivial edits. An
explicit slash or `$fairytail:fairytail-explain-concept` invocation remains
available.

There is no `UserPromptSubmit` keyword classifier. This removes a duplicate
source of routing truth and means Fairytail injects zero prompt-hook context
bytes for every prompt. Host skill descriptions still occupy baseline host
metadata: the current eleven shared descriptions use 2,485 raw UTF-8 bytes,
below a fixed 2.5 KiB budget before host framing and tokenization. Once
selected, the full skill body and renderer output may count as host input or
output according to each provider.

Codex additionally reads `agents/openai.yaml`.
`fairytail-explain-concept` and `onboard` permit implicit invocation for their
narrow intents. `build` permits implicit invocation only for non-trivial
repository implementation; `before`, `finish`, `personalize`, `profile`, and
`doctor` explicitly disable it. Claude shares the same intent boundaries in
the skill descriptions. If no Fairytail intent matches, the request stays on
the host path.

Natural-language selection remains partly host-owned. Releases therefore run
positive and negative host smoke prompts. This is an observed integration
contract, not a claim that every future host classifier is identical.

## Direct concept route

The current concept path is deliberately closed:

1. The skill selects one alias, or up to three aliases for an explicit initial
   design request.
2. `src/runtime/concept.mjs` maps each alias to one of ten reviewed scenarios.
3. The runtime loads versioned local concept content and an optional saved local
   profile. It does not inspect the user's repository.
4. If no profile exists, the presentation layer selects a reviewed generic
   first-use analogy for that scenario and locale. It never infers a profession
   or personal trait.
5. If a profile exists, its approved state and `no_analogy` choice are the
   source of truth. The analogy engine reuses a locally validated mapping when
   one exists. An approved profile whose optional map is still pending receives
   the same labeled reviewed generic analogy; invalid, unapproved, corrupt,
   neutral, or no-analogy state fails to a neutral reviewed explanation.
6. The locale layer renders English or Korean without changing canonical fact
   IDs, relations, safety fields, or breakpoints.
7. The terminal formatter produces the final text.
8. The runtime rejects output above 4 KiB per concept. A bundle is limited to
   three concepts and 12 KiB. Aliases that resolve to the same reviewed
   scenario are rendered once rather than repeating the same card.

This path exposes no model client, network client, command runner, repository
search, or open-ended source-discovery step. Its result includes explicit
effect counters so the release gate can require zero model, network, and
execution calls.

The bundled command is:

```bash
node skills/fairytail-explain-concept/scripts/explain.mjs \
  --concept api,server,database \
  --locale ko
```

Its JSON mode exposes the selected scenario, locale resolution, analogy status,
payload size, and effect counters for verification. Both hosts invoke this
command only after skill selection.

## Profile and analogy boundary

The production profile is authored by the user and stored locally. It is the
source of truth; Fairytail does not classify the user into a seed profession or
personality.

The absence of a profile is not treated as inferred profile data. Fairytail may
show one reviewed generic first-use analogy, chosen only by scenario and locale,
without saving it or guessing the user's job. An approved profile continues to
receive that reviewed generic analogy until a valid personal map exists. Saved
neutral and `no_analogy` choices suppress it.

Claude Code stores this profile in its host-managed plugin-data directory.
Codex resolves one stable directory at `${CODEX_HOME:-~/.codex}/fairytail`.
Both may be overridden with an explicit local data directory. Raw onboarding
answers are entered in the local interactive CLI rather than the host chat;
`doctor` exposes only completion state, processing mode, and approved field
names.

The profile contains bounded fields for:

- preferred language;
- up to five short familiar contexts or anchors;
- observed coding actions;
- presentation preference;
- selected safety concerns;
- consent state for personalization.

When personalization is approved, Fairytail constructs a projection containing
only the language, presentation preference, and approved familiar labels. The
projection is bound to an approval digest. A mapper request adds only the
scenario ID, fixed concept ID, role IDs, and reviewed relation directions. It
does not contain source code, commands, permissions, safety decisions,
verification output, raw history, or the rest of the profile.

A candidate mapping is accepted only when:

- it copies one approved context;
- every required role is present exactly once;
- every role value is an approved label or allowed pair of approved labels;
- no unexpected key or unsafe value exists;
- relation direction and canonical fact hashes remain local and unchanged.

Accepted mappings are stored locally and reused. Saved neutral and no-analogy
modes do not create a profile projection and do not fall back to the generic
first-use analogy. The three bundled worlds are regression fixtures only and
are never presented as user categories.

## Build lane

`skills/build/SKILL.md` is a separate semantic workflow for non-trivial
repository implementation. The host may select it from a natural request, and
an explicit qualified invocation remains the deterministic override. It adapts
the following Ponytail ideas from a pinned MIT commit:

- remove or reuse before adding;
- prefer the standard library, platform, and installed dependencies;
- fix a shared root cause rather than patching repeated symptoms;
- stop at the first complete working rung;
- preserve security, data-loss prevention, accessibility, and explicit scope;
- leave one smallest runnable regression check for non-trivial logic.

The build lane does not decide how much teaching prose to produce. The concept
lane does not decide what code to write. A trivial label, copy, comment, or
obvious local configuration change should stay on the host path even if the
build skill is accidentally considered.

## Optional model boundaries

The direct concept route makes no model call. Claude Code includes two optional
specialized presentation surfaces; Codex can use its active model only after a
manual `$fairytail:personalize` invocation:

| Surface                    | Allowed work                                                    | Hard boundary                                              |
| -------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------- |
| `fairytail-analogy-mapper` | Fill approved analogy noun slots for one scenario               | One turn, no tools, fixed model, exact JSON candidate only |
| `fairytail-explainer`      | Select section order and full/compact detail after verification | One turn, no tools, no content authoring                   |

Neither optional agent nor Codex personalization may author facts, code,
commands, safety decisions, permissions, or verification. Codex receives the
same consent-bound request and may return only the exact candidate keys and noun
slots before local validation. Invalid, unavailable, oversized, or malformed
results fall back to deterministic output. Ordinary Codex explanation remains
the direct deterministic path.

## Host packaging

The repository root is the plugin root for both hosts:

```text
.claude-plugin/          Claude manifest and repository marketplace
.codex-plugin/           Codex manifest
.agents/plugins/         Codex repository marketplace
skills/                  Shared skill source of truth
agents/                  Optional Claude agents
hooks/                   Shared additive lifecycle hooks
scripts/                 Closed CLIs and verification tools
src/                     Runtime implementation
content/                 Reviewed facts, scenarios, and locales
schemas/                 Closed JSON contracts
```

Both manifests point to the same `skills/` tree. There is no generated second
implementation. The shared tree avoids semantic drift, while host-specific
metadata under `agents/openai.yaml` controls Codex implicit invocation.

## Compatibility with other harnesses

Fairytail is an adapter, not an orchestrator. Existing harnesses keep ownership
of planning, tools, permissions, and task completion. The integration layer:

- detects common host and harness markers;
- never overwrites `AGENTS.md`, `CLAUDE.md`, `.omx/`, `.omo/`, or generic agent
  directories;
- treats another active Fairytail adapter as a duplicate and refuses to emit a
  second explanation;
- records only bounded envelope events rather than raw prompts or tool output;
- limits automatic tool hooks to Bash, mutation-capable file tools, and MCP
  tools instead of spawning them for read/search tools;
- returns no Fairytail decision for a reversible single-file local Write/Edit,
  leaving the host's normal permission policy in control;
- never returns a permission grant from the safety surface.

## Current verification contract

The declared performance evaluator is:

```bash
npm run check:context-gate
```

It passes only when the focused gate and the full release gate pass. Current
direct-route assertions include:

- 26 aliases × 2 locales = 52 successful renders;
- at most 1,013 observed bytes and a fixed 4 KiB ceiling per concept;
- a 1,581-byte API + server + database map below its 12 KiB ceiling;
- a 64-prompt bilingual semantic-intent contract: 48 Concept cases and 16
  Build cases, balanced across 32 English / 32 Korean prompts;
- no prompt-submission hook, zero Fairytail prompt-hook context bytes, and
  2,485 raw skill-description bytes below a fixed 2.5 KiB budget;
- ten distinct generic analogy labels per locale, one for each reviewed concept
  family, with an explicit breakpoint for every family;
- zero model, network, and execution calls;
- semantic build metadata plus stop instructions for trivial and routine edits;
- source-pinned deterministic visual and terminal evidence;
- plugin shape, skill metadata, type, content, locale, privacy, analogy,
  installation, and host lifecycle checks.

The five structural explanation fixtures improve explicit support-field
coverage from `2/9` to `9/9`. That metric checks disclosure structure only. No
consented novice pilot has been completed (`0/3`), so the project does not claim
better human comprehension.

## Claim boundaries

Supported:

- the direct path is local, deterministic, bounded, and reproducible;
- Fairytail installs no prompt-submission hook or raw-prompt logger;
- the shared semantic selector documents positive and negative intent in one
  host-visible source of truth;
- current reviewed aliases render in English and Korean;
- the production profile is user-authored and locally stored;
- missing-profile first use is generic rather than profession-inferred, while a
  saved no-analogy choice remains authoritative;
- invalid personalization fails to neutral content;
- the minimal-build policy is separated from explanation depth;
- the repository packages and validates for Claude Code and Codex.

Not supported:

- universal token or cost savings for every host request;
- zero host input tokens; skill metadata, selected instructions, renderer
  output, and host framing still count under host-specific tokenization;
- a hard natural-language classifier invariant across all future host versions;
- automatic trust in an MCP server, API, model, tool, or plugin;
- proof that a user learned faster or understood more;
- permission, completion, or safety decisions derived from an analogy.
