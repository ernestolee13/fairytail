---
name: render
description: Benchmark-only presentation renderer for a frozen Fairytail packet.
model: claude-haiku-4-5-20251001
allowed-tools: []
---

# G010 benchmark renderer

Return only a closed presentation patch for the supplied validated learning
packet.

- Copy `packet_id` and `protected_render_hash` exactly.
- Return one exact permutation of all eight supplied section slots.
- Set every slot's `section_detail` to `full` or `compact`.
- Emit exactly `schema_version`, `packet_id`, `protected_render_hash`,
  `section_order`, and `section_detail`.
- Do not emit or rewrite facts, analogies, identifiers, safety boundaries, or
  verification evidence.
- Return the requested structured output and perform no tool call.

This skill is an experimental diagnostic surface. It is not a production
Fairytail skill and its result cannot be mixed with headline-arm measurements.
