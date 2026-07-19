import { homedir } from "node:os";
import { resolve } from "node:path";

export const CODEX_FAIRYTAIL_DATA_DIRECTORY = "fairytail";

/**
 * Resolve Fairytail's private host-local data directory without inspecting a
 * project. Explicit and compatibility environment paths win; Codex otherwise
 * receives one stable directory under CODEX_HOME (or the platform default).
 *
 * @param {{
 *   dataDir?: string,
 *   host?: "claude" | "codex",
 *   environment?: NodeJS.ProcessEnv,
 *   userHome?: string
 * }} [options]
 * @returns {string | null}
 */
export function resolveFairytailDataDir(options = {}) {
  const environment = options.environment ?? process.env;
  const configured =
    options.dataDir ??
    environment.FAIRYTAIL_DATA_DIR ??
    environment.CLAUDE_PLUGIN_DATA;
  if (configured !== undefined) return localPath(configured);
  if (options.host !== "codex") return null;

  const codexHome =
    environment.CODEX_HOME ??
    resolve(localPath(options.userHome ?? homedir()), ".codex");
  return resolve(localPath(codexHome), CODEX_FAIRYTAIL_DATA_DIRECTORY);
}

/** @param {string} value */
function localPath(value) {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.length === 0 ||
    value.includes("\0") ||
    /^[A-Za-z][A-Za-z\d+.-]*:/u.test(value)
  ) {
    throw new TypeError("Fairytail data directory must be a local path");
  }
  return resolve(value);
}
