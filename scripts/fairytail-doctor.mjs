#!/usr/bin/env node

import { stdout } from "node:process";
import { diagnosticReport } from "../src/doctor.mjs";
import { resolveFairytailDataDir } from "../src/profile/data-dir.mjs";
import { loadProfile } from "../src/profile/store.mjs";

try {
  const options = parseArguments(process.argv.slice(2));
  const dataDir = resolveFairytailDataDir(options);
  const loaded = await loadProfile(dataDir ?? undefined);
  const report = diagnosticReport({
    dataDirAvailable: dataDir !== null,
    host: options.host ?? "unknown",
    profile: {
      source: loaded.source,
      onboardingRequired: loaded.needsOnboarding,
      processingMode: loaded.profile.model_processing.mode,
      noAnalogy: loaded.profile.no_analogy,
      approvedFields: loaded.profile.model_processing.approved_fields,
    },
  });

  stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} catch {
  stdout.write(
    `${JSON.stringify({ status: "error", code: "doctor-failed-safely" })}\n`,
  );
  process.exitCode = 1;
}

/** @param {string[]} args */
function parseArguments(args) {
  /** @type {{ dataDir?: string, host?: "claude" | "codex" }} */
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new TypeError("Fairytail doctor option is incomplete");
    }
    if (option === "--data-dir" && options.dataDir === undefined) {
      options.dataDir = value;
    } else if (
      option === "--host" &&
      options.host === undefined &&
      (value === "claude" || value === "codex")
    ) {
      options.host = value;
    } else {
      throw new TypeError("Fairytail doctor option is invalid or duplicated");
    }
  }
  return options;
}
