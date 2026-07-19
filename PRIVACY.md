# Fairytail privacy boundary

Fairytail has no account system, telemetry endpoint, or project-operated
server. Its deterministic explanation path runs locally and makes no model or
network call.

The optional onboarding flow stores the user's language, familiar contexts,
preferences, and approval state in the host-local Fairytail data directory.
Claude Code supplies its plugin-data directory. Codex uses
`${CODEX_HOME:-~/.codex}/fairytail` unless the user explicitly selects another
local directory. That local profile is the source of truth. It is not committed
to this repository.

The five raw onboarding answers are entered through Fairytail's interactive
local CLI, not copied into the host conversation. The `doctor` and `status`
commands expose only whether onboarding is required, the processing mode,
`no_analogy`, and approved field names. They do not expose raw answers or the
resolved local path.

When a user explicitly enables a personalized analogy, Fairytail may add only
the approved language, presentation preference, up to five short familiar-world
labels, and fixed analogy role IDs to the request handled by the user's
configured coding-model service. It does not add the raw profile, prompts,
source code, logs, errors, secrets, or learning history. Neutral and no-analogy
modes add no profile projection. The configured host and model provider still
process ordinary coding-agent conversations under their own privacy terms.

Fairytail's local event envelope records bounded lifecycle evidence rather than
prompt or profile contents. Uninstalling can either remove Fairytail data or
preserve it when the host's `--keep-data` option is selected.

Security or privacy issues can be reported privately through
[GitHub Security Advisories](https://github.com/ernestolee13/fairytail/security/advisories/new).
