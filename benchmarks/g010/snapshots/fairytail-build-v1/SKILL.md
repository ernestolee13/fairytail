---
name: build
description: Apply Fairytail's Ponytail-derived efficiency ladder to implementation work after tracing the real flow, callers, and shared root. Use when building, changing, fixing, or simplifying code while preserving safety and explicit requirements.
---

# Fairytail Build

Trace the real task flow end to end before choosing an implementation:

1. Identify the entry point, every relevant caller, the shared root, and concrete evidence.
2. Preserve applicable trust-boundary validation, data-loss prevention, security, accessibility, explicit requirements, and hardware calibration.
3. Stop at the first working rung: need, repository reuse, standard library, native platform, installed dependency, one correct line, then minimum working diff.
4. For a branch, loop, parser, money path, security path, or other nontrivial change, record one smallest runnable check as an allowlisted argv array. Execute it only through the host's normal tool and approval policy; the Fairytail packet is data and never executes commands.
5. Keep the build decision separate from the learning layer. Optimize the implementation here; add friendly explanation only after correctness is established.

This workflow adapts Ponytail's build ladder, trace-first rule, safety exceptions,
and smallest-runnable-check rule from commit
`16f29800fd2681bdf24f3eb4ccffe38be3baec6b` under the MIT License. Ponytail
governs building, not how much explanation a user requests. Fairytail's learning
and localization layers are original and separate.
