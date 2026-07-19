import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

test("plugin manifest and supported surfaces have the minimal expected shape", async () => {
  const manifest = JSON.parse(
    await readFile(join(root, ".claude-plugin", "plugin.json"), "utf8"),
  );
  const hooks = JSON.parse(
    await readFile(join(root, "hooks", "hooks.json"), "utf8"),
  );
  const repositoryMarketplace = JSON.parse(
    await readFile(join(root, ".claude-plugin", "marketplace.json"), "utf8"),
  );
  const codexManifest = JSON.parse(
    await readFile(join(root, ".codex-plugin", "plugin.json"), "utf8"),
  );
  const codexMarketplace = JSON.parse(
    await readFile(
      join(root, ".agents", "plugins", "marketplace.json"),
      "utf8",
    ),
  );
  const smokeMarketplace = JSON.parse(
    await readFile(
      join(
        root,
        "fixtures",
        "marketplace",
        ".claude-plugin",
        "marketplace.json",
      ),
      "utf8",
    ),
  );

  assert.equal(manifest.name, "fairytail");
  assert.equal(manifest.version, "0.1.6");
  assert.equal(manifest.defaultEnabled, false);
  assert.deepEqual(Object.keys(hooks.hooks), [
    "SessionStart",
    "PreToolUse",
    "PostToolUse",
    "PostToolUseFailure",
  ]);
  for (const [eventName, event] of Object.entries(hooks.hooks)) {
    assert.equal(event[0].hooks[0].command, "node");
    assert.deepEqual(event[0].hooks[0].args, [
      "${CLAUDE_PLUGIN_ROOT}/scripts/fairytail-hook.mjs",
      "--expected-event",
      eventName,
      "--data-dir",
      "${CLAUDE_PLUGIN_DATA}",
    ]);
  }
  assert.equal(
    hooks.hooks.PreToolUse[0].matcher,
    "^(Bash|Write|Edit|MultiEdit|NotebookEdit|mcp__.*)$",
  );
  const safetyMatcher = new RegExp(hooks.hooks.PreToolUse[0].matcher, "u");
  for (const tool of [
    "Bash",
    "Write",
    "Edit",
    "NotebookEdit",
    "mcp__db__write",
  ]) {
    assert.equal(safetyMatcher.test(tool), true, tool);
  }
  for (const tool of ["Read", "Glob", "Grep", "WebSearch", "Agent"]) {
    assert.equal(safetyMatcher.test(tool), false, tool);
  }
  assert.equal(hooks.hooks.PostToolUse[0].matcher, "Bash");
  assert.equal(
    hooks.hooks.PostToolUseFailure[0].matcher,
    hooks.hooks.PreToolUse[0].matcher,
  );
  assert.equal(repositoryMarketplace.name, "fairytail");
  assert.equal(repositoryMarketplace.owner.name, "Fairytail");
  assert.equal(repositoryMarketplace.plugins.length, 1);
  assert.deepEqual(repositoryMarketplace.plugins[0], {
    name: manifest.name,
    source: "./",
    description:
      "Minimal implementation guidance plus locally personalized beginner explanations.",
  });
  assert.equal(
    Object.hasOwn(repositoryMarketplace.plugins[0], "version"),
    false,
    "plugin.json must remain the single version source",
  );
  assert.equal(codexManifest.name, manifest.name);
  assert.equal(codexManifest.version, manifest.version);
  assert.equal(codexManifest.license, manifest.license);
  assert.equal(codexManifest.skills, "./skills/");
  assert.equal(codexManifest.interface.displayName, "Fairytail");
  assert.equal(codexMarketplace.name, "fairytail");
  assert.equal(codexMarketplace.plugins.length, 1);
  assert.deepEqual(codexMarketplace.plugins[0], {
    name: "fairytail",
    source: {
      source: "local",
      path: "./",
    },
    policy: {
      installation: "AVAILABLE",
      authentication: "ON_INSTALL",
    },
    category: "Productivity",
  });
  assert.equal(smokeMarketplace.name, "fairytail-smoke");
  assert.equal(smokeMarketplace.plugins[0].source, "./plugins/fairytail");

  await Promise.all([
    access(join(root, "skills", "doctor", "SKILL.md")),
    access(join(root, "skills", "build", "SKILL.md")),
    access(join(root, "skills", "fairytail-explain-concept", "SKILL.md")),
    access(join(root, "skills", "onboard", "SKILL.md")),
    access(join(root, "skills", "onboard", "agents", "openai.yaml")),
    access(join(root, "skills", "personalize", "SKILL.md")),
    access(join(root, "skills", "profile", "SKILL.md")),
    access(join(root, "skills", "profile", "agents", "openai.yaml")),
    access(join(root, "skills", "doctor", "agents", "openai.yaml")),
    access(join(root, "skills", "before", "SKILL.md")),
    access(join(root, "skills", "error", "SKILL.md")),
    access(join(root, "skills", "finish", "SKILL.md")),
    access(join(root, "skills", "review", "SKILL.md")),
    access(join(root, "skills", "safety", "SKILL.md")),
    access(join(root, "agents", "fairytail-explainer.md")),
    access(join(root, "agents", "fairytail-analogy-mapper.md")),
    access(join(root, "output-styles", "fairytail-friendly.md")),
    access(join(root, "scripts", "fairytail-hook.mjs")),
    access(join(root, "scripts", "fairytail-profile.mjs")),
    access(join(root, "scripts", "fairytail-personalize.mjs")),
    access(join(root, "scripts", "generate-terminal-evidence.mjs")),
    access(join(root, "scripts", "fairytail-g005.mjs")),
    access(join(root, "scripts", "fairytail-safety.mjs")),
    access(join(root, "scripts", "fairytail-install.mjs")),
    access(join(root, "scripts", "smoke-g007.mjs")),
    access(join(root, "scripts", "smoke-codex.mjs")),
    access(join(root, "scripts", "smoke-codex-beginner.mjs")),
    access(join(root, "src", "profile", "data-dir.mjs")),
    access(join(root, "schemas", "v1", "profile-projection.schema.json")),
    access(join(root, "schemas", "v1", "personalization-request.schema.json")),
    access(
      join(root, "schemas", "v1", "personalized-analogy-candidate.schema.json"),
    ),
    access(join(root, "schemas", "v1", "build-decision-packet.schema.json")),
    access(join(root, "schemas", "v1", "learning-packet.schema.json")),
    access(join(root, "schemas", "v1", "explanation-patch.schema.json")),
    access(join(root, "schemas", "v1", "benchmark-run.schema.json")),
    access(join(root, "schemas", "v1", "g005-observation.schema.json")),
    access(join(root, "schemas", "v1", "verification-evidence.schema.json")),
    access(join(root, "schemas", "v1", "safety-action.schema.json")),
    access(join(root, "schemas", "v1", "safety-decision.schema.json")),
    access(join(root, "schemas", "v1", "integration-snapshot.schema.json")),
    access(join(root, "examples", "tiny-library", "expected-failure.mjs")),
    access(join(root, "docs", "BEGINNER_EXAMPLES.md")),
    access(join(root, "docs", "assets", "fairytail-hero.png")),
    access(join(root, "docs", "assets", "evidence", "terminal-evidence.json")),
    access(join(root, "THIRD_PARTY_NOTICES.md")),
    access(join(root, "LICENSES", "ponytail-MIT.txt")),
  ]);
});
