#!/usr/bin/env node

import { appendFile, chmod, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { stdout } from "node:process";

const args = process.argv.slice(2);
const index = args.indexOf("--data-dir");
const dataDir = index >= 0 ? args[index + 1] : undefined;

if (typeof dataDir === "string" && dataDir.length > 0) {
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  await chmod(dataDir, 0o700);
  const path = join(dataDir, "superpowers-session-start.jsonl");
  await appendFile(
    path,
    `${JSON.stringify({ schemaVersion: 1, event: "SessionStart" })}\n`,
    { mode: 0o600 },
  );
  await chmod(path, 0o600);
}

stdout.write(
  `${JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext:
        "The active Superpowers fixture retains workflow orchestration. Fairytail may add explanation only.",
    },
  })}\n`,
);
