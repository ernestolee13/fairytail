---
title: Beginner concept examples
created: 2026-07-18
updated: 2026-07-19
type: guide
tags:
  - proj/fairytail
  - topic/beginner-explanations
summary: English-source examples showing how Fairytail preserves one technical fact while locally validating a user-authored familiar-world rendering in English or Korean.
---

# Beginner concept examples

Fairytail does not write a separate explanation for every profession or build a
psychological profile. The learner writes familiar contexts and objects in
their own words; that local file is the source of truth. After explicit consent,
a bounded mapper may fill only the nouns in a reviewed relationship contract.
Local code keeps the technical fact and relation direction fixed and always says
where the comparison stops working. Invalid or missing mappings return the
neutral technical explanation.

The text below is documentation, not a human-comprehension result. Canonical
facts and primary references live in `content/v1/concepts.json`; localized
presentation lives in `content/locales/ko/presentation.json` and cannot change
the underlying concept IDs, relationships, safety fields, or breakpoints.

## One API fact, one user-authored rendering

The fixed fact is always the same:

> In an HTTP API, a client sends a request with a method, target, headers, and an
> optional body. The server returns a response with a status, headers, and an
> optional body.

For a learner who wrote “Restaurant kitchen workflow,” the bounded role slots
can be validated as:

| Technical role | User-authored familiar noun       |
| -------------- | --------------------------------- |
| API            | restaurant service rules and menu |
| endpoint       | service counter                   |
| request        | order ticket                      |
| response       | prepared dish and order status    |

All three must keep the same limit: a real API does not resolve ambiguous intent
like a helpful person at a desk. The caller must follow its method, schema,
credential, rate-limit, status, retry, and partial-failure rules.

Neutral mode is equally valid: trace a fictional read-only `GET /tasks/42`, then
check the method, target, credential, cost, expected status, and whether the call
can change external state.

### How Korean rendering preserves the same validated map

The Korean catalog translates the canonical fact, reviewed relation verbs,
breakpoint, and safety fields while preserving the learner's own approved nouns.
For example, the Korean runtime renders the English relation “is sent in the
defined format” with its reviewed Korean equivalent while leaving the approved
`order ticket` and `service counter` labels unchanged.

The limit remains identical in either language: a real API endpoint does not
resolve ambiguous intent like a person. It follows defined method, schema,
credential, status, and failure rules.

The hospital, online-store, and humanities renderings still exist as frozen
regression fixtures. They are not production persona choices.

## Server: stored instructions are not the running worker

**Technical core.** A program is stored instructions. A process is a running
instance with memory, threads, and resources. In HTTP, a server is the software
role that accepts requests and returns responses; in infrastructure talk,
“server” can also mean the machine or VM doing that work, so context matters.

**Reviewed picture.** In the hospital world, the workflow manual is the program,
the on-duty staff member is the process, the temporary intake-desk role is the
server, the desk number is the port, and the separate records room is the
database.

**Where it breaks.** Real servers can have proxies, many processes or instances,
and simultaneous requests. One program can be a client in one connection and a
server in another.

**Before running one.** Check the bind address, port, exposed directory,
secrets, production suitability, and shutdown method.

## Database: a query is not always a harmless search

**Technical core.** A relational DBMS manages tables. A table has rows with the
same named columns, and a query asks the DBMS for a result or an operation.

**Reviewed picture.** In a small online store, the database is the managed order
record system, a table is an order ledger, a row is one order, a column is one
order field, a query is a search/action request, and the DBMS is the record
manager.

**Where it breaks.** A real database has transactions, constraints, indexes,
joins, concurrency, `NULL`, and an optimizer. A query can update or delete data,
not only read it.

**Before a write.** Check whether the target is production, the rows affected,
permissions, backup, transaction, constraints, and rollback. Start with a
constrained `SELECT` when that is safe and meaningful.

## “Token” can mean two unrelated things

### API key or access token: authority

An API key is a provider-issued secret string whose exact identification,
quota, and access meaning depends on the provider. An OAuth access token
represents delegated authority over a protected resource, including scope,
target, and duration.

The reviewed hospital picture uses a copyable shared service key for an API key
and a time-and-area-limited wristband for an access token. The entrance
attendant is the resource server and the permitted areas are the scope.

The comparison stops because digital credentials can be copied invisibly, may
represent a service rather than a person, and are validated using provider-
specific audience, resource, scope, and expiry rules. Never paste a real secret
into chat, a frontend, repository, screenshot, log, or URL; revoke or rotate an
exposed secret rather than merely deleting the visible copy.

### LLM token: a model-processing unit

An LLM token is an atomic unit a particular model uses to process input and
output. The context window is the total token workspace for the request,
including input, output, reasoning, and provider-specific related content.

It is not a login credential, not necessarily a full word, and not a unit of
meaning or importance. Use the provider's actual tokenizer/counting API for the
specific model, messages, and tool schemas; do not use token count as proof that
an explanation is understandable.

Quick check: copying an LLM context token cannot authenticate an API request.

## MCP: a standard connection is not automatic trust

**Technical core.** MCP is a host-client-server protocol. A host coordinates
application context and policy, each client maintains a one-to-one connection
with a server, and the server exposes prompts, resources, and tools. The model
or application may select a capability; the client sends a request such as
`tools/call`; the server executes and returns a result.

**Reviewed picture.** In small online-store operations, the host is the
operations hub, each client is a dedicated vendor-integration line, the server
is the external vendor system, a resource is vendor-provided reference
material, and a tool is a vendor action service.

**Where it breaks.** A standard protocol does not prove that the server is
trustworthy, correct, or least-privileged. Confirmation and automatic-call
behavior depend on the host implementation and policy; MCP itself does not
guarantee a confirmation screen.

**Before connecting.** Start with read-only resources. Review the server,
declared capabilities, exact target, side effects, confirmation state, token
audience/resource, and local stdio process permissions. An MCP server can still
call an ordinary API underneath.

## What Fairytail intentionally does not infer

- intelligence, ability, personality, diagnosis, or learning style;
- an exact occupation, employer, school, or personal history;
- “mastery” from one explanation or task completion;
- execution permission from a learner profile, analogy, or model response.

Support depth can change only from bounded learning evidence such as an actual
delayed retrieval or novel application event. Safety detail never shrinks.

## Primary fact sources

The versioned cards include exact revision and review metadata. Core references
for these examples include [HTTP semantics](https://www.rfc-editor.org/rfc/rfc9110.html),
[PostgreSQL concepts](https://www.postgresql.org/docs/current/tutorial-concepts.html),
[OAuth access tokens](https://www.rfc-editor.org/rfc/rfc6749.html#section-1.4),
[OpenAI token concepts](https://developers.openai.com/api/docs/concepts#tokens),
and the [MCP architecture specification](https://modelcontextprotocol.io/specification/2025-11-25/architecture).
