import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  analyzeWorkspaceDiff,
  applyWorkspaceOverlay,
  createIsolatedGitWorkspace,
} from "../src/benchmark/diff.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const fixture = resolve(root, "benchmarks", "g010", "fixtures", "safe-path");

test("diff scorer separates source/test files and measures direct dependency delta", async (context) => {
  const artifacts = await mkdtemp(resolve(tmpdir(), "g010-diff-test-"));
  context.after(() => rm(artifacts, { recursive: true, force: true }));
  const workspace = await createIsolatedGitWorkspace(resolve(fixture, "base"), {
    artifactRoot: artifacts,
  });
  await applyWorkspaceOverlay(resolve(fixture, "arms", "baseline"), workspace);
  const diff = await analyzeWorkspaceDiff(workspace);

  assert.equal(diff.source.file_count.value, 2);
  assert.ok(Number(diff.source.added_loc.value) > 0);
  assert.equal(diff.test.file_count.value, 0);
  assert.deepEqual(diff.dependencies.runtime_added.value, ["path-is-inside"]);
  assert.deepEqual(diff.dependencies.runtime_removed.value, []);
  assert.equal(diff.lock_file_count.value, 0);
  assert.match(diff.patch.sha256, /^[a-f0-9]{64}$/u);
});

test("minimal arms have no direct dependency change", async (context) => {
  const artifacts = await mkdtemp(resolve(tmpdir(), "g010-diff-minimal-"));
  context.after(() => rm(artifacts, { recursive: true, force: true }));
  const workspace = await createIsolatedGitWorkspace(resolve(fixture, "base"), {
    artifactRoot: artifacts,
  });
  await applyWorkspaceOverlay(resolve(fixture, "arms", "ponytail"), workspace);
  const diff = await analyzeWorkspaceDiff(workspace);
  assert.equal(diff.source.file_count.value, 1);
  assert.deepEqual(diff.dependencies.runtime_added.value, []);
});
