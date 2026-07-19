import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  INSTALLER_ROOT_NAME,
  installLocalFairytail,
  planLocalInstall,
  uninstallLocalFairytail,
} from "../src/integration/installer.mjs";

const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const claudeBin = "claude";
const currentVersion = JSON.parse(
  await readFile(join(pluginRoot, ".claude-plugin", "plugin.json"), "utf8"),
).version;
const currentVersionId = currentVersion
  .replace(/[^A-Za-z0-9]+/gu, "-")
  .toLowerCase();
const currentMarketplaceName = `fairytail-local-${currentVersionId}`;
const currentPluginIdentifier = `fairytail@${currentMarketplaceName}`;

test("installer stages only Fairytail-owned files and preserves every harness marker", async (context) => {
  const temporary = await mkdtemp(join(tmpdir(), "fairytail-installer-test-"));
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const configDir = join(temporary, "config");
  const workspaceRoot = join(temporary, "workspace");
  await createHarnessFixture(configDir, workspaceRoot);
  const protectedFiles = protectedPaths(workspaceRoot);
  const before = await hashes(protectedFiles);
  /** @type {{ binary: string, args: string[], cwd: string }[]} */
  const calls = [];
  let pluginPresent = false;
  let marketplacePresent = false;
  const plan = await planLocalInstall(
    installOptions(configDir, workspaceRoot, true),
  );
  assert.equal(plan.status, "ready");
  assert.equal(plan.integration.mode, "additive_explanation_only");
  assert.deepEqual(plan.integration.active_orchestrators_preserved, [
    "omo",
    "omx",
    "superpowers",
  ]);
  assert.equal(plan.overwrites_existing_files, false);
  assert.equal(plan.network_required, false);

  /** @type {(binary: string, args: string[], options: { cwd: string, env: NodeJS.ProcessEnv }) => Promise<{ stdout: string, stderr: string }>} */
  const runner = async (binary, args, options) => {
    calls.push({ binary, args: [...args], cwd: options.cwd });
    const operation = args.slice(0, 3).join(" ");
    if (operation === "plugin marketplace add") marketplacePresent = true;
    if (operation === `plugin install ${currentPluginIdentifier}`) {
      pluginPresent = true;
    }
    if (operation === `plugin uninstall ${currentPluginIdentifier}`) {
      pluginPresent = false;
    }
    if (operation === "plugin marketplace remove") {
      assert.deepEqual(args.slice(-2), ["--scope", "user"]);
      marketplacePresent = false;
    }
    return {
      stdout:
        operation === "plugin list --json"
          ? JSON.stringify(
              pluginPresent ? [{ id: currentPluginIdentifier }] : [],
            )
          : operation === "plugin marketplace list"
            ? JSON.stringify(
                marketplacePresent ? [{ name: currentMarketplaceName }] : [],
              )
            : "",
      stderr: "",
    };
  };
  const installed = await installLocalFairytail(
    installOptions(configDir, workspaceRoot, true),
    { runner },
  );
  assert.equal(installed.status, "installed");
  assert.equal(installed.enabled, true);
  assert.equal(installed.other_harness_files_changed, 0);
  assert.equal(installed.network_calls, 0);

  const stageRoot = currentStageRoot(configDir);
  assert.equal((await stat(stageRoot)).mode & 0o777, 0o700);
  assert.equal(
    JSON.parse(await readFile(join(stageRoot, "install-marker.json"), "utf8"))
      .owner,
    "fairytail",
  );
  const stagedMarketplace = JSON.parse(
    await readFile(
      join(stageRoot, "marketplace", ".claude-plugin", "marketplace.json"),
      "utf8",
    ),
  );
  assert.equal(
    Object.hasOwn(stagedMarketplace.plugins[0], "version"),
    false,
    "plugin.json must remain the single version source",
  );
  await stat(
    join(
      stageRoot,
      "marketplace",
      "plugins",
      "fairytail",
      ".claude-plugin",
      "plugin.json",
    ),
  );
  await stat(join(stageRoot, "marketplace", "plugins", "fairytail", "LICENSE"));
  await stat(
    join(stageRoot, "marketplace", "plugins", "fairytail", "PRIVACY.md"),
  );
  await stat(
    join(stageRoot, "marketplace", "plugins", "fairytail", "README.ko.md"),
  );
  await assert.rejects(
    stat(
      join(stageRoot, "marketplace", "plugins", "fairytail", "node_modules"),
    ),
  );
  await assert.rejects(
    stat(
      join(
        stageRoot,
        "marketplace",
        "plugins",
        "fairytail",
        "benchmarks",
        "g010",
        "results",
        "measured",
      ),
    ),
  );
  await assert.rejects(
    stat(join(stageRoot, "marketplace", "plugins", "fairytail", "test")),
  );
  await assert.rejects(
    stat(join(stageRoot, "marketplace", "plugins", "fairytail", "pilot")),
  );
  await assert.rejects(
    stat(join(stageRoot, "marketplace", "plugins", "fairytail", "benchmarks")),
  );
  await assert.rejects(
    stat(
      join(
        stageRoot,
        "marketplace",
        "plugins",
        "fairytail",
        "scripts",
        "smoke-g007.mjs",
      ),
    ),
  );
  await stat(
    join(
      stageRoot,
      "marketplace",
      "plugins",
      "fairytail",
      "scripts",
      "fairytail-hook.mjs",
    ),
  );
  await stat(
    join(
      stageRoot,
      "marketplace",
      "plugins",
      "fairytail",
      "scripts",
      "fairytail-personalize.mjs",
    ),
  );
  await stat(
    join(
      stageRoot,
      "marketplace",
      "plugins",
      "fairytail",
      "docs",
      "PUBLIC_INSTALL_AND_SAMPLES.md",
    ),
  );
  assert.deepEqual(await hashes(protectedFiles), before);
  assert.doesNotMatch(
    JSON.stringify(calls),
    /AGENTS\.md|CLAUDE\.md|\.omx|\.omo|opencode\.json/u,
  );

  const uninstalled = await uninstallLocalFairytail(
    uninstallOptions(configDir, workspaceRoot, false),
    { runner },
  );
  assert.equal(uninstalled.status, "uninstalled");
  assert.equal(uninstalled.data_preserved, false);
  await assert.rejects(stat(stageRoot));
  assert.deepEqual(await hashes(protectedFiles), before);
});

test("installer rollback removes only its marker-verified staging root", async (context) => {
  const temporary = await mkdtemp(join(tmpdir(), "fairytail-installer-fail-"));
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const configDir = join(temporary, "config");
  const workspaceRoot = join(temporary, "workspace");
  await createHarnessFixture(configDir, workspaceRoot);
  const before = await hashes(protectedPaths(workspaceRoot));
  let calls = 0;
  let marketplacePresent = false;
  /** @type {(binary: string, args: string[], options: { cwd: string, env: NodeJS.ProcessEnv }) => Promise<{ stdout: string, stderr: string }>} */
  const runner = async (_binary, args) => {
    calls += 1;
    const operation = args.slice(0, 3).join(" ");
    if (operation === "plugin marketplace add") marketplacePresent = true;
    if (args[1] === "install") throw new Error("synthetic install failure");
    if (operation === "plugin marketplace remove") {
      assert.deepEqual(args.slice(-2), ["--scope", "user"]);
      marketplacePresent = false;
    }
    return {
      stdout:
        operation === "plugin list --json"
          ? "[]"
          : operation === "plugin marketplace list"
            ? JSON.stringify(
                marketplacePresent ? [{ name: currentMarketplaceName }] : [],
              )
            : "",
      stderr: "",
    };
  };
  await assert.rejects(
    installLocalFairytail(installOptions(configDir, workspaceRoot, true), {
      runner,
    }),
    (error) => {
      assert.ok(!(error instanceof AggregateError));
      assert.ok(error instanceof Error);
      assert.match(error.message, /synthetic install failure/u);
      return true;
    },
  );
  assert.ok(calls >= 3);
  await assert.rejects(stat(currentStageRoot(configDir)));
  assert.deepEqual(await hashes(protectedPaths(workspaceRoot)), before);
});

test("rollback treats a marketplace failure before mutation as clean absence", async (context) => {
  const temporary = await mkdtemp(
    join(tmpdir(), "fairytail-installer-marketplace-no-mutation-"),
  );
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const configDir = join(temporary, "config");
  const workspaceRoot = join(temporary, "workspace");
  await createHarnessFixture(configDir, workspaceRoot);
  /** @type {string[]} */
  const calls = [];

  await assert.rejects(
    installLocalFairytail(installOptions(configDir, workspaceRoot, false), {
      runner: async (_binary, args) => {
        const operation = args.slice(0, 3).join(" ");
        calls.push(operation);
        if (operation === "plugin marketplace add") {
          throw new Error("marketplace add failed before mutation");
        }
        return {
          stdout: operation === "plugin marketplace list" ? "[]" : "",
          stderr: "",
        };
      },
    }),
    (error) => {
      assert.ok(!(error instanceof AggregateError));
      assert.ok(error instanceof Error);
      assert.match(error.message, /failed before mutation/u);
      return true;
    },
  );

  assert.deepEqual(calls, [
    "plugin marketplace add",
    "plugin marketplace list",
  ]);
  await assert.rejects(stat(currentStageRoot(configDir)));
});

test("rollback reverses a marketplace mutation reported as a failed command", async (context) => {
  const temporary = await mkdtemp(
    join(tmpdir(), "fairytail-installer-marketplace-attempt-"),
  );
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const configDir = join(temporary, "config");
  const workspaceRoot = join(temporary, "workspace");
  await createHarnessFixture(configDir, workspaceRoot);
  let marketplacePresent = false;
  /** @type {string[]} */
  const calls = [];

  await assert.rejects(
    installLocalFairytail(installOptions(configDir, workspaceRoot, true), {
      runner: async (_binary, args) => {
        const operation = args.slice(0, 3).join(" ");
        calls.push(operation);
        if (operation === "plugin marketplace add") {
          marketplacePresent = true;
          throw new Error("host mutated then reported marketplace failure");
        }
        if (operation === "plugin marketplace remove") {
          marketplacePresent = false;
        }
        return {
          stdout:
            operation === "plugin marketplace list"
              ? JSON.stringify(
                  marketplacePresent ? [{ name: currentMarketplaceName }] : [],
                )
              : "",
          stderr: "",
        };
      },
    }),
  );

  assert.equal(marketplacePresent, false);
  assert.deepEqual(calls, [
    "plugin marketplace add",
    "plugin marketplace list",
    "plugin marketplace remove",
    "plugin marketplace list",
  ]);
  await assert.rejects(stat(currentStageRoot(configDir)));
});

test("rollback reverses a plugin mutation reported as a failed command", async (context) => {
  const temporary = await mkdtemp(
    join(tmpdir(), "fairytail-installer-plugin-attempt-"),
  );
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const configDir = join(temporary, "config");
  const workspaceRoot = join(temporary, "workspace");
  await createHarnessFixture(configDir, workspaceRoot);
  let marketplacePresent = false;
  let pluginPresent = false;
  /** @type {string[]} */
  const calls = [];

  await assert.rejects(
    installLocalFairytail(installOptions(configDir, workspaceRoot, true), {
      runner: async (_binary, args) => {
        const operation = args.slice(0, 3).join(" ");
        calls.push(operation);
        if (operation === "plugin marketplace add") {
          marketplacePresent = true;
        } else if (operation === `plugin install ${currentPluginIdentifier}`) {
          pluginPresent = true;
          throw new Error("host mutated then reported plugin failure");
        } else if (
          operation === `plugin uninstall ${currentPluginIdentifier}`
        ) {
          pluginPresent = false;
        } else if (operation === "plugin marketplace remove") {
          marketplacePresent = false;
        }
        return {
          stdout:
            operation === "plugin list --json"
              ? JSON.stringify(
                  pluginPresent ? [{ id: currentPluginIdentifier }] : [],
                )
              : operation === "plugin marketplace list"
                ? JSON.stringify(
                    marketplacePresent
                      ? [{ name: currentMarketplaceName }]
                      : [],
                  )
                : "",
          stderr: "",
        };
      },
    }),
  );

  assert.equal(pluginPresent, false);
  assert.equal(marketplacePresent, false);
  assert.deepEqual(calls, [
    "plugin marketplace add",
    `plugin install ${currentPluginIdentifier}`,
    "plugin list --json",
    `plugin uninstall ${currentPluginIdentifier}`,
    "plugin list --json",
    "plugin marketplace list",
    "plugin marketplace remove",
    "plugin marketplace list",
  ]);
  await assert.rejects(stat(currentStageRoot(configDir)));
});

test("rollback reports cleanup failures without leaving the owned stage", async (context) => {
  const temporary = await mkdtemp(
    join(tmpdir(), "fairytail-installer-rollback-evidence-"),
  );
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const configDir = join(temporary, "config");
  const workspaceRoot = join(temporary, "workspace");
  await createHarnessFixture(configDir, workspaceRoot);
  /** @type {(binary: string, args: string[], options: { cwd: string, env: NodeJS.ProcessEnv }) => Promise<{ stdout: string, stderr: string }>} */
  const runner = async (_binary, args) => {
    if (args[1] === "enable") throw new Error("synthetic primary failure");
    if (args[1] === "uninstall") {
      throw new Error("synthetic plugin cleanup failure");
    }
    if (args[1] === "marketplace" && args[2] === "remove") {
      throw new Error("synthetic marketplace cleanup failure");
    }
    return {
      stdout:
        args[1] === "marketplace" && args[2] === "list"
          ? JSON.stringify([{ name: currentMarketplaceName }])
          : JSON.stringify([{ id: currentPluginIdentifier }]),
      stderr: "",
    };
  };

  await assert.rejects(
    installLocalFairytail(installOptions(configDir, workspaceRoot, true), {
      runner,
    }),
    (error) => {
      assert.ok(error instanceof AggregateError);
      assert.equal(error.errors.length, 3);
      return true;
    },
  );
  await assert.rejects(stat(currentStageRoot(configDir)));
});

test("installer rejects package symlinks and removes its partial stage", async (context) => {
  const temporary = await mkdtemp(
    join(tmpdir(), "fairytail-installer-symlink-"),
  );
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const configDir = join(temporary, "config");
  const workspaceRoot = join(temporary, "workspace");
  const sourceRoot = join(temporary, "source");
  const outsideTarget = join(temporary, "outside-canary.txt");
  await createHarnessFixture(configDir, workspaceRoot);
  await mkdir(join(sourceRoot, ".claude-plugin"), { recursive: true });
  await writeFile(
    join(sourceRoot, ".claude-plugin", "plugin.json"),
    await readFile(join(pluginRoot, ".claude-plugin", "plugin.json")),
  );
  await writeFile(outsideTarget, "outside package boundary\n");
  await symlink(outsideTarget, join(sourceRoot, "README.md"));
  let runnerCalls = 0;

  await assert.rejects(
    installLocalFairytail(
      installOptions(configDir, workspaceRoot, true, sourceRoot),
      {
        runner: async (_binary, args) => {
          runnerCalls += 1;
          return {
            stdout:
              args[1] === "list"
                ? JSON.stringify([{ id: currentPluginIdentifier }])
                : "",
            stderr: "",
          };
        },
      },
    ),
    /symbolic link/u,
  );
  assert.equal(runnerCalls, 0);
  assert.equal(
    await readFile(outsideTarget, "utf8"),
    "outside package boundary\n",
  );
  await assert.rejects(stat(currentStageRoot(configDir)));
});

test("existing installer destination and duplicate adapters refuse overwrite", async (context) => {
  const temporary = await mkdtemp(join(tmpdir(), "fairytail-installer-block-"));
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const configDir = join(temporary, "config");
  const workspaceRoot = join(temporary, "workspace");
  await createHarnessFixture(configDir, workspaceRoot);
  await mkdir(currentStageRoot(configDir), {
    recursive: true,
  });
  await assert.rejects(
    installLocalFairytail(installOptions(configDir, workspaceRoot, true), {
      runner: async () => ({ stdout: "", stderr: "" }),
    }),
  );

  await writeFile(
    join(workspaceRoot, "opencode.json"),
    `${JSON.stringify({
      plugin: [
        "oh-my-openagent",
        "fairytail-native",
        "fairytail@claude-import",
      ],
    })}\n`,
  );
  const blocked = await planLocalInstall(
    installOptions(configDir, workspaceRoot, true),
  );
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.integration.reason_code, "FTI-DUPLICATE-ADAPTER");
});

test("a second version is blocked before host mutation and the installed version remains uninstallable", async (context) => {
  const temporary = await mkdtemp(
    join(tmpdir(), "fairytail-installer-version-"),
  );
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const configDir = join(temporary, "config");
  const workspaceRoot = join(temporary, "workspace");
  const nextSource = join(temporary, "next-source");
  await createHarnessFixture(configDir, workspaceRoot);
  await createMinimalPluginSource(nextSource, "0.2.0");
  let hostCalls = 0;
  let pluginPresent = false;
  let marketplacePresent = false;
  /** @type {(binary: string, args: string[]) => Promise<{ stdout: string, stderr: string }>} */
  const runner = async (_binary, args) => {
    hostCalls += 1;
    const operation = args.slice(0, 3).join(" ");
    if (operation === "plugin marketplace add") marketplacePresent = true;
    if (args[1] === "install") pluginPresent = true;
    if (args[1] === "uninstall") pluginPresent = false;
    if (operation === "plugin marketplace remove") {
      marketplacePresent = false;
    }
    return {
      stdout:
        operation === "plugin list --json"
          ? JSON.stringify(
              pluginPresent ? [{ id: currentPluginIdentifier }] : [],
            )
          : operation === "plugin marketplace list"
            ? JSON.stringify(
                marketplacePresent ? [{ name: currentMarketplaceName }] : [],
              )
            : "",
      stderr: "",
    };
  };

  await installLocalFairytail(installOptions(configDir, workspaceRoot, false), {
    runner,
  });
  const callsAfterFirstInstall = hostCalls;
  const nextOptions = installOptions(
    configDir,
    workspaceRoot,
    false,
    nextSource,
  );
  assert.equal((await planLocalInstall(nextOptions)).status, "blocked");
  await assert.rejects(
    installLocalFairytail(nextOptions, { runner }),
    /plan is blocked/u,
  );
  assert.equal(hostCalls, callsAfterFirstInstall);
  await uninstallLocalFairytail(
    uninstallOptions(configDir, workspaceRoot, false),
    { runner },
  );
  await assert.rejects(stat(currentStageRoot(configDir)));
  await assert.rejects(stat(join(configDir, INSTALLER_ROOT_NAME, "0-2-0")));
});

test("concurrent versions cannot both claim the Fairytail installer root", async (context) => {
  const temporary = await mkdtemp(
    join(tmpdir(), "fairytail-installer-concurrent-"),
  );
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const configDir = join(temporary, "config");
  const workspaceRoot = join(temporary, "workspace");
  const firstSource = join(temporary, "source-0-1-1");
  const secondSource = join(temporary, "source-0-2-0");
  await createHarnessFixture(configDir, workspaceRoot);
  await createMinimalPluginSource(firstSource, "0.1.1");
  await createMinimalPluginSource(secondSource, "0.2.0");
  let installedIdentifier = "";
  let pluginPresent = false;
  let marketplacePresent = false;
  /** @type {(binary: string, args: string[]) => Promise<{ stdout: string, stderr: string }>} */
  const runner = async (_binary, args) => {
    const operation = args.slice(0, 3).join(" ");
    if (operation === "plugin marketplace add") marketplacePresent = true;
    if (args[1] === "install") {
      installedIdentifier = args[2];
      pluginPresent = true;
    }
    if (args[1] === "uninstall") pluginPresent = false;
    if (operation === "plugin marketplace remove") {
      marketplacePresent = false;
    }
    return {
      stdout:
        operation === "plugin list --json"
          ? JSON.stringify(pluginPresent ? [{ id: installedIdentifier }] : [])
          : operation === "plugin marketplace list"
            ? JSON.stringify(
                marketplacePresent
                  ? [{ name: installedIdentifier.split("@")[1] }]
                  : [],
              )
            : "",
      stderr: "",
    };
  };

  const results = await Promise.allSettled([
    installLocalFairytail(
      installOptions(configDir, workspaceRoot, false, firstSource),
      { runner },
    ),
    installLocalFairytail(
      installOptions(configDir, workspaceRoot, false, secondSource),
      { runner },
    ),
  ]);
  assert.deepEqual(results.map((result) => result.status).sort(), [
    "fulfilled",
    "rejected",
  ]);
  assert.equal((await readdir(join(configDir, INSTALLER_ROOT_NAME))).length, 1);
  await uninstallLocalFairytail(
    uninstallOptions(configDir, workspaceRoot, false),
    { runner },
  );
  assert.deepEqual(await readdir(join(configDir, INSTALLER_ROOT_NAME)), []);
});

test("uninstall resumes after plugin removal succeeds and marketplace removal fails", async (context) => {
  const temporary = await mkdtemp(
    join(tmpdir(), "fairytail-installer-uninstall-retry-"),
  );
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const configDir = join(temporary, "config");
  const workspaceRoot = join(temporary, "workspace");
  await createHarnessFixture(configDir, workspaceRoot);
  const pluginIdentifier = currentPluginIdentifier;
  const marketplaceName = currentMarketplaceName;
  let pluginPresent = false;
  let marketplacePresent = false;
  let failMarketplaceRemoval = true;
  /** @type {string[]} */
  const calls = [];
  /** @type {(binary: string, args: string[]) => Promise<{ stdout: string, stderr: string }>} */
  const runner = async (_binary, args) => {
    const operation = args.slice(0, 3).join(" ");
    calls.push(operation);
    if (operation === "plugin marketplace add") marketplacePresent = true;
    if (operation === `plugin install ${pluginIdentifier}`) {
      pluginPresent = true;
    }
    if (operation === `plugin uninstall ${pluginIdentifier}`) {
      if (!pluginPresent) throw new Error("plugin is already absent");
      pluginPresent = false;
    }
    if (operation === "plugin marketplace remove") {
      if (failMarketplaceRemoval) {
        failMarketplaceRemoval = false;
        throw new Error("synthetic marketplace removal failure");
      }
      marketplacePresent = false;
    }
    if (operation === "plugin list --json") {
      return {
        stdout: JSON.stringify(pluginPresent ? [{ id: pluginIdentifier }] : []),
        stderr: "",
      };
    }
    if (operation === "plugin marketplace list") {
      return {
        stdout: JSON.stringify(
          marketplacePresent ? [{ name: marketplaceName }] : [],
        ),
        stderr: "",
      };
    }
    return { stdout: "", stderr: "" };
  };

  await installLocalFairytail(installOptions(configDir, workspaceRoot, false), {
    runner,
  });
  const stageRoot = currentStageRoot(configDir);
  await assert.rejects(
    uninstallLocalFairytail(uninstallOptions(configDir, workspaceRoot, false), {
      runner,
    }),
    /could not confirm all host removals/u,
  );
  assert.equal(pluginPresent, false);
  assert.equal(marketplacePresent, true);
  await stat(stageRoot);

  const result = await uninstallLocalFairytail(
    uninstallOptions(configDir, workspaceRoot, false),
    { runner },
  );
  assert.equal(result.status, "uninstalled");
  assert.equal(pluginPresent, false);
  assert.equal(marketplacePresent, false);
  assert.ok(calls.includes("plugin list --json"));
  assert.ok(calls.includes("plugin marketplace list"));
  await assert.rejects(stat(stageRoot));
});

test("plugin verification requires an exact JSON identifier", async (context) => {
  const temporary = await mkdtemp(join(tmpdir(), "fairytail-installer-id-"));
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const configDir = join(temporary, "config");
  const workspaceRoot = join(temporary, "workspace");
  await createHarnessFixture(configDir, workspaceRoot);
  /** @type {string[]} */
  const calls = [];
  let pluginPresent = false;
  let marketplacePresent = false;
  let pluginListCalls = 0;

  await assert.rejects(
    installLocalFairytail(installOptions(configDir, workspaceRoot, false), {
      runner: async (_binary, args) => {
        const operation = args.slice(0, 3).join(" ");
        calls.push(operation);
        if (operation === "plugin marketplace add") marketplacePresent = true;
        if (operation === `plugin install ${currentPluginIdentifier}`) {
          pluginPresent = true;
        }
        if (operation === `plugin uninstall ${currentPluginIdentifier}`) {
          pluginPresent = false;
        }
        if (operation === "plugin marketplace remove") {
          marketplacePresent = false;
        }
        if (operation === "plugin list --json") pluginListCalls += 1;
        return {
          stdout:
            operation === "plugin list --json"
              ? JSON.stringify(
                  pluginListCalls === 1
                    ? [{ id: `${currentPluginIdentifier}-evil` }]
                    : pluginPresent
                      ? [{ id: currentPluginIdentifier }]
                      : [],
                )
              : operation === "plugin marketplace list"
                ? JSON.stringify(
                    marketplacePresent
                      ? [{ name: currentMarketplaceName }]
                      : [],
                  )
                : "",
          stderr: "",
        };
      },
    }),
    /did not confirm/u,
  );
  assert.ok(calls.includes("plugin list --json"));
  assert.ok(calls.includes("plugin marketplace list"));
  assert.ok(calls.includes(`plugin uninstall ${currentPluginIdentifier}`));
  assert.ok(calls.includes("plugin marketplace remove"));
  await assert.rejects(stat(currentStageRoot(configDir)));
});

/** @param {string} configDir */
function currentStageRoot(configDir) {
  return join(configDir, INSTALLER_ROOT_NAME, currentVersionId);
}

/** @param {string} sourceRoot @param {string} version */
async function createMinimalPluginSource(sourceRoot, version) {
  await mkdir(join(sourceRoot, ".claude-plugin"), { recursive: true });
  await writeFile(
    join(sourceRoot, ".claude-plugin", "plugin.json"),
    `${JSON.stringify({ name: "fairytail", version })}\n`,
  );
  await writeFile(join(sourceRoot, "README.md"), "Fairytail test package\n");
}

/** @param {string} configDir @param {string} workspaceRoot @param {boolean} enable @param {string} [sourceRoot] */
function installOptions(configDir, workspaceRoot, enable, sourceRoot) {
  return {
    pluginRoot: sourceRoot ?? pluginRoot,
    configDir,
    workspaceRoot,
    claudeBin,
    scope: "user",
    enable,
    hostVersion: "2.1.214",
  };
}

/** @param {string} configDir @param {string} workspaceRoot @param {boolean} keepData */
function uninstallOptions(configDir, workspaceRoot, keepData) {
  return {
    configDir,
    workspaceRoot,
    claudeBin,
    scope: "user",
    keepData,
    hostVersion: "2.1.214",
  };
}

/** @param {string} configDir @param {string} workspaceRoot */
async function createHarnessFixture(configDir, workspaceRoot) {
  await mkdir(join(workspaceRoot, ".omx"), { recursive: true });
  await mkdir(join(workspaceRoot, ".omo"), { recursive: true });
  await mkdir(configDir, { recursive: true });
  await writeFile(
    join(configDir, "settings.json"),
    `${JSON.stringify({ enabledPlugins: { "superpowers@official": true } })}\n`,
  );
  await writeFile(
    join(workspaceRoot, "AGENTS.md"),
    "<!-- OMX:RUNTIME:START -->\nprotected OMX guidance\n",
  );
  await writeFile(
    join(workspaceRoot, "CLAUDE.md"),
    "protected host guidance\n",
  );
  await writeFile(
    join(workspaceRoot, ".omx", "state.json"),
    '{"owner":"omx"}\n',
  );
  await writeFile(
    join(workspaceRoot, ".omo", "state.json"),
    '{"owner":"omo"}\n',
  );
  await writeFile(
    join(workspaceRoot, "opencode.json"),
    `${JSON.stringify({ plugin: ["oh-my-openagent"] })}\n`,
  );
}

/** @param {string} workspaceRoot */
function protectedPaths(workspaceRoot) {
  return [
    join(workspaceRoot, "AGENTS.md"),
    join(workspaceRoot, "CLAUDE.md"),
    join(workspaceRoot, ".omx", "state.json"),
    join(workspaceRoot, ".omo", "state.json"),
    join(workspaceRoot, "opencode.json"),
  ];
}

/** @param {string[]} paths */
async function hashes(paths) {
  return Promise.all(
    paths.map(async (path) =>
      createHash("sha256")
        .update(await readFile(path))
        .digest("hex"),
    ),
  );
}
