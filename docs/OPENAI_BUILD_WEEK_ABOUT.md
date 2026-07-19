## Why I built Fairytail

I started this project after collecting material for people who are trying vibe
coding for the first time. The recurring problem was not syntax. It was the
moment when a coding agent casually mentioned an API, server, database, token,
MCP server, or deployment as if the user already had a map of how those pieces
fit together.

The code could work while the person approving it still had no idea what was
happening.

I wanted one plugin that could add that missing map without turning every Codex
conversation into a tutorial. That constraint became the core of Fairytail:
stay quiet during ordinary work, but become much more helpful when someone is
confused, asks for an analogy, or is designing a first system.

The name is deliberate. It is partly a nod to Ponytail, whose minimal-build
discipline influenced the project, and partly the idea of a friendly guide who
can turn intimidating system language into a story a beginner can follow.
Fairytail applies that discipline to seek the smallest safe implementation,
but does not claim that every model run will produce less code. It spends its
separate extra layer on explanation without asking every response to become a
tutorial.

## The product changed while I was building it

My first instinct was to prepare a few personas—perhaps a student, a medical
worker, or a designer—and map technical ideas to examples from those worlds.
That did not survive scrutiny. Most people would not fit one of those seeds,
and guessing a person's identity from a short answer felt wrong.

Fairytail now asks five optional local questions instead. The user's own words
are the source of truth. The profile can describe a familiar world, preferred
style, current goal, and known concepts, but it remains local and revocable.
Raw answers do not need to enter the model conversation. If a personalized
mapping is missing or fails validation, Fairytail uses a reviewed generic
example rather than inventing a persona.

Activation went through a similar correction. A keyword gate looked easy to
measure, but it was too mechanical. An always-on prompt hook would also charge
every request for a feature that is only useful sometimes. The current plugin
uses the host's semantic skill selection instead. Its skill description says
both when to activate and when not to activate.

For example:

- `What is an API?` stays on the normal Codex path.
- A trivial implementation stays on the normal host path; a non-trivial
  repository change may select the separate minimal-build skill.
- `I am designing my first app. Explain how an API, a server, and a database
work together using one familiar analogy.` can select Fairytail's richer
  walkthrough.

That negative boundary is as important to me as the explanation itself.

## How it works

Fairytail is an installable plugin for Codex CLI and Claude Code. It has four
small layers:

1. The host decides whether the request has genuine beginner-teaching intent.
2. Fairytail loads reviewed facts for the requested concepts. English is the
   source language; Korean is a reviewed presentation locale using the same
   concept IDs and safety boundaries.
3. If the user approved a local profile and a validated analogy mapping exists,
   the renderer can use it. Otherwise it uses a reviewed generic analogy or a
   neutral explanation.
4. A deterministic renderer formats the final answer with a mental model,
   important relationships, a safety boundary, and an explicit explanation of
   where the analogy stops working.

The direct renderer has no model client, network client, command runner, or
repository-search step. It is limited to three concepts and 12 KiB for an
initial-design bundle. Fairytail does not replace Codex, modify a project's
`AGENTS.md`, or take control of tools and permissions.

This also lets it coexist with larger harnesses such as Superpowers,
oh-my-opencode, and oh-my-codex. Those tools can continue to orchestrate work;
Fairytail contributes only its narrow teaching and minimal-build policies.

## A token result that changed my pitch

At one point I compared Fairytail with a native run and Ponytail. Fairytail's
explanation used substantially more output tokens. Presenting that as a general
efficiency win would have been misleading.

The useful result was different: ordinary prompts should not pay for the rich
layer at all, and explicit beginner requests should receive a bounded answer
whose extra structure is intentional. I removed the broad token-saving claim
and separated two questions:

- Does Fairytail stay out of requests that do not need it?
- When it does activate, is the result bounded, structured, and reproducible?

This is why the current evidence focuses on activation boundaries, renderer
effects, payload limits, installation, and privacy. I do not claim that a
longer answer is automatically easier to understand.

## How Codex and GPT-5.6 were used

Codex was my primary development environment. I used it to turn the initial
idea and research notes into a PRD, inspect the repository, implement the
plugin, review privacy boundaries, design tests, run fresh-install checks, and
prepare the public release.

I also used a persistent GPT-5.6 Sol Codex session during OpenAI Build Week to
inspect the actual repository and challenge the judge experience. Its most
useful recommendation was restraint: keep a closed command instead of adding a
second demo runtime. A same-model design comparison then exposed that repeating
three otherwise-good cards was still too long, so I changed the production
generic API/server/database route itself into one connected map.

That reflects how I want to use a frontier model in this project. GPT-5.6 is
valuable for reviewing architecture and finding weak claims. Repeated concept
rendering does not need to spend another model call when reviewed local content
can do the job.

## What I tested

The current release has reproducible checks for:

- 52/52 direct renders across 26 aliases and two locales;
- 48 balanced English and Korean intent fixtures, split between rich and
  default routes;
- 10 reviewed generic analogy families per locale;
- 30/30 personalized role-mapping fixtures;
- a 7/7 disposable Codex onboarding journey;
- a largest observed single-concept payload of 1,013 bytes;
- a connected API/server/database design map of 1,581 bytes; and
- zero model, network, and execution calls inside the direct renderer.

I also ran one controlled GPT-5.6 Sol implementation pair from identical tiny
repositories. Both arms passed the requested safety cases. Native Codex added
38 implementation source lines; Fairytail selected its build policy naturally
and added 22. Both final responses were 49 words, and host-reported output
tokens were 2,135 versus 2,036. Fairytail's input tokens were higher, so I treat
this as a concrete smaller-code result, not a general total-token win.

I also ran install, activation, and beginner-flow checks from isolated Codex
environments. These are engineering tests, not a human-comprehension study. The
consented novice pilot is still 0/3, and I state that limitation in the public
documentation.

## Try it

```bash
codex plugin marketplace add ernestolee13/fairytail
codex plugin add fairytail@fairytail
codex plugin list --json
```

Start a new Codex thread, then try:

```text
$fairytail:doctor Diagnose my setup without showing profile answers.
$fairytail:onboard Set up my profile in Korean.
$fairytail:fairytail-explain-concept Explain MCP in Korean with a beginner-friendly analogy and its limit.
```

The source, setup guide, architecture, privacy boundary, and reproducible test
evidence are in the [public GitHub repository](https://github.com/ernestolee13/fairytail).

## What comes next

The next meaningful validation is not another synthetic score. It is a small,
consented study with real beginners: can they explain the system back in their
own words, make a safer decision, and continue building with less confusion?

I also want to expand the reviewed concept set and improve locale-specific
analogies without weakening the quiet-by-default rule. If Fairytail grows, I
want it to grow through better judgment about when to speak—not by speaking on
every turn.
