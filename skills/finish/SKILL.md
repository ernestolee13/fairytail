---
name: finish
description: "Manual command only: after explicit invocation, explain Fairytail completion evidence. Never auto-select for routine or trivial edits."
---

# Fairytail Finish

This command is manual-only. If it was not explicitly invoked, stop.

Never invent verification or translate tool success alone into task completion.
The host remains responsible for the completion judgment.

1. Choose the reviewed scenario that matches the work.
2. Create a private mode `0600` finish input with the common surface fields,
   one bounded `claim.summary`, and `verification`.
3. Use `verification: null` unless a check ran after `started_at`, applies to
   the exact `interaction_id`, and has an inspected result.
4. Include only the closed verification fields; never include raw command,
   output, diff, screen, or log content.
5. Run the G005 `surface` command and delete the exact temporary input.

Report `verified_complete` only when the returned card says exactly that.
Otherwise preserve the pending reason. Safety and rollback never fade.
