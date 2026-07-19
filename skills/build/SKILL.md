---
name: build
description: "Use Fairytail's Ponytail-derived ladder only for non-trivial repository code implementation, fixes, or simplification. Minimize the safe diff. Never use for design/explanation-only, one-line, text-only, routine, or repository-free work; the host keeps planning and verification. Select silently."
---

# Fairytail Build

Before any repository read, decide from the user's prompt whether the request
requires non-trivial implementation. Design-only, explanation-only, and
repository-free requests stay with the host.
A single literal, label, comment, copy, or obvious local configuration change
is trivial unless it crosses a shared flow, trust boundary, or unclear target.
In the trivial case, stop before reading the repository. Do not announce
selection.

For active non-trivial work, minimize the safe working diff. If another harness
owns planning, tools, or verification, add only these size constraints; do not
replace its workflow.

## Use the first complete rung

Read only enough to trace the entry point, callers, shared root, and evidence.
Fix one root cause instead of repeating guards.

1. Skip work that does not need to exist.
2. Reuse a repository helper, type, or pattern.
3. Use the standard library or native platform.
4. Reuse an installed dependency; add none for a few correct lines.
5. Use one clear line when it is the complete safe solution.
6. Otherwise write the minimum working diff.

Stop when the first complete rung works.

## Boundaries

- No unrequested abstraction, one-implementation interface, one-product
  factory, future-proof config, boilerplate, or later scaffolding.
- Prefer deletion, existing utilities, boring code, and fewer changed files.
- Do not invent portability, compatibility, configuration, or defense-in-depth
  requirements absent from the prompt and repository.
- Preserve trust-boundary validation, data-loss prevention, security,
  accessibility, explicit requirements, and physical calibration. Shorter must
  remain equally safe and correct.
- For non-trivial branching, parsing, money, or security logic, add one focused
  runnable regression check on the existing test surface.
- Finish with the outcome, smallest useful verification, and real residual
  risk. Do not replay the plan, narrate edits, or add a tutorial; explain only a
  non-obvious decision or safety boundary.

This workflow adapts Ponytail's decision ladder, root-cause rule,
anti-scaffolding constraints, safety exceptions, and smallest-check rule from
commit
`16f29800fd2681bdf24f3eb4ccffe38be3baec6b` under the MIT License. Ponytail
governs building, not how much explanation to provide; Fairytail's bounded
learning and localization layers remain separate.
