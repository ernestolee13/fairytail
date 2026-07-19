import { spawn } from "node:child_process";
import { lstatSync } from "node:fs";
import {
  chmod,
  cp,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rm,
  rmdir,
  unlink,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve as resolvePath,
  sep,
} from "node:path";

import { parseJsonDocument } from "../content/load.mjs";
import { inspectClaudeEnvironment } from "./capabilities.mjs";

export const INSTALLER_SCHEMA_VERSION = 1;
export const INSTALLER_ROOT_NAME = "fairytail-local-installer";

const INSTALL_KEYS = [
  "pluginRoot",
  "configDir",
  "workspaceRoot",
  "claudeBin",
  "scope",
  "enable",
  "hostVersion",
];
const UNINSTALL_KEYS = [
  "configDir",
  "workspaceRoot",
  "claudeBin",
  "scope",
  "keepData",
  "hostVersion",
];
const SCOPES = new Set(["user", "project", "local"]);
const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_CLAUDE_OUTPUT_BYTES = 1024 * 1024;
const DEFAULT_CLAUDE_TIMEOUT_MS = 120_000;
const MAX_CLAUDE_TIMEOUT_MS = 300_000;
const FORCE_KILL_GRACE_MS = 1_000;
const INSTALLER_LOCK_NAME = ".installing";
const PACKAGE_ROOT_ENTRIES = new Set([
  ".claude-plugin",
  "LICENSE",
  "LICENSES",
  "PRIVACY.md",
  "README.ko.md",
  "README.md",
  "THIRD_PARTY_NOTICES.md",
  "agents",
  "content",
  "commands",
  "docs",
  "hooks",
  "output-styles",
  "schemas",
  "scripts",
  "skills",
  "src",
]);
const RUNTIME_SCRIPTS = new Set([
  "fairytail-doctor.mjs",
  "fairytail-g005.mjs",
  "fairytail-g010.mjs",
  "fairytail-hook.mjs",
  "fairytail-install.mjs",
  "fairytail-personalize.mjs",
  "fairytail-profile.mjs",
  "fairytail-safety.mjs",
]);

/**
 * Produce the bounded plan shown before installation. No configuration changes
 * occur and no raw path is returned.
 *
 * @param {unknown} value
 */
export async function planLocalInstall(value) {
  const options = await validateInstallOptions(value);
  const environment = await inspectClaudeEnvironment({
    configDir: options.configDir,
    workspaceRoot: options.workspaceRoot,
    hostVersion: options.hostVersion,
  });
  const manifest = await loadPluginManifest(options.pluginRoot);
  const location = installLocation(options.configDir, manifest.version);
  const installerRootOccupied = await hasInstallerState(options.configDir);
  return deepFreeze({
    schema_version: INSTALLER_SCHEMA_VERSION,
    status:
      environment.decision.status === "ready" && !installerRootOccupied
        ? "ready"
        : "blocked",
    operation: "install",
    plugin: manifest.name,
    version: manifest.version,
    scope: options.scope,
    enable_after_install: options.enable,
    integration: environment.decision,
    destination: {
      owner: "fairytail",
      marketplace: location.marketplaceName,
      exact_root_fingerprint: pathFingerprintLabel(location.stageRoot),
    },
    overwrites_existing_files: false,
    network_required: false,
  });
}

/**
 * Stage a versioned local marketplace, register it with Claude Code, install
 * Fairytail, and optionally enable it. The only recursive removal path is the
 * exact marker-verified Fairytail-owned staging root during rollback.
 *
 * @param {unknown} value
 * @param {{ runner?: typeof runClaude }} [dependencies]
 */
export async function installLocalFairytail(value, dependencies = {}) {
  const options = await validateInstallOptions(value);
  const runner = dependencies.runner ?? runClaude;
  const plan = await planLocalInstall(options);
  if (plan.status !== "ready") {
    throw new Error("Fairytail integration plan is blocked");
  }
  const manifest = await loadPluginManifest(options.pluginRoot);
  const location = installLocation(options.configDir, manifest.version);
  validateNonRecursiveLayout(options.pluginRoot, location.stageRoot);
  if (await exists(location.stageRoot)) {
    throw new Error("Fairytail local installer destination already exists");
  }

  let marketplaceMutationAttempted = false;
  let pluginMutationAttempted = false;
  await createOwnedStage(location, manifest);
  try {
    await populateMarketplace(options.pluginRoot, location, manifest);
    const environment = {
      ...process.env,
      CLAUDE_CONFIG_DIR: options.configDir,
    };
    marketplaceMutationAttempted = true;
    await runner(
      options.claudeBin,
      [
        "plugin",
        "marketplace",
        "add",
        location.marketplaceRoot,
        "--scope",
        "user",
      ],
      { cwd: options.workspaceRoot, env: environment },
    );
    pluginMutationAttempted = true;
    await runner(
      options.claudeBin,
      [
        "plugin",
        "install",
        location.pluginIdentifier,
        "--scope",
        options.scope,
      ],
      { cwd: options.workspaceRoot, env: environment },
    );
    if (options.enable) {
      await runner(
        options.claudeBin,
        [
          "plugin",
          "enable",
          location.pluginIdentifier,
          "--scope",
          options.scope,
        ],
        { cwd: options.workspaceRoot, env: environment },
      );
    }
    const listing = await runner(
      options.claudeBin,
      ["plugin", "list", "--json"],
      { cwd: options.workspaceRoot, env: environment },
    );
    if (!pluginListContainsExactId(listing.stdout, location.pluginIdentifier)) {
      throw new Error("Claude plugin list did not confirm Fairytail");
    }
    return deepFreeze({
      schema_version: INSTALLER_SCHEMA_VERSION,
      status: "installed",
      plugin: manifest.name,
      version: manifest.version,
      scope: options.scope,
      enabled: options.enable,
      marketplace: location.marketplaceName,
      integration: plan.integration,
      network_calls: 0,
      other_harness_files_changed: 0,
    });
  } catch (error) {
    const rollbackErrors = [];
    const environment = {
      ...process.env,
      CLAUDE_CONFIG_DIR: options.configDir,
    };
    if (pluginMutationAttempted) {
      try {
        await reconcileExactRemoval(
          () =>
            runner(
              options.claudeBin,
              [
                "plugin",
                "uninstall",
                location.pluginIdentifier,
                "--scope",
                options.scope,
                "--yes",
              ],
              { cwd: options.workspaceRoot, env: environment },
            ),
          () =>
            listedExactly(
              runner,
              options.claudeBin,
              ["plugin", "list", "--json"],
              options.workspaceRoot,
              environment,
              (stdout) =>
                pluginListContainsExactId(stdout, location.pluginIdentifier),
            ),
          "Fairytail plugin",
        );
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (marketplaceMutationAttempted) {
      try {
        await reconcileExactRemoval(
          () =>
            runner(
              options.claudeBin,
              [
                "plugin",
                "marketplace",
                "remove",
                location.marketplaceName,
                "--scope",
                "user",
              ],
              { cwd: options.workspaceRoot, env: environment },
            ),
          () =>
            listedExactly(
              runner,
              options.claudeBin,
              ["plugin", "marketplace", "list", "--json"],
              options.workspaceRoot,
              environment,
              (stdout) =>
                marketplaceListContainsExactName(
                  stdout,
                  location.marketplaceName,
                ),
            ),
          "Fairytail marketplace",
        );
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    try {
      await removeVerifiedStage(location);
    } catch (rollbackError) {
      rollbackErrors.push(rollbackError);
    }
    if (rollbackErrors.length > 0) {
      throw new AggregateError(
        [error, ...rollbackErrors],
        "Fairytail installation failed and rollback was incomplete",
        { cause: error },
      );
    }
    throw error;
  }
}

/**
 * Remove the exact installed plugin and its marker-verified local marketplace.
 * `keepData` is explicit; without it Claude Code removes Fairytail plugin data.
 *
 * @param {unknown} value
 * @param {{ runner?: typeof runClaude }} [dependencies]
 */
export async function uninstallLocalFairytail(value, dependencies = {}) {
  const options = validateUninstallOptions(value);
  const runner = dependencies.runner ?? runClaude;
  const location = await findInstalledLocation(options.configDir);
  const environment = { ...process.env, CLAUDE_CONFIG_DIR: options.configDir };
  const uninstallArgs = [
    "plugin",
    "uninstall",
    location.pluginIdentifier,
    "--scope",
    options.scope,
    "--yes",
  ];
  if (options.keepData) uninstallArgs.push("--keep-data");
  const removalErrors = [];
  try {
    await reconcileExactRemoval(
      () =>
        runner(options.claudeBin, uninstallArgs, {
          cwd: options.workspaceRoot,
          env: environment,
        }),
      () =>
        listedExactly(
          runner,
          options.claudeBin,
          ["plugin", "list", "--json"],
          options.workspaceRoot,
          environment,
          (stdout) =>
            pluginListContainsExactId(stdout, location.pluginIdentifier),
        ),
      "Fairytail plugin",
    );
  } catch (error) {
    removalErrors.push(error);
  }
  try {
    await reconcileExactRemoval(
      () =>
        runner(
          options.claudeBin,
          [
            "plugin",
            "marketplace",
            "remove",
            location.marketplaceName,
            "--scope",
            "user",
          ],
          { cwd: options.workspaceRoot, env: environment },
        ),
      () =>
        listedExactly(
          runner,
          options.claudeBin,
          ["plugin", "marketplace", "list", "--json"],
          options.workspaceRoot,
          environment,
          (stdout) =>
            marketplaceListContainsExactName(stdout, location.marketplaceName),
        ),
      "Fairytail marketplace",
    );
  } catch (error) {
    removalErrors.push(error);
  }
  if (removalErrors.length > 0) {
    throw new AggregateError(
      removalErrors,
      "Fairytail uninstall could not confirm all host removals",
    );
  }
  await removeVerifiedStage(location);
  return deepFreeze({
    schema_version: INSTALLER_SCHEMA_VERSION,
    status: "uninstalled",
    plugin: "fairytail",
    scope: options.scope,
    data_preserved: options.keepData,
    marketplace_removed: true,
    other_harness_files_changed: 0,
  });
}

/**
 * Reconcile an exact host registration to absent. Listing first avoids false
 * failures for already-absent registrations; listing after the command proves
 * the final state even when a host mutates and exits non-zero.
 *
 * @param {() => Promise<unknown>} remove
 * @param {() => Promise<boolean>} isPresent
 * @param {string} label
 */
async function reconcileExactRemoval(remove, isPresent, label) {
  const errors = [];
  try {
    if (!(await isPresent())) return;
  } catch (error) {
    errors.push(error);
  }
  try {
    await remove();
  } catch (error) {
    errors.push(error);
  }
  try {
    if (!(await isPresent())) return;
    errors.push(new Error(`${label} is still registered`));
  } catch (error) {
    errors.push(error);
  }
  throw new AggregateError(errors, `${label} removal could not be confirmed`, {
    cause: errors[0],
  });
}

/**
 * @param {typeof runClaude} runner
 * @param {string} binary
 * @param {string[]} args
 * @param {string} cwd
 * @param {NodeJS.ProcessEnv} environment
 * @param {(stdout: unknown) => boolean} containsExactEntry
 */
async function listedExactly(
  runner,
  binary,
  args,
  cwd,
  environment,
  containsExactEntry,
) {
  const listing = await runner(binary, args, { cwd, env: environment });
  return containsExactEntry(listing.stdout);
}

/** @param {unknown} value */
async function validateInstallOptions(value) {
  const options = structuredClone(plainRecord(value, "installer options"));
  exactKeys(options, INSTALL_KEYS, "installer options");
  const output = {
    pluginRoot: localAbsolutePath(options.pluginRoot, "pluginRoot"),
    configDir: localAbsolutePath(options.configDir, "configDir"),
    workspaceRoot: localAbsolutePath(options.workspaceRoot, "workspaceRoot"),
    claudeBin: localExecutable(options.claudeBin, "claudeBin"),
    scope: scope(options.scope),
    enable: options.enable,
    hostVersion: hostVersion(options.hostVersion),
  };
  if (typeof output.enable !== "boolean") {
    throw new TypeError("installer enable must be boolean");
  }
  return output;
}

/** @param {unknown} value */
function validateUninstallOptions(value) {
  const options = structuredClone(plainRecord(value, "uninstaller options"));
  exactKeys(options, UNINSTALL_KEYS, "uninstaller options");
  const output = {
    configDir: localAbsolutePath(options.configDir, "configDir"),
    workspaceRoot: localAbsolutePath(options.workspaceRoot, "workspaceRoot"),
    claudeBin: localExecutable(options.claudeBin, "claudeBin"),
    scope: scope(options.scope),
    keepData: options.keepData,
    hostVersion: hostVersion(options.hostVersion),
  };
  if (typeof output.keepData !== "boolean") {
    throw new TypeError("uninstaller keepData must be boolean");
  }
  return output;
}

/** @param {string} pluginRoot */
async function loadPluginManifest(pluginRoot) {
  const path = join(pluginRoot, ".claude-plugin", "plugin.json");
  const info = await lstat(path);
  if (!info.isFile() || info.size > MAX_MANIFEST_BYTES) {
    throw new Error("Fairytail plugin manifest is unavailable");
  }
  const manifest = parseJsonDocument(
    await readFile(path),
    "Fairytail plugin manifest",
  );
  if (
    !isRecord(manifest) ||
    manifest.name !== "fairytail" ||
    typeof manifest.version !== "string" ||
    !/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/u.test(manifest.version)
  ) {
    throw new Error("Fairytail plugin manifest identity is invalid");
  }
  return { name: "fairytail", version: manifest.version };
}

/** @param {string} configDir @param {string} version */
function installLocation(configDir, version) {
  const versionId = version.replace(/[^A-Za-z0-9]+/gu, "-").toLowerCase();
  const marketplaceName = `fairytail-local-${versionId}`;
  const stageRoot = join(configDir, INSTALLER_ROOT_NAME, versionId);
  const marketplaceRoot = join(stageRoot, "marketplace");
  return {
    version,
    stageRoot,
    marketplaceRoot,
    pluginRoot: join(marketplaceRoot, "plugins", "fairytail"),
    markerPath: join(stageRoot, "install-marker.json"),
    marketplaceName,
    pluginIdentifier: `fairytail@${marketplaceName}`,
  };
}

/** @param {ReturnType<typeof installLocation>} location @param {{ name: string, version: string }} manifest */
async function createOwnedStage(location, manifest) {
  const installerRoot = dirname(location.stageRoot);
  const lockPath = join(installerRoot, INSTALLER_LOCK_NAME);
  await mkdir(installerRoot, { recursive: true, mode: 0o700 });
  const lockHandle = await open(lockPath, "wx", 0o600);
  let lockClosed = false;
  let lockRemoved = false;
  let stageCreated = false;
  let markerWritten = false;
  try {
    const entries = await readdir(installerRoot);
    if (entries.length !== 1 || entries[0] !== INSTALLER_LOCK_NAME) {
      throw new Error("Fairytail local installer state already exists");
    }
    await mkdir(location.stageRoot, { mode: 0o700 });
    stageCreated = true;
    await chmod(location.stageRoot, 0o700);
    await writeExclusiveJson(location.markerPath, {
      schema_version: INSTALLER_SCHEMA_VERSION,
      owner: "fairytail",
      plugin: manifest.name,
      version: manifest.version,
      marketplace: location.marketplaceName,
    });
    markerWritten = true;
    await lockHandle.close();
    lockClosed = true;
    await unlink(lockPath);
    lockRemoved = true;
  } catch (error) {
    const cleanupErrors = [];
    if (!lockClosed) {
      try {
        await lockHandle.close();
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError);
      }
    }
    if (!lockRemoved) {
      try {
        await unlink(lockPath);
      } catch (cleanupError) {
        if (!(isNodeError(cleanupError) && cleanupError.code === "ENOENT")) {
          cleanupErrors.push(cleanupError);
        }
      }
    }
    if (stageCreated) {
      try {
        if (markerWritten) {
          await removeVerifiedStage(location);
        } else {
          try {
            await unlink(location.markerPath);
          } catch (cleanupError) {
            if (!(
              isNodeError(cleanupError) && cleanupError.code === "ENOENT"
            )) {
              throw cleanupError;
            }
          }
          await rmdir(location.stageRoot);
        }
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError);
      }
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        [error, ...cleanupErrors],
        "Fairytail could not create a clean owned staging root",
        { cause: error },
      );
    }
    throw error;
  }
}

/** @param {string} pluginRoot @param {ReturnType<typeof installLocation>} location @param {{ name: string, version: string }} manifest */
async function populateMarketplace(pluginRoot, location, manifest) {
  await mkdir(join(location.marketplaceRoot, ".claude-plugin"), {
    recursive: true,
    mode: 0o700,
  });
  await mkdir(join(location.marketplaceRoot, "plugins"), {
    recursive: true,
    mode: 0o700,
  });
  await cp(pluginRoot, location.pluginRoot, {
    recursive: true,
    errorOnExist: true,
    force: false,
    filter: (source) => safePackageFilter(pluginRoot, source),
  });
  await writeExclusiveJson(
    join(location.marketplaceRoot, ".claude-plugin", "marketplace.json"),
    {
      $schema: "https://anthropic.com/claude-code/marketplace.schema.json",
      name: location.marketplaceName,
      description:
        "Local, versioned Fairytail marketplace created by the Fairytail installer.",
      owner: { name: "Fairytail" },
      plugins: [
        {
          name: manifest.name,
          description:
            "Beginner-friendly explanations with fixed facts and deterministic safety boundaries.",
          source: "./plugins/fairytail",
        },
      ],
    },
  );
}

/** @param {string} pluginRoot @param {string} source */
function safePackageFilter(pluginRoot, source) {
  if (!packageFilter(pluginRoot, source)) return false;
  const info = lstatSync(source);
  if (info.isSymbolicLink()) {
    throw new Error("Fairytail package cannot contain a symbolic link");
  }
  if (!info.isFile() && !info.isDirectory()) {
    throw new Error("Fairytail package contains an unsupported file type");
  }
  return true;
}

/** @param {string} pluginRoot @param {string} source */
function packageFilter(pluginRoot, source) {
  const path = relative(pluginRoot, source);
  if (!path) return true;
  const parts = path.split(sep);
  if (!PACKAGE_ROOT_ENTRIES.has(parts[0])) return false;
  if (parts[0] === "scripts") {
    return parts.length === 1 || RUNTIME_SCRIPTS.has(parts[1]);
  }
  if (parts[0] === "src" && parts[1] === "benchmark") return false;
  if (parts[0] === "docs") {
    return (
      parts.length === 1 ||
      (parts.length === 2 && parts[1].endsWith(".md")) ||
      path === join("docs", "assets") ||
      path === join("docs", "assets", "fairytail-hero.png")
    );
  }
  return true;
}

/** @param {string} path @param {unknown} value */
async function writeExclusiveJson(path, value) {
  const handle = await open(path, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/** @param {string} configDir */
async function findInstalledLocation(configDir) {
  const root = join(configDir, INSTALLER_ROOT_NAME);
  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    throw new Error("Fairytail local installer root is invalid");
  }
  const entries = await readdir(root, { withFileTypes: true });
  if (entries.length !== 1 || !entries[0].isDirectory()) {
    throw new Error("Expected exactly one Fairytail local installation");
  }
  const stageRoot = join(root, entries[0].name);
  const markerPath = join(stageRoot, "install-marker.json");
  const marker = await readMarker(markerPath);
  const location = installLocation(configDir, marker.version);
  if (
    location.stageRoot !== stageRoot ||
    marker.marketplace !== location.marketplaceName
  ) {
    throw new Error(
      "Fairytail installation marker does not match its exact root",
    );
  }
  return location;
}

/** @param {string} path */
async function readMarker(path) {
  const info = await lstat(path);
  if (!info.isFile() || info.size > MAX_MANIFEST_BYTES) {
    throw new Error("Fairytail installation marker is invalid");
  }
  const marker = parseJsonDocument(
    await readFile(path),
    "Fairytail installation marker",
  );
  if (
    !isRecord(marker) ||
    marker.schema_version !== INSTALLER_SCHEMA_VERSION ||
    marker.owner !== "fairytail" ||
    marker.plugin !== "fairytail" ||
    typeof marker.version !== "string" ||
    typeof marker.marketplace !== "string" ||
    Object.keys(marker).length !== 5
  ) {
    throw new Error("Fairytail installation marker is invalid");
  }
  return /** @type {{ version: string, marketplace: string }} */ (marker);
}

/** @param {ReturnType<typeof installLocation>} location */
async function removeVerifiedStage(location) {
  const marker = await readMarker(location.markerPath);
  if (
    marker.version !== location.version ||
    marker.marketplace !== location.marketplaceName
  ) {
    throw new Error("Refusing to remove an unverified installer directory");
  }
  const parent = resolvePath(location.stageRoot, "..");
  const configDir = resolvePath(location.stageRoot, "..", "..");
  const versionId = location.version
    .replace(/[^A-Za-z0-9]+/gu, "-")
    .toLowerCase();
  if (
    parent !== join(configDir, INSTALLER_ROOT_NAME) ||
    basename(location.stageRoot) !== versionId
  ) {
    throw new Error("Refusing an unexpected installer root");
  }
  await rm(location.stageRoot, { recursive: true, force: false });
}

/** @param {string} pluginRoot @param {string} stageRoot */
function validateNonRecursiveLayout(pluginRoot, stageRoot) {
  const path = relative(pluginRoot, stageRoot);
  if (path === "" || (!path.startsWith(`..${sep}`) && path !== "..")) {
    throw new Error("Installer destination cannot be inside the plugin source");
  }
}

/** @param {string} value */
function pathFingerprintLabel(value) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return `local-root-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/** @param {string} binary @param {string[]} args @param {{ cwd: string, env: NodeJS.ProcessEnv }} options */
function runClaude(binary, args, options) {
  const timeoutMs = commandTimeoutMs(options.env);
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let outputBytes = 0;
    let timedOut = false;
    let outputExceeded = false;
    let settled = false;
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let forceKillTimer;
    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, timeoutMs);

    function terminate() {
      child.kill("SIGTERM");
      forceKillTimer ??= setTimeout(() => {
        child.kill("SIGKILL");
      }, FORCE_KILL_GRACE_MS);
    }

    function cleanupTimers() {
      clearTimeout(timeoutTimer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
    }

    /** @param {unknown} error */
    function fail(error) {
      if (settled) return;
      settled = true;
      cleanupTimers();
      reject(error);
    }

    /** @param {Buffer | string} chunk @param {"stdout" | "stderr"} channel */
    function collect(chunk, channel) {
      const text = chunk.toString();
      outputBytes += Buffer.byteLength(text);
      if (outputBytes > MAX_CLAUDE_OUTPUT_BYTES) {
        outputExceeded = true;
        terminate();
        return;
      }
      if (channel === "stdout") stdout += text;
      else stderr += text;
    }

    child.stdout.on("data", (chunk) => {
      collect(chunk, "stdout");
    });
    child.stderr.on("data", (chunk) => {
      collect(chunk, "stderr");
    });
    child.on("error", fail);
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      cleanupTimers();
      if (timedOut) {
        reject(new Error("Claude plugin command timed out"));
      } else if (outputExceeded) {
        reject(new Error("Claude plugin command output exceeded its limit"));
      } else if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`Claude plugin command exited ${code}`));
      }
    });
  });
}

/** @param {NodeJS.ProcessEnv} environment */
function commandTimeoutMs(environment) {
  const configured = environment.FAIRYTAIL_INSTALLER_COMMAND_TIMEOUT_MS;
  if (configured === undefined) return DEFAULT_CLAUDE_TIMEOUT_MS;
  if (!/^[0-9]{2,6}$/u.test(configured)) {
    throw new TypeError("Fairytail installer timeout is invalid");
  }
  const value = Number(configured);
  if (value < 50 || value > MAX_CLAUDE_TIMEOUT_MS) {
    throw new TypeError("Fairytail installer timeout is out of bounds");
  }
  return value;
}

/** @param {string} configDir */
async function hasInstallerState(configDir) {
  const root = join(configDir, INSTALLER_ROOT_NAME);
  try {
    const info = await lstat(root);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new Error("Fairytail local installer root is invalid");
    }
    return (await readdir(root)).length > 0;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return false;
    throw error;
  }
}

/** @param {unknown} stdout @param {string} pluginIdentifier */
function pluginListContainsExactId(stdout, pluginIdentifier) {
  return claudeListContainsExactField(
    stdout,
    "Claude plugin list",
    "id",
    pluginIdentifier,
  );
}

/** @param {unknown} stdout @param {string} marketplaceName */
function marketplaceListContainsExactName(stdout, marketplaceName) {
  return claudeListContainsExactField(
    stdout,
    "Claude marketplace list",
    "name",
    marketplaceName,
  );
}

/** @param {unknown} stdout @param {string} label @param {string} field @param {string} expected */
function claudeListContainsExactField(stdout, label, field, expected) {
  if (
    typeof stdout !== "string" ||
    Buffer.byteLength(stdout, "utf8") > MAX_CLAUDE_OUTPUT_BYTES
  ) {
    throw new Error(`${label} output is invalid`);
  }
  const listing = parseJsonDocument(Buffer.from(stdout, "utf8"), label);
  if (!Array.isArray(listing)) {
    throw new Error(`${label} output is invalid`);
  }
  return listing.some((entry) => isRecord(entry) && entry[field] === expected);
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
function localExecutable(value, label) {
  if (
    typeof value === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/u.test(value)
  ) {
    return value;
  }
  return localAbsolutePath(value, label);
}

/** @param {unknown} value */
function scope(value) {
  if (typeof value !== "string" || !SCOPES.has(value)) {
    throw new TypeError("installer scope is invalid");
  }
  return /** @type {"user" | "project" | "local"} */ (value);
}

/** @param {unknown} value */
function hostVersion(value) {
  if (
    value !== null &&
    (typeof value !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9.+_-]{0,63}$/u.test(value))
  ) {
    throw new TypeError("hostVersion is invalid");
  }
  return /** @type {string | null} */ (value);
}

/** @param {string} path */
async function exists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return false;
    throw error;
  }
}

/** @param {unknown} error */
function isNodeError(error) {
  return error instanceof Error && "code" in error;
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
