#!/usr/bin/env node

import { homedir } from "node:os";
import { dirname, resolve as resolvePath } from "node:path";
import { stdout } from "node:process";
import { fileURLToPath } from "node:url";

import {
  installLocalFairytail,
  planLocalInstall,
  uninstallLocalFairytail,
} from "../src/integration/installer.mjs";

const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const GENERIC_ERROR = Object.freeze({
  schema_version: 1,
  status: "error",
  code: "fairytail-installer-failed-safely",
});

try {
  const options = parseArguments(process.argv.slice(2));
  const common = {
    configDir: options.configDir,
    workspaceRoot: options.workspaceRoot,
    claudeBin: options.claudeBin,
    scope: options.scope,
    hostVersion: options.hostVersion,
  };
  const result =
    options.command === "uninstall"
      ? await uninstallLocalFairytail({
          ...common,
          keepData: options.keepData,
        })
      : options.command === "install"
        ? await installLocalFairytail({
            ...common,
            pluginRoot,
            enable: options.enable,
          })
        : await planLocalInstall({
            ...common,
            pluginRoot,
            enable: options.enable,
          });
  stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch {
  stdout.write(`${JSON.stringify(GENERIC_ERROR)}\n`);
  process.exitCode = 1;
}

/** @param {string[]} args */
function parseArguments(args) {
  const command = args[0] ?? "plan";
  if (!new Set(["plan", "install", "uninstall"]).has(command)) {
    throw new TypeError("unsupported installer command");
  }
  /** @type {Record<string, string | boolean>} */
  const values = {};
  const flags = new Set(["--no-enable", "--keep-data"]);
  for (let index = 1; index < args.length; index += 1) {
    const option = args[index];
    if (flags.has(option)) {
      if (option in values) throw new TypeError("duplicate installer flag");
      values[option] = true;
      continue;
    }
    if (
      !new Set([
        "--config-dir",
        "--workspace",
        "--claude-bin",
        "--scope",
        "--host-version",
      ]).has(option) ||
      option in values
    ) {
      throw new TypeError("invalid installer option");
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new TypeError("installer option value is missing");
    }
    values[option] = value;
    index += 1;
  }
  if (command !== "uninstall" && values["--keep-data"] === true) {
    throw new TypeError("keep-data applies only to uninstall");
  }
  if (command === "uninstall" && values["--no-enable"] === true) {
    throw new TypeError("no-enable does not apply to uninstall");
  }
  return {
    command,
    configDir: localPath(
      values["--config-dir"] ??
        process.env.CLAUDE_CONFIG_DIR ??
        resolvePath(homedir(), ".claude"),
    ),
    workspaceRoot: localPath(values["--workspace"] ?? process.cwd()),
    claudeBin: localExecutable(
      values["--claude-bin"] ?? process.env.FAIRYTAIL_CLAUDE_BIN ?? "claude",
    ),
    scope: values["--scope"] ?? "user",
    hostVersion: values["--host-version"] ?? "2.1.214",
    enable: values["--no-enable"] !== true,
    keepData: values["--keep-data"] === true,
  };
}

/** @param {unknown} value */
function localPath(value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.includes("\0") ||
    /^[A-Za-z][A-Za-z\d+.-]*:/u.test(value)
  ) {
    throw new TypeError("installer requires a local path");
  }
  return resolvePath(value);
}

/** @param {unknown} value */
function localExecutable(value) {
  if (
    typeof value === "string" &&
    value.length > 0 &&
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/u.test(value)
  ) {
    return value;
  }
  return localPath(value);
}
