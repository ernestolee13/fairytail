import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { isAbsolute, relative, resolve as resolvePath, sep } from "node:path";

import { sensitiveReason } from "../profile/sanitize.mjs";
import {
  REASON_CODES,
  SAFETY_SCHEMA_VERSION,
  assessSafetyAction,
  safetyAction,
} from "./policy.mjs";

const TOOL_PATTERN = /^[A-Za-z0-9_.:-]{1,120}$/u;
const SECRET_LITERAL_PATTERN =
  /(?:\b(?:sk|ghp|github_pat)_[A-Za-z0-9_-]{8,}\b|\bAKIA[A-Z0-9]{12,}\b|\b(?:api[_-]?key|access[_-]?token|secret|password|passwd|authorization|private[_-]?key)\b\s*[:=]\s*[^\s"']+|\$(?:[A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY|PRIVATE_KEY)[A-Z0-9_]*))/iu;
const SECRET_TARGET_PATTERN =
  /(?:^|[\s/'"])(?:\.env(?!\.(?:example|sample|template)\b)|\.ssh(?:\/|\b)|id_(?:rsa|ed25519)(?:\.pub)?\b|credentials(?:\.json)?\b|\.aws\/credentials\b|\.npmrc\b|\.pypirc\b)/iu;
const ENV_SECRET_OUTPUT_PATTERN =
  /^(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*(?:env|printenv|set)\s*$/iu;
const PERSONAL_DATA_PATTERN =
  /(?:[\p{L}\d._%+-]+@[\p{L}\d.-]+\.[\p{L}]{2,}|\+?\d[\d\s().-]{7,}\d|\b(?:patient|customer|student|recipient|email|phone|address|familiar_worlds|profile_data)\b|(?:환자|고객|학생|수신자|이메일|전화번호|주소|프로필))/iu;
const REMOTE_INSTALL_PATTERN =
  /\b(?:curl|wget)\b[^\n|]*(?:\||\|&)\s*(?:sudo\s+)?(?:sh|bash|zsh|fish|python|node)\b/iu;
const PRODUCTION_PATTERN =
  /(?:\b(?:vercel|netlify|flyctl|railway)\b[^\n]*(?:--prod\b|--environment\s+(?:prod|production)\b)|\bkubectl\b[^\n]*\b(?:apply|delete|patch|replace|scale|rollout)\b|\bhelm\b[^\n]*\b(?:install|upgrade|uninstall)\b|\bterraform\b[^\n]*\b(?:apply|destroy|import)\b|\b(?:aws|gcloud|az)\b[^\n]*\b(?:deploy|delete|update|create)\b|(?:--prod\b|--environment\s+(?:prod|production)\b|--env\s+(?:prod|production)\b))/iu;
const BILLING_PATTERN =
  /\b(?:stripe|charge|payment|purchase|checkout|subscription|billing|invoice|buy|order)\b/iu;
const EXTERNAL_WRITE_PATTERN =
  /(?:\bgit\s+push\b|\bgh\s+(?:pr|issue|release)\s+(?:create|comment|close|merge|edit)\b|\bgh\s+api\b[^\n]*(?:-X|--method)\s*(?:POST|PUT|PATCH|DELETE)\b|\bnpm\s+publish\b|\b(?:docker|podman)\s+push\b|\b(?:curl|wget)\b[^\n]*\b(?:-X|--request)\s*(?:POST|PUT|PATCH|DELETE)\b|\b(?:curl|wget)\b[^\n]*(?:--data|-d\s|--upload-file)|\brequests\.(?:post|put|patch|delete)\s*\(|\b(?:send|publish|post|message|notify)\b)/iu;
const DATABASE_COMMAND_PATTERN =
  /\b(?:psql|mysql|sqlite3|prisma|supabase|alembic|sequelize|knex|drizzle|typeorm|flyway|liquibase)\b/iu;
const DATABASE_DESTRUCTIVE_PATTERN =
  /(?:\b(?:DROP|TRUNCATE)\b|\bDELETE\s+FROM\b(?![^;\n]*\bWHERE\b)|\b(?:migrate\s+deploy|db\s+push|migration|migrate)\b)/iu;
const DATABASE_WRITE_PATTERN =
  /\b(?:INSERT\s+INTO|UPDATE\s+[^\s]+\s+SET|DELETE\s+FROM|ALTER\s+TABLE|CREATE\s+TABLE|REPLACE\s+INTO)\b/iu;
const FORCE_PUSH_PATTERN =
  /\bgit\s+(?:push\b[^\n]*(?:--force(?:-with-lease)?|-f\b)|reset\s+--hard\b|rebase\b[^\n]*(?:--onto|-i\b)|filter-(?:branch|repo)\b)/iu;
const PERMISSION_WIDEN_PATTERN =
  /(?:\bsudo\b|\bchmod\b[^\n]*(?:-R\b|\b0?(?:777|666)\b|\b(?:a|ugo|o)\+(?:w|rwx)\b|\b[ug]\+s\b)|\bchown\b[^\n]*-R\b|\bsetfacl\b[^\n]*(?:-R|-m)\b)/iu;
const PROGRAMMATIC_DELETE_PATTERN =
  /(?:\bshutil\.rmtree\s*\(|\bos\.(?:remove|unlink|rmdir)\s*\(|\bPath\([^)]*\)\.(?:unlink|rmdir)\s*\(|\bfs\.(?:rm|rmSync|unlink|unlinkSync|rmdir|rmdirSync)\s*\()/u;
const BULK_DELETE_PATTERN =
  /(?:\bfind\b[^\n]*-(?:delete|exec)\b[^\n]*\b(?:rm|rmdir)\b|\bxargs\b[^\n]*\b(?:rm|rmdir)\b)/iu;
const DEPENDENCY_INSTALL_PATTERN =
  /\b(?:npm|pnpm|yarn|bun)\s+(?:add|install|i)\b|\b(?:pip|pipx|uv)\s+install\b|\b(?:cargo|go)\s+(?:add|get)\b/iu;
const REDIRECTION_PATTERN = /(?:^|[^<])>{1,2}(?!>)/u;

/**
 * Convert a Claude Code PreToolUse event into a deterministic, sanitized
 * decision. Unknown host tools defer to Claude Code; malformed input and any
 * unknown Fairytail-owned automation fail closed.
 *
 * @param {unknown} value
 */
export function assessPreToolUse(value) {
  if (!isRecord(value) || value.hook_event_name !== "PreToolUse") {
    return failClosedAssessment();
  }
  if (
    typeof value.tool_name !== "string" ||
    !TOOL_PATTERN.test(value.tool_name) ||
    !isRecord(value.tool_input)
  ) {
    return failClosedAssessment();
  }
  if (
    typeof value.cwd !== "string" ||
    value.cwd.length === 0 ||
    value.cwd.length > 4096 ||
    value.cwd.includes("\0")
  ) {
    return failClosedAssessment();
  }

  const toolName = value.tool_name;
  if (toolName === "Bash") {
    return assessBash(value.tool_input.command, value.cwd);
  }
  if (new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]).has(toolName)) {
    return assessFileMutation(toolName, value.tool_input, value.cwd);
  }
  if (
    new Set(["Read", "Glob", "Grep", "WebSearch", "WebFetch"]).has(toolName)
  ) {
    return assessSafetyAction(
      safetyAction({
        operation: "read",
        toolName,
        target: safeToolTarget(toolName, "local"),
        flags: { cost_bounded: true },
      }),
    );
  }
  if (toolName.startsWith("mcp__")) {
    return assessMcp(toolName, value.tool_input, value.cwd);
  }
  if (toolName.startsWith("fairytail") || toolName.includes("__fairytail__")) {
    return failClosedAssessment(`tool:${safeToolName(toolName)}`);
  }
  return hostDeferAssessment(toolName);
}

/**
 * Render only the current official PreToolUse decision fields. This function
 * never returns `allow`, so a plugin cannot weaken a host deny/ask rule.
 *
 * @param {ReturnType<typeof assessPreToolUse>} assessment
 */
export function preToolUseResponse(assessment) {
  if (assessment.decision === "defer") return {};
  const boundary =
    assessment.decision === "deny"
      ? `Automatic action denied. ${assessment.retype_phrase ? `Manual boundary phrase: ${assessment.retype_phrase}. Retyping does not authorize Fairytail automation.` : ""}`
      : "Claude Code must show a scoped approval before this action.";
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: assessment.decision,
      permissionDecisionReason: [
        `[${assessment.reason_code}]`,
        `Target ${assessment.target.display}.`,
        `Side effect ${assessment.side_effect}.`,
        boundary,
        assessment.recovery.precondition,
        assessment.recovery.rollback,
      ]
        .filter(Boolean)
        .join(" "),
    },
  };
}

/** @param {unknown} commandValue @param {string} cwd */
function assessBash(commandValue, cwd) {
  if (
    typeof commandValue !== "string" ||
    commandValue.length === 0 ||
    commandValue.length > 32_768 ||
    commandValue.includes("\0")
  ) {
    return failClosedAssessment("tool:Bash");
  }
  const command = commandValue.normalize("NFC");
  const tokens = shellTokens(command);
  const externalWrite = EXTERNAL_WRITE_PATTERN.test(command);

  if (
    SECRET_LITERAL_PATTERN.test(command) ||
    SECRET_TARGET_PATTERN.test(command) ||
    ENV_SECRET_OUTPUT_PATTERN.test(command.trim())
  ) {
    return descriptorAssessment({
      operation: "credential_exposure",
      toolName: "Bash",
      target: secretTarget(command, cwd),
      flags: { secrets_present: true },
    });
  }
  if (REMOTE_INSTALL_PATTERN.test(command)) {
    return descriptorAssessment({
      operation: "install_remote_code",
      toolName: "Bash",
      target: networkTarget(firstUrl(command) ?? "remote-installer"),
    });
  }
  if (externalWrite && PERSONAL_DATA_PATTERN.test(command)) {
    return descriptorAssessment({
      operation: "transmit_profile",
      toolName: "Bash",
      target: networkTarget(firstUrl(command) ?? "external-recipient"),
      flags: {
        personal_data_present: true,
        profile_data_present: /profile|familiar_worlds|프로필/iu.test(command),
      },
    });
  }
  if (PERMISSION_WIDEN_PATTERN.test(command)) {
    return descriptorAssessment({
      operation: "change_permission",
      toolName: "Bash",
      target: pathTarget(permissionTarget(tokens) ?? ".", cwd),
      flags: {
        permission_widening: true,
        recursive: /(?:^|\s)-R\b/u.test(command),
      },
    });
  }
  if (/\bgit\s+clean\b/iu.test(command)) {
    return descriptorAssessment({
      operation: "delete",
      toolName: "Bash",
      target: pathTarget(".", cwd),
      flags: {
        recursive: true,
        force: /(?:^|\s)-[^\s]*f/u.test(command),
        bulk: true,
      },
    });
  }
  if (
    /\b(?:rm|rmdir)\b/iu.test(command) ||
    /\bfind\b[^\n]*-delete\b/iu.test(command) ||
    PROGRAMMATIC_DELETE_PATTERN.test(command) ||
    BULK_DELETE_PATTERN.test(command)
  ) {
    const rawTarget = PROGRAMMATIC_DELETE_PATTERN.test(command)
      ? "unknown"
      : /\bfind\b[^\n]*-delete\b/iu.test(command)
        ? (commandTarget(tokens, ["find"]) ?? ".")
        : (commandTarget(tokens, ["rm", "rmdir"]) ?? "unknown");
    const target = pathTarget(rawTarget, cwd);
    const recursive =
      /(?:^|\s)-(?:[^\s]*r|[^\s]*R)|--recursive\b/iu.test(command) ||
      /\bfind\b[^\n]*-delete\b/iu.test(command);
    const force = /(?:^|\s)-[^\s]*f|--force\b/iu.test(command);
    const bulk =
      recursive ||
      PROGRAMMATIC_DELETE_PATTERN.test(command) ||
      BULK_DELETE_PATTERN.test(command) ||
      hasGlob(rawTarget) ||
      target.scope !== "single";
    return descriptorAssessment({
      operation: "delete",
      toolName: "Bash",
      target,
      flags: { recursive, force, bulk },
      rollback:
        !recursive && !force && target.scope === "single"
          ? { available: true, strategy: "version_control" }
          : undefined,
    });
  }
  if (FORCE_PUSH_PATTERN.test(command)) {
    return descriptorAssessment({
      operation: "rewrite_history",
      toolName: "Bash",
      target: semanticTarget("repository", "configured-remote", "external"),
      flags: { force: true },
    });
  }
  if (
    DATABASE_COMMAND_PATTERN.test(command) ||
    DATABASE_WRITE_PATTERN.test(command)
  ) {
    const destructive = DATABASE_DESTRUCTIVE_PATTERN.test(command);
    return descriptorAssessment({
      operation: destructive
        ? "database_migration"
        : DATABASE_WRITE_PATTERN.test(command)
          ? "database_write"
          : "database_read",
      toolName: "Bash",
      target: databaseTarget(tokens, command),
      flags: {
        bulk: destructive || /\b(?:all|bulk)\b/iu.test(command),
        force: /(?:^|\s)--force\b/iu.test(command),
        cost_bounded: true,
      },
      rollback:
        !destructive && /\b(?:transaction|BEGIN)\b/iu.test(command)
          ? { available: true, strategy: "transaction" }
          : undefined,
    });
  }
  if (PRODUCTION_PATTERN.test(command)) {
    return descriptorAssessment({
      operation: "production_change",
      toolName: "Bash",
      target: semanticTarget(
        "service",
        productionService(command),
        "production",
      ),
      flags: { force: /(?:^|\s)--force\b/iu.test(command) },
    });
  }
  if (
    BILLING_PATTERN.test(command) &&
    /\b(?:create|charge|pay|purchase|buy|subscribe|checkout)\b/iu.test(command)
  ) {
    return descriptorAssessment({
      operation: "billing",
      toolName: "Bash",
      target: semanticTarget("billing", billingProvider(command), "external"),
      flags: { cost_bounded: exactCostPresent(command) },
    });
  }
  if (externalWrite) {
    return descriptorAssessment({
      operation: /\b(?:send|message|notify|comment)\b/iu.test(command)
        ? "send_message"
        : "publish",
      toolName: "Bash",
      target: externalTarget(command),
      flags: {
        public: /\b(?:public|publish|release|npm\s+publish)\b/iu.test(command),
      },
    });
  }
  if (
    REDIRECTION_PATTERN.test(command) ||
    /\b(?:tee|touch|mkdir|cp|mv)\b/iu.test(command)
  ) {
    const rawTarget =
      redirectionTarget(tokens) ??
      commandTarget(tokens, ["tee", "touch", "mkdir", "cp", "mv"]) ??
      "unknown";
    return descriptorAssessment({
      operation: "write_file",
      toolName: "Bash",
      target: pathTarget(rawTarget, cwd),
      flags: { force: /(?:^|\s)-[^\s]*f|--force\b/iu.test(command) },
      rollback: { available: true, strategy: "version_control" },
    });
  }
  if (DEPENDENCY_INSTALL_PATTERN.test(command)) {
    return descriptorAssessment({
      operation: "install_dependency",
      toolName: "Bash",
      target: semanticTarget("repository", "dependency-graph", "local"),
      flags: { cost_bounded: true },
      rollback: { available: true, strategy: "version_control" },
    });
  }
  if (isReadOnlyCommand(command)) {
    return descriptorAssessment({
      operation: "read",
      toolName: "Bash",
      target: safeToolTarget("Bash", "local"),
      flags: { cost_bounded: true },
    });
  }
  return hostDeferAssessment("Bash");
}

/** @param {string} toolName @param {Record<string, unknown>} toolInput @param {string} cwd */
function assessFileMutation(toolName, toolInput, cwd) {
  const rawTarget = firstString(toolInput, [
    "file_path",
    "path",
    "notebook_path",
  ]);
  if (!rawTarget) {
    return failClosedAssessment(`tool:${safeToolName(toolName)}`);
  }
  const target = pathTarget(rawTarget, cwd);
  if (target.scope === "single" && target.environment === "local") {
    return hostDeferAssessment(toolName);
  }
  return descriptorAssessment({
    operation: "write_file",
    toolName,
    target,
    rollback: { available: true, strategy: "version_control" },
  });
}

/** @param {string} toolName @param {Record<string, unknown>} input @param {string} cwd */
function assessMcp(toolName, input, cwd) {
  const normalized = toolName.toLowerCase();
  const scan = scanStructuredInput(input);
  const target = structuredTarget(input, toolName, cwd);
  const externalMutation =
    /(?:send|message|publish|post|comment|create|update|write|delete|remove|deploy|charge|purchase|pay|migrate|execute)/u.test(
      normalized,
    );
  if (scan.secret) {
    return descriptorAssessment({
      operation: "credential_exposure",
      toolName,
      target,
      flags: { secrets_present: true },
    });
  }
  if (externalMutation && (scan.personalData || scan.profileData)) {
    return descriptorAssessment({
      operation: "transmit_profile",
      toolName,
      target,
      flags: {
        personal_data_present: scan.personalData,
        profile_data_present: scan.profileData,
      },
    });
  }
  if (
    /(?:charge|payment|purchase|checkout|billing|subscribe)/u.test(normalized)
  ) {
    return descriptorAssessment({ operation: "billing", toolName, target });
  }
  if (
    /(?:deploy|production|release_to_prod|terraform_apply|kubectl_apply)/u.test(
      normalized,
    )
  ) {
    return descriptorAssessment({
      operation: "production_change",
      toolName,
      target,
    });
  }
  if (
    /(?:migrate|drop|truncate|delete_rows|execute_sql|database_write|db_write)/u.test(
      normalized,
    )
  ) {
    return descriptorAssessment({
      operation: "database_migration",
      toolName,
      target,
      flags: { bulk: true },
    });
  }
  if (/(?:send|message|publish|post|comment|release|merge)/u.test(normalized)) {
    return descriptorAssessment({
      operation: /(?:send|message|comment)/u.test(normalized)
        ? "send_message"
        : "publish",
      toolName,
      target,
      flags: { public: /(?:publish|release)/u.test(normalized) },
    });
  }
  if (/(?:delete|remove)/u.test(normalized)) {
    return descriptorAssessment({
      operation: "delete",
      toolName,
      target,
      flags: { bulk: target.scope !== "single" },
    });
  }
  if (/(?:chmod|permission|grant|role_update)/u.test(normalized)) {
    return descriptorAssessment({
      operation: "change_permission",
      toolName,
      target,
      flags: { permission_widening: true },
    });
  }
  if (/(?:write|edit|update|create)/u.test(normalized)) {
    return descriptorAssessment({
      operation: "write_file",
      toolName,
      target,
      rollback: { available: true, strategy: "provider_undo" },
    });
  }
  if (/(?:read|get|list|search|find|query|status|inspect)/u.test(normalized)) {
    return descriptorAssessment({
      operation: "read",
      toolName,
      target,
      flags: { cost_bounded: true },
    });
  }
  if (normalized.includes("__fairytail__")) {
    return failClosedAssessment(`tool:${safeToolName(toolName)}`);
  }
  return hostDeferAssessment(toolName);
}

/** @param {{ operation: string, toolName: string, target: any, flags?: Record<string, boolean>, rollback?: { available: boolean, strategy: string } }} input */
function descriptorAssessment(input) {
  return assessSafetyAction(
    safetyAction({
      source: "host_tool_review",
      operation: input.operation,
      toolName: safeToolName(input.toolName),
      target: input.target,
      flags: input.flags,
      rollback: input.rollback,
    }),
  );
}

/** @param {string} [locator] */
export function failClosedAssessment(locator = "tool:pretool-input") {
  return assessSafetyAction(
    safetyAction({
      source: "fairytail_automation",
      operation: "unknown",
      toolName: "fairytail-safety-guard",
      target: {
        kind: "unknown",
        locator: privacySafeLocator(locator, "tool"),
        scope: "unknown",
        environment: "unknown",
      },
    }),
  );
}

/** @param {string} toolName */
function hostDeferAssessment(toolName) {
  const locator = privacySafeLocator(`tool:${safeToolName(toolName)}`, "tool");
  const targetFingerprint = fingerprint(locator);
  return deepFreeze({
    schema_version: SAFETY_SCHEMA_VERSION,
    risk: "unknown",
    decision: "defer",
    reason_code: REASON_CODES.HOST_DEFER,
    target: {
      display: locator,
      fingerprint: targetFingerprint,
      kind: "tool",
      scope: "unknown",
      environment: "unknown",
    },
    side_effect: "unknown_side_effect",
    action_fingerprint: fingerprint(`${toolName}:${targetFingerprint}`),
    approval_observed: false,
    requirements: {
      host_policy_still_required: true,
      scoped_user_approval: false,
      user_retype: false,
      manual_action_only: false,
    },
    recovery: {
      precondition:
        "Fairytail did not classify this host action; inspect it with the host's normal policy.",
      rollback:
        "No Fairytail approval was granted and the host remains responsible for permission and recovery.",
    },
    retype_phrase: null,
    execution_authorized: false,
    may_request_host_execution: false,
  });
}

/** @param {string} raw @param {string} cwd */
function pathTarget(raw, cwd) {
  const cleaned = stripQuotes(raw || "unknown");
  const expanded =
    cleaned === "~" || cleaned.startsWith("~/")
      ? resolvePath(homedir(), cleaned.slice(cleaned === "~" ? 1 : 2))
      : isAbsolute(cleaned)
        ? resolvePath(cleaned)
        : resolvePath(cwd, cleaned);
  const workspace = resolvePath(cwd);
  const home = resolvePath(homedir());
  const workspaceRelative = relative(workspace, expanded);
  const withinWorkspace =
    workspaceRelative === "" ||
    (!workspaceRelative.startsWith(`..${sep}`) &&
      workspaceRelative !== ".." &&
      !isAbsolute(workspaceRelative));
  let scope;
  let locator;
  if (expanded === resolvePath(sep)) {
    scope = "root";
    locator = "filesystem:/";
  } else if (expanded === workspace) {
    scope = "workspace";
    locator = "workspace:/";
  } else if (withinWorkspace) {
    scope = hasGlob(cleaned) ? "batch" : "single";
    const display = workspaceRelative.split(sep).join("/");
    locator = safeWorkspaceLocator(display, expanded);
  } else if (expanded === home || expanded.startsWith(`${home}${sep}`)) {
    scope = "home";
    locator = `home:#${hashOnly(expanded)}`;
  } else {
    scope = "outside_workspace";
    locator = `outside-workspace:#${hashOnly(expanded)}`;
  }
  return {
    kind: "filesystem",
    locator,
    scope,
    environment: "local",
  };
}

/** @param {string} display @param {string} resolved */
function safeWorkspaceLocator(display, resolved) {
  if (
    display.length > 120 ||
    /[\u0000-\u001f\u007f]/u.test(display) ||
    !/^[\p{L}\p{M}\p{N} ._:/#()+-]+$/u.test(display) ||
    sensitiveReason(display)
  ) {
    return `workspace:#${hashOnly(resolved)}`;
  }
  return `workspace:${display}`;
}

/** @param {string} command @param {string} cwd */
function secretTarget(command, cwd) {
  const match = command.match(SECRET_TARGET_PATTERN)?.[0]?.trim();
  if (match && !/^\$/u.test(match)) return pathTarget(stripQuotes(match), cwd);
  return semanticTarget("account", "credential-material", "unknown");
}

/** @param {string[]} tokens @param {string} command */
function databaseTarget(tokens, command) {
  const database = optionValue(tokens, ["--dbname", "--database", "-d"]);
  const environment = /\b(?:production|prod|deploy)\b/iu.test(command)
    ? "production"
    : /\b(?:test|testing)\b/iu.test(command)
      ? "test"
      : "unknown";
  return semanticTarget(
    "database",
    database ? `target-${hashOnly(database)}` : "configured-database",
    environment,
  );
}

/** @param {string} command */
function externalTarget(command) {
  const url = firstUrl(command);
  if (url) return networkTarget(url);
  if (/\bnpm\s+publish\b/iu.test(command)) {
    return semanticTarget("service", "npm-registry", "external");
  }
  if (/\bgit\s+push\b/iu.test(command)) {
    return semanticTarget("repository", "configured-remote", "external");
  }
  return semanticTarget("service", "external-recipient", "external");
}

/** @param {string} raw */
function networkTarget(raw) {
  try {
    const url = new URL(raw);
    return semanticTarget(
      "network",
      `${url.protocol.replace(":", "")}-${privacySafeLocator(url.hostname, "host")}-${hashOnly(url.pathname)}`,
      "external",
    );
  } catch {
    return semanticTarget("network", `endpoint-${hashOnly(raw)}`, "external");
  }
}

/** @param {string} kind @param {string} label @param {string} environment */
function semanticTarget(kind, label, environment) {
  return {
    kind: new Set([
      "filesystem",
      "database",
      "repository",
      "service",
      "account",
      "channel",
      "billing",
      "profile",
      "network",
      "tool",
      "unknown",
    ]).has(kind)
      ? kind
      : "unknown",
    locator: privacySafeLocator(`${kind}:${label}`, kind),
    scope: "single",
    environment,
  };
}

/** @param {string} toolName @param {string} environment */
function safeToolTarget(toolName, environment) {
  return {
    kind: "tool",
    locator: privacySafeLocator(`tool:${safeToolName(toolName)}`, "tool"),
    scope: "single",
    environment,
  };
}

/** @param {Record<string, unknown>} input @param {string} toolName @param {string} cwd */
function structuredTarget(input, toolName, cwd) {
  const raw = firstString(input, [
    "file_path",
    "path",
    "target",
    "database",
    "table",
    "channel",
    "recipient",
    "project",
    "resource",
    "url",
  ]);
  if (raw && /(?:^|_)(?:file_?path|path)$/iu.test(firstKey(input, raw) ?? "")) {
    return pathTarget(raw, cwd);
  }
  if (raw)
    return semanticTarget("service", `resource-${hashOnly(raw)}`, "external");
  return safeToolTarget(toolName, "unknown");
}

/** @param {Record<string, unknown>} input */
function scanStructuredInput(input) {
  let nodes = 0;
  let secret = false;
  let personalData = false;
  let profileData = false;
  /** @param {unknown} value @param {string} key @param {number} depth */
  function visit(value, key, depth) {
    nodes += 1;
    if (nodes > 256 || depth > 5) return;
    if (
      /api.?key|token|secret|password|authorization|private.?key|credential/iu.test(
        key,
      ) &&
      value !== null &&
      value !== ""
    )
      secret = true;
    if (
      /email|phone|patient|customer|student|recipient|address|person/iu.test(
        key,
      ) &&
      value !== null &&
      value !== ""
    )
      personalData = true;
    if (/profile|familiar_worlds|observed_experience/iu.test(key))
      profileData = true;
    if (typeof value === "string") {
      if (SECRET_LITERAL_PATTERN.test(value)) secret = true;
      if (PERSONAL_DATA_PATTERN.test(value)) personalData = true;
      return;
    }
    if (Array.isArray(value)) {
      for (const child of value.slice(0, 32)) visit(child, key, depth + 1);
      return;
    }
    if (isRecord(value)) {
      for (const [childKey, child] of Object.entries(value).slice(0, 64)) {
        visit(child, childKey, depth + 1);
      }
    }
  }
  visit(input, "root", 0);
  return { secret, personalData, profileData };
}

/** @param {string} command */
function isReadOnlyCommand(command) {
  if (REDIRECTION_PATTERN.test(command) || /[`]|\$\(/u.test(command))
    return false;
  const segments = command
    .split(/(?:&&|\|\||[;|\n])/u)
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (segments.length === 0) return false;
  return segments.every((segment) =>
    /^(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*(?:pwd\b|ls\b|rg\b|grep\b|head\b|tail\b|wc\b|which\b|type\b|printf\b|echo\b|cat\b|sed\s+-n\b|find\b(?![^\n]*-(?:delete|exec)\b)|git\s+(?:status|diff|log|show|remote|branch\s+--show-current)\b|npm\s+(?:test|run\s+(?:test|check|lint|typecheck|build))\b|pnpm\s+(?:(?:run\s+)?(?:test|check|lint|typecheck|build))\b|yarn\s+(?:(?:run\s+)?(?:test|check|lint|typecheck|build))\b|node\s+--test\b|pytest\b|cargo\s+test\b|go\s+test\b)/iu.test(
      segment,
    ),
  );
}

/** @param {string} command */
function shellTokens(command) {
  const matches =
    command.match(/"(?:\\.|[^"\\])*"|'[^']*'|&&|\|\||>>|[;|<>]|[^\s;|<>]+/gu) ??
    [];
  return matches.map(stripQuotes);
}

/** @param {string[]} tokens @param {string[]} names */
function commandTarget(tokens, names) {
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index].split("/").at(-1)?.toLowerCase();
    if (!token || !names.includes(token)) continue;
    const candidates = tokens
      .slice(index + 1)
      .filter((value) => !/^(?:-|&&|\|\||[;|<>])/u.test(value));
    if (token === "cp" || token === "mv") return candidates.at(-1);
    return candidates[0];
  }
  return undefined;
}

/** @param {string[]} tokens */
function permissionTarget(tokens) {
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index].split("/").at(-1)?.toLowerCase();
    if (!token || !new Set(["chmod", "chown", "setfacl"]).has(token)) continue;
    return tokens
      .slice(index + 1)
      .filter((value) => !/^(?:-|&&|\|\||[;|<>])/u.test(value))
      .at(-1);
  }
  return undefined;
}

/** @param {string[]} tokens */
function redirectionTarget(tokens) {
  const index = tokens.findIndex((token) => token === ">" || token === ">>");
  return index >= 0 ? tokens[index + 1] : undefined;
}

/** @param {string[]} tokens @param {string[]} names */
function optionValue(tokens, names) {
  for (let index = 0; index < tokens.length; index += 1) {
    if (names.includes(tokens[index])) return tokens[index + 1];
    for (const name of names.filter((value) => value.startsWith("--"))) {
      if (tokens[index].startsWith(`${name}=`))
        return tokens[index].slice(name.length + 1);
    }
  }
  return undefined;
}

/** @param {string} command */
function firstUrl(command) {
  return command.match(/https?:\/\/[^\s'"|]+/iu)?.[0];
}

/** @param {string} command */
function productionService(command) {
  return (
    command
      .match(
        /\b(?:vercel|netlify|flyctl|railway|kubectl|helm|terraform|aws|gcloud|az)\b/iu,
      )?.[0]
      ?.toLowerCase() ?? "production-target"
  );
}

/** @param {string} command */
function billingProvider(command) {
  return (
    command
      .match(/\b(?:stripe|aws|gcloud|azure|checkout|subscription)\b/iu)?.[0]
      ?.toLowerCase() ?? "billing-provider"
  );
}

/** @param {string} command */
function exactCostPresent(command) {
  return /(?:USD|KRW|EUR|GBP|JPY|\$|₩|€|£)\s*\d+(?:[.,]\d+)?|\d+(?:[.,]\d+)?\s*(?:USD|KRW|EUR|GBP|JPY)/iu.test(
    command,
  );
}

/** @param {Record<string, unknown>} input @param {string[]} keys */
function firstString(input, keys) {
  for (const key of keys) {
    if (typeof input[key] === "string" && input[key].length <= 4096)
      return input[key];
  }
  return undefined;
}

/** @param {Record<string, unknown>} input @param {string} value */
function firstKey(input, value) {
  return Object.entries(input).find(([, child]) => child === value)?.[0];
}

/** @param {string} value */
function stripQuotes(value) {
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

/** @param {string} value */
function hasGlob(value) {
  return /[*?\[]/u.test(value);
}

/** @param {string} value */
function safeToolName(value) {
  return TOOL_PATTERN.test(value) ? value : `unknown-${hashOnly(value)}`;
}

/** @param {string} value @param {string} prefix */
function privacySafeLocator(value, prefix) {
  const normalized = value.normalize("NFC").trim().replace(/\s+/gu, "-");
  if (
    normalized.length > 0 &&
    normalized.length <= 150 &&
    /^[\p{L}\p{M}\p{N}._:/#()+-]+$/u.test(normalized) &&
    !sensitiveReason(normalized)
  ) {
    return normalized;
  }
  return `${prefix}:#${hashOnly(value)}`;
}

/** @param {string} value */
function hashOnly(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

/** @param {string} value */
function fingerprint(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex").slice(0, 16)}`;
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

/** @template T @param {T} value @returns {Readonly<T>} */
function deepFreeze(value) {
  if (typeof value !== "object" || value === null || Object.isFrozen(value))
    return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
