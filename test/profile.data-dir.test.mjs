import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import { resolveFairytailDataDir } from "../src/profile/data-dir.mjs";

test("Codex receives one stable private Fairytail directory", () => {
  assert.equal(
    resolveFairytailDataDir({
      host: "codex",
      environment: { CODEX_HOME: "/tmp/codex-home" },
      userHome: "/tmp/user-home",
    }),
    resolve("/tmp/codex-home/fairytail"),
  );
  assert.equal(
    resolveFairytailDataDir({
      host: "codex",
      environment: {},
      userHome: "/tmp/user-home",
    }),
    resolve("/tmp/user-home/.codex/fairytail"),
  );
});

test("explicit and compatibility paths take precedence without host guessing", () => {
  assert.equal(
    resolveFairytailDataDir({
      dataDir: "/tmp/explicit",
      host: "codex",
      environment: {
        FAIRYTAIL_DATA_DIR: "/tmp/fairytail-env",
        CLAUDE_PLUGIN_DATA: "/tmp/claude-data",
        CODEX_HOME: "/tmp/codex-home",
      },
    }),
    resolve("/tmp/explicit"),
  );
  assert.equal(
    resolveFairytailDataDir({
      environment: { CLAUDE_PLUGIN_DATA: "/tmp/claude-data" },
    }),
    resolve("/tmp/claude-data"),
  );
  assert.equal(resolveFairytailDataDir({ environment: {} }), null);
});

test("remote, empty, and ambiguous data paths fail closed", () => {
  for (const dataDir of ["", " https://example.test/data", "file:/tmp/data"]) {
    assert.throws(() => resolveFairytailDataDir({ dataDir, environment: {} }));
  }
});
