---
name: fairytail-explain-concept
description: "Teach reviewed coding-agent system concepts in English/Korean for explicit Fairytail, analogy or personalization, beginner/plain-language mental models, expressed confusion, comparisons, or initial-system design. Never use for an ordinary definition such as 'What is an API?', incidental terms, unsupported topics, routine planning/coding/implementation/fixing/reviewing, or trivial edits. Render one bounded mental model and analogy limit. Select silently."
---

# Fairytail Explain Concept

The host selects this skill from semantic intent in the description or an
explicit `$fairytail:fairytail-explain-concept` invocation. An ordinary short
definition, implementation request, or unsupported concept stays with the host.

Run the bundled script as the first action. Do not inspect the repository,
search for files, invoke another model, or announce the selection. The bundled
path makes no model or network call. After success,
treat stdout as the final answer and copy it exactly except for the final
newline. Do not summarize, translate, reorder, shorten, introduce, or conclude.
Report a copy failure instead of substituting prose.

Claude Code:

```sh
node "${CLAUDE_PLUGIN_ROOT}/skills/fairytail-explain-concept/scripts/explain.mjs" --concept <alias-or-list> --locale <en-or-ko>
```

Codex (use this selected skill's absolute directory without searching):

```sh
node <this-skill-directory>/scripts/explain.mjs --concept <alias-or-list> \
  --locale <en-or-ko> --host codex
```

If an explicit installed-plugin argument is exactly `demo`, `demo en`, or
`demo ko`, run:

```sh
node <this-skill-directory>/scripts/explain.mjs demo [en-or-ko]
```

That closed demo defaults to English and renders only the reviewed API, server,
and database initial-design bundle without reading a profile. Never infer demo
mode from an ordinary prompt.

Choose one matching reviewed alias:

- package: `package`, `dependency`
- server: `server`, `process`
- environment: `environment`, `config`
- API: `api`
- token/key: `token`, `api-key`, `access-token`, `llm-token`
- database: `database`, `db`, `query`
- MCP: `mcp`, `tool`, `resource`
- permission: `permission`, `authentication`, `authorization`
- repository: `repository`, `repo`, `path`
- deployment: `deploy`, `cloud`, `remote`

Use `ko` when the user asks in Korean or requests Korean; otherwise use `en`.
Use one alias for one question. Only for an explicit initial-design walkthrough,
choose up to three distinct relevant aliases, for example
`--concept api,server,database`. Never expand a routine question into a bundle.
If no alias fits, answer normally without claiming a Fairytail review. This
skill does not participate in implementation work.
