import { lstat, readFile } from "node:fs/promises";
import { isAbsolute, join, resolve as resolvePath } from "node:path";

import { parseJsonDocument } from "../content/load.mjs";

export const INTEGRATION_SCHEMA_VERSION = 1;

const HOSTS = new Set(["claude_code", "codex", "opencode", "unknown"]);
const ORCHESTRATORS = new Set(["superpowers", "omo", "omx"]);
const ADAPTERS = new Set([
  "claude_plugin",
  "omo_claude_import",
  "opencode_native",
  "codex_advisory",
]);
const SNAPSHOT_KEYS = [
  "schema_version",
  "host",
  "host_version",
  "enabled_plugins",
  "orchestrators",
  "fairytail_adapters",
  "capabilities",
];
const CAPABILITY_KEYS = [
  "namespaced_skills",
  "plugin_hooks",
  "isolated_agent",
  "model_allowed",
];
const SAFE_ID = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u;
const VERSION = /^[A-Za-z0-9][A-Za-z0-9.+_-]{0,63}$/u;
const MAX_CONFIG_BYTES = 256 * 1024;

export const FORBIDDEN_MUTATIONS = Object.freeze([
  "AGENTS.md",
  "CLAUDE.md",
  ".omx/",
  ".omo/",
  ".codex/hooks.json",
  "opencode.json",
  "oh-my-openagent.json",
  "oh-my-opencode.json",
  "another-plugin-files",
]);

/**
 * Validate the closed capability snapshot used by every adapter decision.
 * Values are identifiers only; paths and raw configuration are not representable.
 *
 * @param {unknown} value
 */
export function validateCapabilitySnapshot(value) {
  const snapshot = structuredClone(plainRecord(value, "capability snapshot"));
  exactKeys(snapshot, SNAPSHOT_KEYS, "capability snapshot");
  if (snapshot.schema_version !== INTEGRATION_SCHEMA_VERSION) {
    throw new TypeError("unsupported integration schema version");
  }
  if (!HOSTS.has(snapshot.host)) {
    throw new TypeError("integration host is invalid");
  }
  if (
    snapshot.host_version !== null &&
    (typeof snapshot.host_version !== "string" ||
      !VERSION.test(snapshot.host_version))
  ) {
    throw new TypeError("integration host version is invalid");
  }
  snapshot.enabled_plugins = idList(
    snapshot.enabled_plugins,
    "enabled plugins",
  );
  snapshot.orchestrators = enumList(
    snapshot.orchestrators,
    ORCHESTRATORS,
    "orchestrators",
  );
  snapshot.fairytail_adapters = enumList(
    snapshot.fairytail_adapters,
    ADAPTERS,
    "Fairytail adapters",
  );
  const capabilities = plainRecord(
    snapshot.capabilities,
    "integration capabilities",
  );
  exactKeys(capabilities, CAPABILITY_KEYS, "integration capabilities");
  for (const key of CAPABILITY_KEYS) {
    if (typeof capabilities[key] !== "boolean") {
      throw new TypeError(`integration capability ${key} must be boolean`);
    }
  }
  return deepFreeze(snapshot);
}

/**
 * Select one conservative adapter mode. Fairytail never becomes the active
 * orchestrator and never assumes hook ordering.
 *
 * @param {unknown} value
 */
export function resolveIntegration(value) {
  const snapshot = validateCapabilitySnapshot(value);
  const duplicateAdapters = snapshot.fairytail_adapters.length > 1;
  const supportedHost = snapshot.host === "claude_code";
  const mode = duplicateAdapters
    ? "duplicate_adapter_blocked"
    : supportedHost
      ? snapshot.orchestrators.length > 0
        ? "additive_explanation_only"
        : "standalone"
      : "advisory_only";
  const modelRoute =
    supportedHost &&
    !duplicateAdapters &&
    snapshot.capabilities.isolated_agent &&
    snapshot.capabilities.model_allowed
      ? "isolated_subagent"
      : "deterministic_inline";
  return deepFreeze({
    schema_version: INTEGRATION_SCHEMA_VERSION,
    status: duplicateAdapters ? "blocked" : "ready",
    reason_code: duplicateAdapters
      ? "FTI-DUPLICATE-ADAPTER"
      : supportedHost
        ? snapshot.orchestrators.length > 0
          ? "FTI-ORCHESTRATOR-PRESERVED"
          : "FTI-STANDALONE"
        : "FTI-UNSUPPORTED-HOST-ADVISORY",
    mode,
    model_route: modelRoute,
    optional_layer_enabled: supportedHost && !duplicateAdapters,
    active_orchestrators_preserved: [...snapshot.orchestrators],
    owns_orchestration: false,
    executes_tasks: false,
    changes_parent_model: false,
    assumes_hook_order: false,
    writes_global_guidance: false,
    duplicate_execution_possible: false,
    allowed_mutations:
      supportedHost && !duplicateAdapters
        ? [
            "fairytail-owned-local-marketplace",
            "claude-plugin-registry",
            "fairytail-plugin-data",
          ]
        : [],
    forbidden_mutations: [...FORBIDDEN_MUTATIONS],
  });
}

/**
 * Inspect a bounded local Claude installation without returning file contents
 * or paths. Other harness markers are detected only so they can be preserved.
 *
 * @param {{ configDir: string, workspaceRoot: string, hostVersion?: string | null }} value
 */
export async function inspectClaudeEnvironment(value) {
  const options = plainRecord(value, "Claude environment options");
  exactKeys(
    options,
    ["configDir", "workspaceRoot", "hostVersion"],
    "Claude environment options",
  );
  const configDir = localAbsolutePath(options.configDir, "configDir");
  const workspaceRoot = localAbsolutePath(
    options.workspaceRoot,
    "workspaceRoot",
  );
  const hostVersion = options.hostVersion ?? null;
  if (hostVersion !== null && typeof hostVersion !== "string") {
    throw new TypeError("hostVersion must be a string or null");
  }

  const enabledPlugins = await readEnabledPlugins(configDir);
  const orchestrators = new Set();
  if (enabledPlugins.includes("superpowers")) orchestrators.add("superpowers");
  if (
    enabledPlugins.includes("oh-my-openagent") ||
    enabledPlugins.includes("oh-my-opencode")
  ) {
    orchestrators.add("omo");
  }
  const adapters = new Set();
  if (enabledPlugins.includes("fairytail")) adapters.add("claude_plugin");

  const [hasOmxState, hasOmoState, hasOpenCodeState, agentsGuidance, opencode] =
    await Promise.all([
      exists(join(workspaceRoot, ".omx")),
      exists(join(workspaceRoot, ".omo")),
      exists(join(workspaceRoot, ".opencode")),
      readBoundedText(join(workspaceRoot, "AGENTS.md"), "AGENTS guidance"),
      readBoundedText(
        join(workspaceRoot, "opencode.json"),
        "OpenCode configuration",
      ),
    ]);
  const opencodeText = opencode ?? "";
  if (hasOmxState || /<!--\s*OMX:/u.test(agentsGuidance ?? "")) {
    orchestrators.add("omx");
  }
  if (
    hasOmoState ||
    hasOpenCodeState ||
    /oh-my-(?:openagent|opencode)/u.test(opencodeText)
  ) {
    orchestrators.add("omo");
  }
  if (/(?:fairytail-native|fairytail@claude-import)/u.test(opencodeText)) {
    if (/fairytail-native/u.test(opencodeText)) {
      adapters.add("opencode_native");
    }
    if (/fairytail@claude-import/u.test(opencodeText)) {
      adapters.add("omo_claude_import");
    }
  }

  const snapshot = validateCapabilitySnapshot({
    schema_version: INTEGRATION_SCHEMA_VERSION,
    host: "claude_code",
    host_version: hostVersion,
    enabled_plugins: enabledPlugins,
    orchestrators: [...orchestrators].sort(),
    fairytail_adapters: [...adapters].sort(),
    capabilities: {
      namespaced_skills: true,
      plugin_hooks: true,
      isolated_agent: true,
      model_allowed: false,
    },
  });
  return deepFreeze({ snapshot, decision: resolveIntegration(snapshot) });
}

/** @param {string} configDir */
async function readEnabledPlugins(configDir) {
  const source = await readBoundedText(
    join(configDir, "settings.json"),
    "Claude settings",
  );
  if (source === null) return [];
  try {
    const value = parseJsonDocument(source, "Claude settings identifier scan");
    if (!isRecord(value)) {
      throw new TypeError("Claude settings must be an object");
    }
    if (value.enabledPlugins === undefined) return [];
    if (!isRecord(value.enabledPlugins)) {
      throw new TypeError("Claude enabledPlugins must be an object");
    }
    return [
      ...new Set(
        Object.entries(value.enabledPlugins)
          .filter(([, enabled]) => enabled === true)
          .map(([name]) => pluginId(name))
          .filter(Boolean),
      ),
    ].sort();
  } catch (error) {
    throw new Error("Claude settings could not be inspected safely", {
      cause: error,
    });
  }
}

/** @param {string} value */
function pluginId(value) {
  const id = value.split("@")[0]?.trim().toLowerCase() ?? "";
  return SAFE_ID.test(id) ? id : "";
}

/** @param {string} path @param {string} label */
async function readBoundedText(path, label) {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.size > MAX_CONFIG_BYTES) {
      throw new Error(`${label} is not a bounded regular file`);
    }
    return await readFile(path, "utf8");
  } catch (error) {
    if (missingPath(error)) return null;
    throw new Error(`${label} could not be inspected safely`, {
      cause: error,
    });
  }
}

/** @param {string} path */
async function exists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (missingPath(error)) return false;
    throw new Error("Harness marker could not be inspected safely", {
      cause: error,
    });
  }
}

/** @param {unknown} error */
function missingPath(error) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  );
}

/** @param {unknown} value @param {string} label */
function localAbsolutePath(value, label) {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.length === 0 ||
    value.length > 4096 ||
    value.includes("\0") ||
    !isAbsolute(value) ||
    /^[A-Za-z][A-Za-z\d+.-]*:/u.test(value)
  ) {
    throw new TypeError(`${label} must be an absolute local path`);
  }
  return resolvePath(value);
}

/** @param {unknown} value @param {string} label */
function idList(value, label) {
  if (!Array.isArray(value) || value.length > 32) {
    throw new TypeError(`${label} must be a bounded array`);
  }
  const output = value.map((item) => {
    if (typeof item !== "string" || !SAFE_ID.test(item)) {
      throw new TypeError(`${label} contains an invalid identifier`);
    }
    return item;
  });
  if (new Set(output).size !== output.length) {
    throw new TypeError(`${label} contains a duplicate identifier`);
  }
  return output;
}

/** @param {unknown} value @param {Set<string>} allowed @param {string} label */
function enumList(value, allowed, label) {
  const output = idList(value, label);
  if (output.some((item) => !allowed.has(item))) {
    throw new TypeError(`${label} contains an unsupported identifier`);
  }
  return output;
}

/** @param {unknown} value @param {string} label @returns {Record<string, any>} */
function plainRecord(value, label) {
  if (!isRecord(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(`${label} must be a plain object`);
  }
  return value;
}

/** @param {Record<string, unknown>} value @param {string[]} expected @param {string} label */
function exactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (
    actual.length !== wanted.length ||
    actual.some((key, index) => key !== wanted[index])
  ) {
    throw new TypeError(`${label} fields are invalid`);
  }
}

/** @param {unknown} value @returns {value is Record<string, any>} */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** @template T @param {T} value @returns {Readonly<T>} */
function deepFreeze(value) {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
