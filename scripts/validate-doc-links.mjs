#!/usr/bin/env node

import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const ignoredDirectories = new Set([
  ".git",
  ".omx",
  "coverage",
  "dist",
  "node_modules",
]);
const markdownFiles = await markdownUnder(root);
const violations = [];
let localLinks = 0;

for (const path of markdownFiles) {
  const source = await readFile(join(root, path), "utf8");
  if (source.includes("[[")) {
    violations.push(`${path}: Obsidian wikilinks are not GitHub-renderable`);
  }
  for (const match of source.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/gu)) {
    const rawTarget = match[1].trim();
    const target =
      rawTarget.startsWith("<") && rawTarget.endsWith(">")
        ? rawTarget.slice(1, -1)
        : rawTarget.split(/\s+["']/u, 1)[0];
    if (
      target === "" ||
      target.startsWith("#") ||
      /^(?:https?:|mailto:|data:)/u.test(target)
    ) {
      continue;
    }
    localLinks += 1;
    let decoded;
    try {
      decoded = decodeURIComponent(target.split("#", 1)[0]);
    } catch {
      violations.push(`${path}: invalid encoded link ${rawTarget}`);
      continue;
    }
    const destination = target.startsWith("/")
      ? resolve(root, `.${decoded}`)
      : resolve(root, dirname(path), decoded);
    if (!destination.startsWith(`${root}/`) && destination !== root) {
      violations.push(`${path}: link escapes repository: ${rawTarget}`);
      continue;
    }
    try {
      await stat(destination);
    } catch {
      violations.push(`${path}: missing local link target: ${rawTarget}`);
    }
  }
}

if (violations.length > 0) {
  process.stderr.write(
    `${JSON.stringify({ status: "fail", violations }, null, 2)}\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write(
    `${JSON.stringify(
      {
        status: "pass",
        markdown_files: markdownFiles.length,
        local_links_checked: localLinks,
        github_markdown_links_only: true,
      },
      null,
      2,
    )}\n`,
  );
}

/** @param {string} directory @returns {Promise<string[]>} */
async function markdownUnder(directory) {
  /** @type {string[]} */
  const results = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (ignoredDirectories.has(entry.name)) continue;
      results.push(...(await markdownUnder(join(directory, entry.name))));
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    results.push(relative(root, join(directory, entry.name)));
  }
  return results.sort();
}
