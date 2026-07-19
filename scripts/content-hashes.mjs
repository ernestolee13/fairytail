#!/usr/bin/env node

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readJsonDocument } from "../src/content/load.mjs";
import {
  canonicalFactHash,
  canonicalFactSetHash,
} from "../src/content/stable-json.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const concepts =
  /** @type {{ content_version: string, cards: Record<string, unknown>[] }} */ (
    await readJsonDocument(join(root, "content", "v1", "concepts.json"))
  );
const scenarios = /** @type {{ scenarios: Record<string, unknown>[] }} */ (
  await readJsonDocument(
    join(root, "fixtures", "golden", "v1", "scenarios.json"),
  )
);
const conceptById = new Map(
  concepts.cards.map((card) => [String(card.id), card]),
);

const canonicalHashes = Object.fromEntries(
  concepts.cards.map((card) => [String(card.id), canonicalFactHash(card)]),
);
const scenarioFactHashes = Object.fromEntries(
  scenarios.scenarios.map((scenario) => {
    const scenarioId = String(scenario.scenario_id);
    const conceptIds = /** @type {string[]} */ (scenario.concept_ids);
    const cards = conceptIds.map((conceptId) => {
      const card = conceptById.get(conceptId);
      if (!card)
        throw new Error(`Unknown concept ${conceptId} in ${scenarioId}`);
      return card;
    });
    return [scenarioId, canonicalFactSetHash(cards, concepts.content_version)];
  }),
);

process.stdout.write(
  `${JSON.stringify(
    {
      contentVersion: concepts.content_version,
      canonicalHashes,
      scenarioFactHashes,
    },
    null,
    2,
  )}\n`,
);
