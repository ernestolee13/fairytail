# Current performance and claim boundaries

Fairytail's release metric is the bounded Direct concept route. It is measured
separately from implementation work because build-model tokens and explanation
payload size are different quantities.

## Headline results

| Current direct-route check         |                    Result |
| ---------------------------------- | ------------------------: |
| Reviewed aliases                   |                        26 |
| Locales                            |          English + Korean |
| Rendered cases                     |          **52/52 passed** |
| Largest observed payload           |           **1,013 bytes** |
| Fixed per-concept ceiling          |   **4,096 bytes (4 KiB)** |
| API + server + database map        |           **1,581 bytes** |
| Fixed three-concept bundle ceiling | **12,288 bytes (12 KiB)** |
| Model calls                        |                     **0** |
| Network calls                      |                     **0** |
| Command execution calls            |                     **0** |

The separate personalized-analogy regression covers three fixture worlds × ten
reviewed scenarios. All `30/30` cases pass with zero hard failures and identical
canonical fact hashes. This proves the closed mapping contract preserves the
reviewed facts; it does not prove that every user will prefer every analogy.

The verifier records local render timing, but timing depends on the machine and
filesystem. The release contract therefore uses a conservative `< 2 s` ceiling
for each case instead of publishing one local run as a universal latency claim.

The three-concept route is allowed only for a semantically clear or explicitly
invoked initial-design walkthrough. When the API, server, and database concepts
use the reviewed generic picture, the renderer combines them into one connected
map instead of repeating three standalone cards. A stored personalized,
neutral, or no-analogy choice remains authoritative. A routine concept question
remains one concept, and an ordinary definition should stay on the host-default
path.

## What “zero model calls” means

The direct renderer reads reviewed local content, an optional local profile,
and an optional cached approved analogy map. It then formats the result without
calling another model. Therefore it spends no additional provider tokens inside
the renderer.

The displayed explanation still contains text. Fairytail installs no
`UserPromptSubmit` hook, so it adds zero prompt-hook context bytes. The eleven
always-listed skill descriptions use 2,485 raw UTF-8 bytes, below a fixed 2.5
KiB budget before host framing and tokenization. When a host selects the
concept skill, its instructions, command output, and final text may all count
under that host's token rules. Fairytail does not call those words “zero
tokens.” The stable release limit is expressed in UTF-8 bytes because it can be
enforced identically without depending on a provider or tokenizer version.

No current universal token-saving claim is made for the full Claude or Codex
session. A future comparative token claim must use the same task, host version,
model, routing, cache state, and repetition policy for every arm.

## One paired GPT-5.6 implementation probe

On 2026-07-19, two fresh temporary Git repositories received this exact prompt
concurrently through Codex CLI 0.144.5 and GPT-5.6 Sol:

> Complete the note path helper in this repository. It receives a root
> directory and a user-supplied relative path. Return the normalized absolute
> path only when it stays below root; reject empty, non-string, absolute,
> NUL-containing, and traversal inputs. Add focused tests and verify the
> change. Do not add runtime dependencies.

The repositories had the same three-line function stub, `node --test`, no
dependencies, and no project instructions. Both runs were ephemeral and used
workspace-write sandboxing. The Fairytail arm selected `build` semantically;
the native arm had no Fairytail plugin.

| Observed measure                | Native Codex | Fairytail | Change |
| ------------------------------- | -----------: | --------: | -----: |
| Requested cases pass            |          Yes |       Yes |      — |
| Added implementation source LOC |           38 |        22 | -42.1% |
| New focused-test LOC            |           45 |        31 | -31.1% |
| Total added source + test LOC   |           83 |        53 | -36.1% |
| Final response words            |           49 |        49 |   0.0% |
| Host-reported output tokens     |        2,135 |     2,036 |  -4.6% |
| Host-reported input tokens      |       95,711 |   120,592 | +26.0% |

Source LOC comes from the final tracked source diff; new test LOC is the new
test file line count. Final-response words use `wc -w`. Host token counts come
from each `turn.completed` event. The pair shows the intended product shape in
one concrete task: less implementation code without a longer final
explanation. It does not establish a population mean. The higher Fairytail
input count means this run is not evidence of lower total session tokens or
cost.

A separate installed-Codex probe changed one package-name literal. The build
skill stayed unselected, the diff remained one line, and JSON validation passed.

## Separate full audit-formatter check

Five synthetic reviewed scenarios cover server, API, credential token,
database, and MCP. The deliberately compact formatter exposes two of nine
explicit beginner-support fields. Fairytail's full audit formatter exposes all
nine in every fixture:

| Metric                          | Compact formatter |      Fairytail |
| ------------------------------- | ----------------: | -------------: |
| Explicit support-field coverage |    `2/9` in `5/5` | `9/9` in `5/5` |
| Model calls                     |                 0 |              0 |
| Network calls                   |                 0 |              0 |

The nine fields cover verified outcome, verification evidence, canonical
definition, familiar relation map, analogy breakpoint, safety boundary,
target/risk/rollback, next-action evidence, and a diagnostic question. This is
a disclosure-structure metric, not the compact direct-route payload and not a
comprehension or learning score.

## Semantic activation and context boundary

Claude Code and Codex read the same skill description. It defines the intended
positive and negative semantic boundary; Fairytail no longer duplicates that
decision in a regex classifier.

| Intended route | Examples                                                                                                                   | Required host behavior                                                 |
| -------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Rich concept   | explicit Fairytail, beginner/plain-language need, confusion, analogy, personalization, concept distinction, initial design | Select `fairytail-explain-concept`, then run the bundled renderer once |
| Minimal build  | non-trivial repository implementation, fix, or simplification                                                              | Select `build`; retain host planning, tools, and verification          |
| Host default   | ordinary short definition, unsupported concept, design-only work without beginner-teaching intent, trivial or routine edit | Do not run a Fairytail implementation or concept workflow              |

The checked intent contract contains 64 prompts: 48 Concept cases (24 rich and
24 default) plus 16 Build cases (8 minimal and 8 default), with 32 English and
32 Korean cases. The split matters: a non-trivial implementation may correctly
select Build while the rich Concept renderer stays off. It includes contextual
follow-ups, incidental use of “beginner,” design-only near misses, routine
edits, non-trivial implementation, and common concept comparisons. This is a
product contract, not classifier accuracy: actual selection remains host-owned
and is measured with bounded live probes.

## Repeated-alias compression

Several public aliases intentionally share one reviewed scenario. A bundle now
keeps the requested aliases but renders each scenario once. For example,
`api-key,access-token,llm-token` produces one reviewed distinction card rather
than three byte-identical cards: 853 bytes in English and 1,013 bytes in Korean,
with zero model, network, or execution calls. The same rule applies to
`mcp,tool,resource`. Distinct scenarios still retain their separate safety and
analogy-limit content unless a reviewed connected map exists.

For Codex, `build` permits narrow implicit selection for non-trivial repository
implementation. `before`, `finish`, `personalize`, `profile`, and `doctor`
remain manual-only in metadata. The concept and onboarding skills permit their
own narrow implicit selection and explicit invocation. Claude reads the same
boundaries from skill descriptions. Once selected, the concept skill starts
with the bundled command and forbids
repository inspection, source reconstruction, and model-assisted fact
generation.

On either host, a missing profile receives a reviewed generic first-use analogy
chosen by scenario and locale, never by inferred profession. An approved
profile continues to receive that generic analogy while its optional personal
map is pending. Saved neutral and `no_analogy` states suppress it and remain the
source of truth.

The current catalog has ten concept families and ten distinct generic analogy
labels in each locale. Server, API, and database share a restaurant workflow so
their relationship remains coherent; the other seven use separate pictures.
Each family includes an explicit point where the analogy stops matching. A
user-authored familiar world may replace the generic picture only through the
closed role-binding contract. Unsupported concepts remain host-owned.

Natural-language selection remains partly host-owned, so the repository reports
the exact observed prompts and host versions in
[Public install and samples](PUBLIC_INSTALL_AND_SAMPLES.md) instead of claiming
a permanent cross-host classifier guarantee.

## Reproduce

The focused evaluator is:

```bash
npm run check:context-gate
```

The smallest deterministic checks are:

```bash
npm run verify:context-gate
npm run verify:g012
```

`verify:context-gate` runs all 26 aliases in both locales, the explicit
three-concept bundle, repeated-alias compression, the 64-prompt bilingual
intent contract, and the ten-family analogy-diversity contract. `verify:g012`
recomputes the current source pins and
report at
[`benchmarks/current/output-efficiency.json`](../benchmarks/current/output-efficiency.json).

The full release gate also runs formatting, strict type checks, content and
locale validators, the complete repository test suite, analogy evaluation,
plugin validators, isolated Claude/Codex packaging smokes, and public-clone
checks.

## Automated Codex beginner journey

`smoke:codex:beginner` creates a disposable `CODEX_HOME` and completes seven
observable tasks in Korean: fresh status, the five-question local flow, private
profile persistence, doctor status, generic explanation while a map is pending,
consent-bound personalization, and reuse of the accepted map. The current
result is `7/7`; the profile directory and file are checked as `0700` and
`0600`, and the final renderer reports zero model, network, and execution calls.

This is a product-flow proxy. It shows that commands connect and fail-safe
boundaries hold. It does not show that a person understood the explanation,
preferred it, or completed setup without hesitation.

## What is not measured

- No consented novice has completed the pilot (`0/3`).
- Structural coverage is not human understanding.
- Local millisecond observations are not a cross-machine latency benchmark.
- Deterministic payload bytes are not full-session model tokens.
- Zero renderer model calls and zero prompt-hook bytes do not mean zero host
  tokens; skill metadata, selected instructions, and returned text still count.
- A trivial or routine edit stays on the host path. The one paired build result
  above is illustrative, not proof that every non-trivial run is shorter.
- Host model telemetry can change with version, model, routing, caching,
  account policy, and service conditions.
