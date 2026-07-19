#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { stderr, stdout } from "node:process";
import { fileURLToPath } from "node:url";

import {
  verifyPublishableSuite,
  verifyRunSuite,
  verifyStaticBenchmarkAssets,
} from "../src/benchmark/verify.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

try {
  const args = process.argv.slice(2);
  const publishableIndex = args.indexOf("--publishable");
  const artifactIndex = args.indexOf("--artifact");
  let result;
  if (publishableIndex >= 0) {
    const path = args[publishableIndex + 1];
    if (!path) throw new TypeError("--publishable requires a path");
    const artifact = JSON.parse(await readFile(resolve(path), "utf8"));
    await verifyPublishableSuite(artifact, resolve(path));
    result = { status: "pass", publishable: true, artifact: resolve(path) };
  } else if (artifactIndex >= 0) {
    const path = args[artifactIndex + 1];
    if (!path) throw new TypeError("--artifact requires a path");
    const artifact = JSON.parse(await readFile(resolve(path), "utf8"));
    verifyRunSuite(artifact, false);
    result = { status: "pass", publishable: false, artifact: resolve(path) };
  } else if (args.length === 0) {
    result = await verifyStaticBenchmarkAssets(root);
  } else {
    throw new TypeError(`Unknown arguments: ${args.join(" ")}`);
  }
  stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  stderr.write(
    `G010 benchmark verification failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
