import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";

import { invalidMetric, metric, unavailableMetric } from "./contracts.mjs";

const SOURCE_EXTENSIONS = new Set([
  ".c",
  ".cc",
  ".cpp",
  ".cs",
  ".css",
  ".go",
  ".html",
  ".java",
  ".js",
  ".jsx",
  ".kt",
  ".mjs",
  ".php",
  ".py",
  ".rb",
  ".rs",
  ".swift",
  ".ts",
  ".tsx",
  ".vue",
]);

const LOCK_NAMES = new Set([
  "bun.lock",
  "bun.lockb",
  "composer.lock",
  "Cargo.lock",
  "Gemfile.lock",
  "package-lock.json",
  "pnpm-lock.yaml",
  "poetry.lock",
  "yarn.lock",
]);

/**
 * Create a fresh Git workspace from a fixture. When artifactRoot is supplied,
 * the temporary directory lives below it and is intentionally preserved.
 *
 * @param {string} baseDirectory
 * @param {{artifactRoot?: string, prefix?: string}} [options]
 */
export async function createIsolatedGitWorkspace(baseDirectory, options = {}) {
  const parent = options.artifactRoot ?? tmpdir();
  await mkdir(parent, { recursive: true });
  const workspace = await mkdtemp(
    join(parent, options.prefix ?? "g010-workspace-"),
  );
  await copyDirectoryContents(baseDirectory, workspace);
  await runCommand("git", ["init", "--quiet"], workspace);
  await runCommand(
    "git",
    ["config", "user.name", "Fairytail benchmark"],
    workspace,
  );
  await runCommand(
    "git",
    ["config", "user.email", "benchmark@fairytail.invalid"],
    workspace,
  );
  await runCommand("git", ["add", "--all"], workspace);
  await runCommand(
    "git",
    ["commit", "--quiet", "-m", "Pin benchmark fixture"],
    workspace,
  );
  return workspace;
}

/**
 * @param {string} overlayDirectory
 * @param {string} workspace
 */
export async function applyWorkspaceOverlay(overlayDirectory, workspace) {
  await copyDirectoryContents(overlayDirectory, workspace);
}

/**
 * Analyze the working-tree delta against the pinned fixture commit. Untracked
 * files are included through intent-to-add, without staging their content.
 *
 * @param {string} workspace
 */
export async function analyzeWorkspaceDiff(workspace) {
  await runCommand("git", ["add", "--intent-to-add", "--all"], workspace);
  const numstat = await runCommand(
    "git",
    ["diff", "--numstat", "--no-renames", "HEAD", "--", "."],
    workspace,
  );
  const patch = await runCommand(
    "git",
    ["diff", "--binary", "--no-renames", "HEAD", "--", "."],
    workspace,
  );

  /** @type {{path: string, added: number|null, deleted: number|null, category: "source"|"test"|"other"}[]} */
  const files = [];
  for (const line of numstat.stdout.split(/\r?\n/u)) {
    if (!line) continue;
    const [addedText, deletedText, ...pathParts] = line.split("\t");
    const path = pathParts.join("\t");
    if (!path) continue;
    files.push({
      path,
      added: addedText === "-" ? null : Number(addedText),
      deleted: deletedText === "-" ? null : Number(deletedText),
      category: classifyPath(path),
    });
  }

  const sourceFiles = files.filter((file) => file.category === "source");
  const testFiles = files.filter((file) => file.category === "test");
  const lockFiles = files.filter((file) => LOCK_NAMES.has(basename(file.path)));
  const dependencies = await analyzePackageDependencyDelta(workspace);

  return {
    source: summarizeFileGroup(sourceFiles, "git-diff:numstat:source"),
    test: summarizeFileGroup(testFiles, "git-diff:numstat:test"),
    changed_file_count: metric(files.length, "measured", "git-diff:numstat"),
    lock_file_count: metric(
      lockFiles.length,
      "measured",
      "git-diff:numstat:recognized-lockfiles",
    ),
    dependencies,
    files,
    patch: {
      sha256: createHash("sha256").update(patch.stdout).digest("hex"),
      text: patch.stdout,
    },
  };
}

/**
 * @param {{path: string, added: number|null, deleted: number|null}[]} files
 * @param {string} source
 */
function summarizeFileGroup(files, source) {
  const binary = files.filter(
    (file) => file.added === null || file.deleted === null,
  );
  return {
    file_count: metric(files.length, "measured", source),
    added_loc:
      binary.length === 0
        ? metric(
            files.reduce((sum, file) => sum + Number(file.added), 0),
            "measured",
            source,
          )
        : invalidMetric(
            source,
            `Binary files prevent LOC measurement: ${binary.map((file) => file.path).join(", ")}`,
          ),
    deleted_loc:
      binary.length === 0
        ? metric(
            files.reduce((sum, file) => sum + Number(file.deleted), 0),
            "measured",
            source,
          )
        : invalidMetric(
            source,
            `Binary files prevent LOC measurement: ${binary.map((file) => file.path).join(", ")}`,
          ),
  };
}

/** @param {string} path */
function classifyPath(path) {
  const normalized = path.replaceAll("\\", "/");
  if (
    normalized.startsWith("test/") ||
    normalized.startsWith("tests/") ||
    normalized.includes("/__tests__/") ||
    /(?:^|\.)test\.[^.]+$/u.test(basename(normalized)) ||
    /(?:^|\.)spec\.[^.]+$/u.test(basename(normalized))
  ) {
    return "test";
  }
  if (
    normalized.includes("/node_modules/") ||
    normalized.startsWith("node_modules/") ||
    normalized.startsWith("dist/") ||
    normalized.startsWith("coverage/") ||
    normalized.includes(".generated.")
  ) {
    return "other";
  }
  return SOURCE_EXTENSIONS.has(extname(normalized).toLowerCase())
    ? "source"
    : "other";
}

/** @param {string} workspace */
async function analyzePackageDependencyDelta(workspace) {
  const source = "package-json:HEAD-vs-working-tree";
  let before;
  let after;
  try {
    const baseline = await runCommand(
      "git",
      ["show", "HEAD:package.json"],
      workspace,
    );
    before = JSON.parse(baseline.stdout);
    after = JSON.parse(await readFile(join(workspace, "package.json"), "utf8"));
  } catch (error) {
    const reason = `Direct dependency delta unavailable: ${error instanceof Error ? error.message : String(error)}`;
    return {
      runtime_added: unavailableMetric(source, reason),
      runtime_removed: unavailableMetric(source, reason),
      dev_added: unavailableMetric(source, reason),
      dev_removed: unavailableMetric(source, reason),
    };
  }

  const runtimeBefore = dependencyNames(before, [
    "dependencies",
    "optionalDependencies",
    "peerDependencies",
  ]);
  const runtimeAfter = dependencyNames(after, [
    "dependencies",
    "optionalDependencies",
    "peerDependencies",
  ]);
  const devBefore = dependencyNames(before, ["devDependencies"]);
  const devAfter = dependencyNames(after, ["devDependencies"]);

  return {
    runtime_added: metric(
      difference(runtimeAfter, runtimeBefore),
      "measured",
      source,
    ),
    runtime_removed: metric(
      difference(runtimeBefore, runtimeAfter),
      "measured",
      source,
    ),
    dev_added: metric(difference(devAfter, devBefore), "measured", source),
    dev_removed: metric(difference(devBefore, devAfter), "measured", source),
  };
}

/**
 * @param {unknown} packageJson
 * @param {string[]} sections
 */
function dependencyNames(packageJson, sections) {
  const names = new Set();
  if (typeof packageJson !== "object" || packageJson === null) return names;
  for (const section of sections) {
    const dependencies = /** @type {Record<string, unknown>} */ (packageJson)[
      section
    ];
    if (
      typeof dependencies !== "object" ||
      dependencies === null ||
      Array.isArray(dependencies)
    )
      continue;
    Object.keys(dependencies).forEach((name) => names.add(name));
  }
  return names;
}

/**
 * @param {Set<string>} left
 * @param {Set<string>} right
 */
function difference(left, right) {
  return [...left].filter((item) => !right.has(item)).sort();
}

/**
 * @param {string} source
 * @param {string} destination
 */
async function copyDirectoryContents(source, destination) {
  for (const entry of await readdir(source, { withFileTypes: true })) {
    await cp(join(source, entry.name), join(destination, entry.name), {
      recursive: entry.isDirectory(),
      force: true,
    });
  }
}

/**
 * @param {string} command
 * @param {string[]} args
 * @param {string} cwd
 */
export function runCommand(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0) {
        resolve({ stdout, stderr, code, signal });
        return;
      }
      reject(
        new Error(
          `${command} ${args.join(" ")} failed (${code ?? signal}): ${stderr || stdout}`,
        ),
      );
    });
  });
}
