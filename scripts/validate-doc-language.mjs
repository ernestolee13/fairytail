#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const koreanReadme = "README.ko.md";
const koreanLocale = "content/locales/ko/presentation.json";
const hangul = /\p{Script=Hangul}/u;
const ignoredDirectories = new Set([
  ".git",
  ".omx",
  "coverage",
  "dist",
  "node_modules",
]);

const markdownFiles = await markdownUnder(root);
const canonicalFiles = markdownFiles.filter((path) => path !== koreanReadme);
const violations = [];

for (const path of canonicalFiles) {
  if (hangul.test(path)) {
    violations.push(`${path}: filename contains Hangul`);
  }
  const source = await readFile(join(root, path), "utf8");
  const lines = source.split(/\r?\n/u);
  for (const [index, line] of lines.entries()) {
    if (hangul.test(line)) {
      violations.push(`${path}:${index + 1}: ${line.trim()}`);
    }
  }
}

const [readmeKo, localeKo] = await Promise.all([
  readFile(join(root, koreanReadme), "utf8"),
  readFile(join(root, koreanLocale), "utf8"),
]);
if (!hangul.test(readmeKo)) {
  violations.push(`${koreanReadme}: expected Korean companion content`);
}
if (!hangul.test(localeKo)) {
  violations.push(`${koreanLocale}: expected Korean runtime localization`);
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
        canonical_markdown_files: canonicalFiles.length,
        english_canonical_docs: true,
        korean_companion_readme: koreanReadme,
        korean_runtime_locale: koreanLocale,
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
