# Fairytail

![A friendly fairy guide turns dense code into a clear, safe path](docs/assets/fairytail-hero.png)

**Minimal code. Maximal clarity — only when it helps.**

Fairytail is a Claude Code and Codex plugin for people learning to build with
coding agents. It keeps routine work out of the way, applies a Ponytail-derived
minimal-build policy to non-trivial repository implementation, and turns
reviewed system concepts into bounded English or Korean explanations when the
user asks for beginner help, an analogy, personalization, or an initial-design
walkthrough. Claude Code and Codex select those shared skills from semantic
descriptions; Fairytail does not maintain a second keyword classifier.

[Codex quick start](#codex-quick-start-recommended) ·
[Korean guide](README.ko.md) · [Architecture](ARCHITECTURE.md) ·
[Performance](docs/PERFORMANCE.md) · [Privacy](PRIVACY.md)

## See the difference in 30 seconds

> “I am designing my first app. Explain how MCP, an API, an access token, a
> server, and a database work together using a familiar restaurant workflow.”

![A jargon-dense system flow beside the same read-only flow rendered as one familiar restaurant workflow](docs/assets/evidence/jargon-to-clarity.png)

The left side deliberately compresses the flow into specialist terms. The
right side preserves the same read-only scenario, but adds one familiar map,
the point where the map stops being accurate, and the checks required before
anything runs. The image is a reproducible synthetic illustration, not a
cherry-picked host transcript or a human-comprehension result.

### Same prompt, smaller implementation

In one controlled Codex CLI 0.144.5 pair, both arms received the same natural
feature request, used GPT-5.6 Sol, and passed every requested path-safety case.
Fairytail selected its build policy without an extra command.

| One paired run                    | Native Codex | Fairytail | Difference |
| --------------------------------- | -----------: | --------: | ---------: |
| Added implementation source lines |           38 |        22 |   **-42%** |
| Added source + focused test lines |           83 |        53 |   **-36%** |
| Final response words              |           49 |        49 |     **0%** |
| Host-reported output tokens       |        2,135 |     2,036 |  **-4.6%** |
| Requested cases passing           |          Yes |       Yes |          — |

This is an illustrative paired run, not a statistical benchmark or a universal
token-saving claim. Fairytail's host input-token count was higher in this run;
the exact prompt, method, and limitation are in
[Performance](docs/PERFORMANCE.md).

Run the fixed API/server/database walkthrough from a public clone with Node.js
22 or newer; dependency installation and an API key are not required:

```bash
npm run --silent demo
npm run --silent demo -- ko
```

This explicit demo ignores stored profile data and its data-directory setting,
then uses the default in-memory first-use state and the same bounded renderer
that installed hosts invoke. It is a reproducible product sample, not a
host-routing or comprehension benchmark.

### Current release gate

| What is measured                             |                                                   Current result |
| -------------------------------------------- | ---------------------------------------------------------------: |
| Reviewed aliases × locales                   |                                                 **52/52 passed** |
| Bilingual semantic-intent contract           |             **64 prompts**: 48 concept + 16 build, 32 EN / 32 KO |
| Generic analogy contract                     |         **10/10 concept families per locale**, each with a limit |
| Personalized analogy regression              |            **30/30 passed**, zero hard failures, facts unchanged |
| Codex beginner onboarding journey            | **7/7 tasks passed** in a disposable Korean first-use simulation |
| Largest observed explanation payload         |                                                  **1,013 bytes** |
| Hard ceiling per concept                     |                                                        **4 KiB** |
| Connected API + server + database design map |                          **1,581 bytes**, below a 12 KiB ceiling |
| Same-scenario alias bundle                   |           **3 aliases → 1 reviewed card**, 1,013 bytes in Korean |
| Fairytail prompt-submit hook                 |                         **absent**; **0 injected context bytes** |
| Shared skill descriptions                    |                  **2,485 bytes**, below a 2.5 KiB listing budget |
| Extra work inside the direct renderer        | **zero model calls**, zero network calls, zero command execution |
| Full audit-formatter support fields          |                        **2/9 → 9/9** in all 5 synthetic fixtures |

The payload limit prevents the rich route from turning into an open-ended
context search. The separate full audit formatter produces the `2/9 → 9/9`
result by checking whether required explanation fields are present. It is not
the compact direct answer shown to users, nor a score of how well a person
understood it.

Bundles also collapse aliases that share one reviewed scenario. Asking about
`api-key`, `access-token`, and `llm-token` together keeps all three requested
labels but renders their reviewed distinction once instead of repeating the
same card three times.
Full inputs, limitations, and reproduction commands are in
[Performance](docs/PERFORMANCE.md).

## Built with Codex and GPT-5.6

Codex was the primary environment used to turn the product notes into the
plugin, tests, privacy boundaries, public-install checks, and release
documentation. During OpenAI Build Week, a persistent GPT-5.6 Sol Codex session
reviewed the real repository and challenged the judge path. Its recommendation
shaped the judge path: keep one closed command, then improve the real
generic initial-design route from repeated cards into one connected map instead
of adding a second demo runtime or making a broader efficiency claim.

GPT-5.6 was used where frontier reasoning was valuable—architecture review,
claim review, and demo design. The repeated direct explanation remains local
and deterministic. The candid project story, including discarded persona and
keyword-gate designs, is in
[OpenAI Build Week project story](docs/OPENAI_BUILD_WEEK_ABOUT.md).

## Rich when requested, quiet by default

Fairytail's skill description asks the host to select the rich explanation
layer for explicit beginner needs, confusion, analogy or personalization
requests, concept comparisons, and initial system design. It asks the host to
leave ordinary definitions, unsupported concepts, and trivial or routine edits
on the normal path. A separate build description is eligible only for
non-trivial repository implementation.

| User request                                                | Fairytail behavior                                             |
| ----------------------------------------------------------- | -------------------------------------------------------------- |
| “Use Fairytail to explain MCP in Korean.”                   | Rich reviewed concept explanation                              |
| “Explain API with an analogy I would understand.”           | Saved approved mapping, or a labeled generic first-use analogy |
| “I am designing my first app; explain API, server, and DB.” | One bounded initial-design bundle, at most 3 concepts          |
| “What is an API?”                                           | Host-default answer; do not expand into the rich layer         |
| “Change this button label.”                                 | Host-default edit; no Fairytail workflow or extra approval     |
| “Add the smallest safe implementation for this feature.”    | Semantic minimal-build policy for non-trivial repository work  |
| `/fairytail:build ...` or `$fairytail:build ...`            | Deterministic explicit override for the same build policy      |

Both hosts read the same semantic skill description. The full skill body and
local renderer run only after the host selects it; there is no
`UserPromptSubmit` keyword router. `build` permits semantic selection for its
narrow non-trivial implementation boundary; `before`, `finish`, and
`personalize` remain manual-only workflows, and `doctor` and `profile` remain
explicit-only management skills. The bilingual contract separates 48 Concept
prompts from 16 Build prompts, so a non-trivial implementation may correctly
select Build while keeping the rich Concept renderer off. Bounded live probes
sample actual host selection before release.

## How the personalized explanation works

The generic English/Korean explanation and stored-profile onboarding paths work
on both hosts. Claude Code uses its plugin-data directory. Codex uses
`${CODEX_HOME:-~/.codex}/fairytail`, unless the user explicitly supplies a
different Fairytail data directory. Beginners do not need to know or configure
this path.

1. The user completes a five-question local onboarding flow in English or
   Korean.
2. Their own familiar contexts, roles, objects, and routines are stored as the
   source of truth. Fairytail does not assign a hospital, student, or other seed
   persona.
3. If personalization is approved, only language, presentation preference, and
   up to five approved short labels may enter a bounded analogy-mapping request.
4. The mapper may fill predefined noun slots only. Definitions, relation
   direction, safety limits, code, commands, permissions, and verification stay
   in reviewed local content.
5. A valid mapping is stored locally and reused. Before onboarding, and while
   an approved personal map is still pending, Fairytail uses one short,
   concept-specific generic analogy without inferring a job or persona. A
   stored neutral or no-analogy preference remains authoritative.
6. The direct renderer selects English or Korean and enforces the byte ceiling
   before returning text.

The three bundled persona-like worlds exist only as regression fixtures. They
are never production profile choices.

The reviewed catalog currently covers ten concept families. The generic API,
server, and database cards share a restaurant flow because their relationships
line up; the other seven use different pictures such as a toolbox, setup card,
access badge, service directory, project binder, or public stage. A
user-authored familiar world can replace a generic picture after exact-slot
validation. An unsupported concept stays with the host instead of receiving a
made-up “reviewed” analogy.

## Install

Requirements: Node.js 22 or newer, plus Claude Code or Codex CLI on `PATH`.
`npm`, a source clone, and changes to `AGENTS.md` are not required for normal
use.

### Let a coding agent install it

Already talking to a terminal-capable coding agent? Give it this README or the
repository URL together with the following instruction:

```text
Install Fairytail from https://github.com/ernestolee13/fairytail for me.
Detect whether I am using Codex CLI or Claude Code, verify Node.js 22 or newer,
and use only the matching marketplace installation commands from the README.
Do not clone the source, run npm, or modify my project files. Verify the
installed plugin with the host CLI. Then tell me to start a new thread or
session, guide me through Fairytail's private onboarding, and give me one
explicit first-use prompt in my language.
```

The agent still needs normal permission to run installation commands. It
cannot make an already-open Codex thread discover a newly installed plugin, so
the final new-thread step is intentional.

### Codex quick start (recommended)

Check the two runtime requirements:

```bash
node --version
codex --version
```

For a first installation, add the public marketplace and install Fairytail:

```bash
codex plugin marketplace add ernestolee13/fairytail
codex plugin add fairytail@fairytail
codex plugin list --json
```

The final command should list `fairytail` as installed. Start a **new Codex
thread**, run `/skills`, and confirm that `Fairytail Onboard`, `Fairytail
Doctor`, and `fairytail-explain-concept` appear.

Enter these in the **Codex chat**, not in a shell:

```text
$fairytail:doctor Diagnose my setup without showing profile answers.
$fairytail:onboard Set up my profile in Korean.
```

The onboarding skill first checks non-sensitive status. If setup is needed, it
prints one `node ... fairytail-profile.mjs onboard --host codex --locale ko`
command using the installed plugin's real path. Paste that command into a
separate local terminal and answer the five questions there. Raw background
answers never need to enter the Codex conversation. Return to Codex after the
terminal says the profile was saved; `$fairytail:doctor` then reports
`onboarding.required: false` without revealing the answers.

The `fairytail:` namespace targets this plugin even when another installed
harness has its own `doctor` or `onboard` skill. `/skills` shows the same
components as `fairytail:doctor` and `fairytail:onboard`. Fairytail does not edit
or replace the other plugin.

Then try the reliable explicit explanation route in the **Codex chat**:

```text
$fairytail:fairytail-explain-concept Explain MCP in Korean with a beginner-friendly analogy and its limit.
```

For the fixed judge/demo bundle, use:

```text
$fairytail:fairytail-explain-concept demo ko
```

You can also ask naturally when you want the richer layer:

```text
I am designing my first app. Explain how an API, a server, and a database work together using one familiar analogy.
```

Codex may select Fairytail implicitly from that intent. Use the fully qualified
`$fairytail:fairytail-explain-concept` form whenever you want deterministic,
conflict-safe selection. A bare question such as `What is an API?`
intentionally stays on Codex's normal answer path.

For a natural non-trivial repository implementation request, Codex may select
the separate minimal-build policy automatically. Use the qualified form when
you want a deterministic, conflict-safe override:

```text
$fairytail:build Add the smallest safe implementation for this non-trivial task.
```

Fairytail works beside existing `AGENTS.md`, skills, and orchestration plugins;
it does not replace or edit them. Codex gets reviewed English/Korean generic
analogies immediately, plus a private five-question local profile through the
`$fairytail:onboard`, `$fairytail:profile`, and `$fairytail:doctor` skills.
`$fairytail:personalize` is optional and manual; without it, an approved profile
still receives the reviewed generic analogy instead of an empty explanation.

To update the Codex installation, refresh its marketplace snapshot and
reinstall the plugin, then start a new thread:

```bash
codex plugin marketplace upgrade fairytail
codex plugin remove fairytail@fairytail
codex plugin add fairytail@fairytail
```

To remove Fairytail completely:

```bash
codex plugin remove fairytail@fairytail
codex plugin marketplace remove fairytail
```

If the skill does not appear, confirm the plugin with `codex plugin list
--json`, then restart Codex and open `/skills` again.

#### Codex troubleshooting and profile recovery

- If `node --version` is below 22, upgrade or activate Node.js 22+, then repeat
  the install commands.
- If the local onboarding command fails, enter `$fairytail:doctor` in Codex
  chat. Refresh and reinstall the marketplace snapshot if needed, then start a
  new thread before retrying onboarding.
- If the saved preferences are wrong, enter `$fairytail:profile` in Codex chat.
  It may check safe status, but it will give `edit` and `preview` as commands for
  a separate local terminal so raw values do not enter the conversation.
- `neutral` keeps the profile local without projecting it to a model;
  `no-analogy` suppresses personal and generic analogies; `reset` replaces the
  preferences with a blank local profile; and `delete` removes only the exact
  Fairytail profile file. Run a change only after explicitly requesting it.

### Claude Code

```bash
claude plugin marketplace add ernestolee13/fairytail
claude plugin install fairytail@fairytail
claude plugin enable fairytail@fairytail
```

Then start a new Claude Code session and run:

```text
/fairytail:doctor
/fairytail:onboard
```

Try an explicit rich request:

```text
Use Fairytail to explain MCP in Korean with an analogy a beginner can follow.
```

For meaningful repository implementation, ask naturally or use the explicit
override:

```text
/fairytail:build Add the smallest safe implementation for this feature.
```

See [Public install and samples](docs/PUBLIC_INSTALL_AND_SAMPLES.md) for the
exact release smoke boundary.

## Why it stays small

The implementation and explanation lanes are separate:

```text
ordinary question or trivial edit ───────────────► host default path

non-trivial repository implementation ─► host selects minimal-build policy
                                             │
explicit build override ─────────────────────┘─► smallest correct diff

semantic beginner / analogy intent ──┐
initial system-design intent ─────────┴─► host selects shared concept skill
                                          │
                                          ▼
                                      reviewed concept alias
                                          │
local profile + cached approved map ──────┤
no profile ─► labeled generic fallback ───┤
                                          ▼
                               deterministic EN/KO renderer
                                4 KiB per concept, max 3 concepts
```

The direct concept route does not inspect the project, reconstruct source
material, or call another model. After semantic skill selection, Claude Code
and Codex invoke the same bundled direct command. A manually invoked
personalization step may ask the active host model to fill consent-bound noun
slots after facts are fixed; local validation rejects everything else. Details
are in [Architecture](ARCHITECTURE.md).

## Works beside existing harnesses

Fairytail is additive. It does not replace Claude Code, Codex, Superpowers,
oh-my-opencode, oh-my-codex, or another orchestrator. The host retains planning,
tool permissions, execution, and completion judgment. Fairytail contributes:

- a narrowly selected minimal-build policy for non-trivial repository work;
- reviewed beginner concepts and analogy breakpoints;
- local profile and consent boundaries;
- pre-action, error, finish, and safety surfaces that never grant permission;
- duplicate-adapter detection so one event is not explained twice.

It does not overwrite `AGENTS.md`, `CLAUDE.md`, `.omx/`, `.omo/`, or another
plugin's files.

## Privacy and safety

- The raw profile stays in Fairytail's local data directory and is not committed
  to the project.
- Neutral and no-analogy modes send no Fairytail profile projection.
- Personalized mapping exposes only the exact approved projection shown during
  onboarding.
- Raw prompts, source code, commands, tool output, secrets, logs, and learning
  history are excluded from the mapping request.
- Fairytail installs no prompt-submission hook or raw-prompt logger. Skill
  selection belongs to the host's normal semantic routing.
- An analogy never grants permission or weakens a safety check.
- Corrupt or over-broad input fails to neutral output.

Read the full [privacy contract](PRIVACY.md).

## Verify from source

```bash
git clone https://github.com/ernestolee13/fairytail.git
cd fairytail
npm ci
npm run check:context-gate
npm run smoke:codex:beginner
```

The last command runs seven first-use tasks in a disposable `CODEX_HOME`:
fresh Korean status, five-question persistence, doctor, generic pending-map
fallback, approved mapping, and reuse. It is an automated product-journey
check, not a study of a person's comprehension.

The declared evaluator runs the focused semantic-selection contract, bounded
renderer checks, current deterministic evidence, and the full release
regression suite. The exact measurements and smaller developer-only commands
are in [Performance](docs/PERFORMANCE.md).

The release gate covers formatting, strict type checking, content and locale
validation, all repository tests, analogy evaluation, Claude and Codex plugin
validation, isolated install/load/remove smokes, deterministic evidence hashes,
the seven-step disposable Codex beginner journey, and the semantic activation
contract plus context boundaries.

## Evidence boundary

Fairytail currently proves bounded local behavior, task completion in a
simulated first-time Codex journey, and structural coverage. It does not yet
prove better human comprehension: the consented novice pilot is still `0/3`.
Natural-language skill selection belongs partly to each host, so
the repository reports exact observed smoke prompts rather than claiming a
cross-host classifier invariant. Model telemetry can also vary with host
version, routing, cache state, and account policy.

## Project docs

- [Architecture](ARCHITECTURE.md) — components, trust boundaries, activation,
  profile flow, and model routing
- [Performance](docs/PERFORMANCE.md) — current-only measurements and limits
- [Beginner examples](docs/BEGINNER_EXAMPLES.md) — API, server, database,
  tokens, and MCP
- [Public install and samples](docs/PUBLIC_INSTALL_AND_SAMPLES.md) — fresh
  clone and host smoke results

## Ponytail attribution

Fairytail's build workflow adapts Ponytail's decision ladder,
root-cause-first rule, anti-scaffolding constraints, safety exceptions, and
smallest-runnable-check rule from commit
[`16f29800fd2681bdf24f3eb4ccffe38be3baec6b`](https://github.com/DietrichGebert/ponytail/tree/16f29800fd2681bdf24f3eb4ccffe38be3baec6b)
under the MIT License. Fairytail's profile, explanation, localization, and
safety layers are separate work. See [Third-party notices](THIRD_PARTY_NOTICES.md).

MIT licensed. See [LICENSE](LICENSE).
