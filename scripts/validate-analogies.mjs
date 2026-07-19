#!/usr/bin/env node

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { loadG002Bundle } from "../src/content/load.mjs";
import {
  loadAnalogyAssets,
  validateAnalogyAssets,
} from "../src/analogy/catalog.mjs";
import { validateG002Bundle } from "../src/content/validate.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

try {
  const bundle = await loadG002Bundle(root);
  validateG002Bundle(bundle);
  const result = validateAnalogyAssets(
    bundle,
    await loadAnalogyAssets(root),
    new Date(),
  );
  process.stdout.write(
    `${JSON.stringify(
      {
        status: result.status,
        selectionMode: result.selectionMode,
        contentVersion: result.contentVersion,
        contractVersion: result.contractVersion,
        catalogVersion: result.catalogVersion,
        mappingCount: result.mappingCount,
        worldCount: result.worldCount,
        candidateRegistryHash: result.candidateRegistryHash,
        mappingCatalogHash: result.mappingCatalogHash,
      },
      null,
      2,
    )}\n`,
  );
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown error";
  process.stderr.write(
    `${JSON.stringify({ status: "fail", error: message }, null, 2)}\n`,
  );
  process.exitCode = 1;
}
