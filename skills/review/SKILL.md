---
name: review
description: Offer one optional delayed concept question and store only a closed score, never raw words. Use when Fairytail reports it due or the user explicitly asks to quiz a previously explained concept. Do not use for code, PR, architecture, database-migration, document, or implementation review.
---

# Fairytail Review

Delayed review is optional and never blocks work.

1. Run `fairytail-g005.mjs review --data-dir "$CLAUDE_PLUGIN_DATA" --locale en|ko`.
2. If no prompt is due, say so briefly. Otherwise ask at most one returned
   question at a time and allow the user to skip.
3. Evaluate the answer in memory against four closed fields from 0 to 2:
   `role_and_flow`, `confusion_boundary`, `analogy_limit`, and
   `safe_next_action`; set `fatal_misconception` to a boolean. Do not write the
   user's words to disk or include them in adapter input.
4. Create a private mode `0600` observation containing only
   `schema_version: 1`, `observation` (`teachback`, `retrieval`, or
   `novel_application`), `concept_id`, bounded `scenario_id`, canonical `at`,
   `novel_context`, and the rubric. `novel_context` is true only after an
   observed application in a different context; its scenario ID must be an
   opaque `ctx-` prefix plus 16 lowercase hexadecimal characters. It is false
   otherwise. Never derive that ID from a person, organization, project, path,
   or learner response.
5. Run the G005 `observe` command and delete the exact temporary input.

State transitions are exactly `unseen → exposed → explained_once →
retrieved_delayed → applied_novel`. There is no mastered state. Explanation
support may fade only from recorded evidence; safety detail and execution
permissions never fade or change.
