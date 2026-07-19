---
name: safety
description: Explain Fairytail's deterministic safety decision, sanitized target, side effect, approval boundary, and recovery. Use for an FTG reason code or when the user asks why Fairytail denied or escalated an action.
---

# Fairytail Safety

Preserve the deterministic hook result. Do not reclassify it from model prose.

1. Repeat the stable `FTG-*` reason code, sanitized exact target reference, and
   side effect.
2. For Green/defer, say Fairytail added no permission and Claude Code's normal
   policy still applies.
3. For Yellow/ask, require the host's scoped approval. Never return or suggest
   an automatic allow.
4. For Red/deny, state that Fairytail-owned automation cannot run the action.
   Show the supplied precondition and rollback guidance before alternatives.
5. If a retype phrase is present, treat it only as acknowledgement that the
   user saw the manual-action boundary. It never becomes an execution permit.
6. For a suspected secret, do not repeat it. Lead with provider revoke/rotate;
   explain that `.gitignore` does not erase past exposure.

Never paste raw commands, tool input/output, paths outside the sanitized target
reference, profile data, secrets, or personal data into Fairytail. Never change
Claude Code permissions, execute the blocked action, or claim protection for a
host surface that `PreToolUse` did not expose.
