#!/usr/bin/env node

import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

import { clearPersonalizationState } from "../src/analogy/engine.mjs";
import {
  completeOnboarding,
  onboardingCopy,
} from "../src/profile/onboarding.mjs";
import {
  PERSONALIZED_ANALOGY_GENERATION_ENABLED,
  transmissionPreview,
} from "../src/profile/privacy.mjs";
import { resolveFairytailDataDir } from "../src/profile/data-dir.mjs";
import { localOnlyProfile } from "../src/profile/profile.mjs";
import {
  deleteProfile,
  exportProfile,
  loadProfile,
  resetProfile,
  saveProfile,
} from "../src/profile/store.mjs";

const args = process.argv.slice(2);
const command = args[0] ?? "status";

try {
  const locale = readLocale(args);
  const host = readHost(args);
  const dataDir = resolveFairytailDataDir({
    dataDir: readOption(args, "--data-dir"),
    host,
  });
  const copy = onboardingCopy(locale);
  if (!dataDir) throw new Error("Fairytail data directory is unavailable");
  if (command === "status") await showStatus(dataDir, copy);
  else if (command === "onboard" || command === "edit") {
    await runOnboarding(dataDir, locale);
  } else if (command === "preview") await showPreview(dataDir, copy);
  else if (command === "neutral") await setLocalMode(dataDir, false);
  else if (command === "no-analogy") await setLocalMode(dataDir, true);
  else if (command === "reset") await runReset(dataDir);
  else if (command === "delete") await runDelete(dataDir);
  else if (command === "export") await runExport(dataDir, args[1]);
  else throw new Error("Unsupported Fairytail profile command");
} catch {
  stdout.write(
    `${JSON.stringify({
      status: "error",
      message:
        "Fairytail profile operation failed safely. No raw answer, profile, path, or secret was logged.",
    })}\n`,
  );
  process.exitCode = 1;
}

/**
 * @param {string} directory
 * @param {ReturnType<typeof onboardingCopy>} copy
 */
async function showStatus(directory, copy) {
  const loaded = await loadProfile(directory);
  stdout.write(
    `${JSON.stringify({
      status: "ok",
      onboardingRequired: loaded.needsOnboarding,
      profileSource: loaded.source,
      processingMode: loaded.profile.model_processing.mode,
      noAnalogy: loaded.profile.no_analogy,
      approvedFields: loaded.profile.model_processing.approved_fields,
      personalizedGenerationEnabled: PERSONALIZED_ANALOGY_GENERATION_ENABLED,
      disclosure: copy.disclosure,
    })}\n`,
  );
}

/** @param {string} directory @param {"en" | "ko"} locale */
async function runOnboarding(directory, locale) {
  const copy = onboardingCopy(locale);
  const terminal = createInterface({ input: stdin, output: stdout });
  try {
    stdout.write(`${copy.disclosure}\n\n`);
    while (true) {
      const background = await terminal.question(
        `${copy.questions[0].prompt}\n${copy.ui.commaSeparated}\n> `,
      );
      const labels = await terminal.question(
        `${copy.questions[1].prompt}\n${copy.ui.commaSeparated}\n> `,
      );
      const experience = await terminal.question(
        `${copy.questions[2].prompt}\n${copy.ui.options}: ${renderOptions(copy.experienceOptions)}\n> `,
      );
      const preference = await terminal.question(
        `${copy.questions[3].prompt}\n${copy.ui.options}: ${renderOptions(copy.presentationOptions)}\n> `,
      );
      const concerns = await terminal.question(
        `${copy.questions[4].prompt}\n${copy.ui.options}: ${renderOptions(copy.safetyOptions)}\n> `,
      );

      const answers = {
        familiar_contexts: noneAsEmpty(commaList(background)),
        familiar_anchors: noneAsEmpty(commaList(labels)),
        coding_actions: commaList(experience),
        presentation_preference: preference.trim(),
        safety_concerns: commaList(concerns),
        language: locale,
      };
      const pending = completeOnboarding(answers, "neutral");
      renderLocalPreview(pending.profile, copy);
      renderTransmissionPreview(pending.preview, copy);
      const decision = (
        await terminal.question(`\n${copy.ui.decision}\n> `)
      ).trim();
      if (decision === "edit") continue;
      if (!["approve", "neutral", "no-analogy", "later"].includes(decision)) {
        throw new Error("Unsupported onboarding decision");
      }
      const completed = completeOnboarding(
        answers,
        /** @type {"approve" | "neutral" | "no-analogy" | "later"} */ (
          decision
        ),
      );
      await saveProfile(directory, completed.profile);
      await clearPersonalizationState(directory);
      stdout.write(
        `\n${copy.ui.saved}: ${completed.profile.model_processing.mode}, ${copy.ui.noAnalogy}=${completed.profile.no_analogy}\n`,
      );
      if (completed.privacyFallback) {
        stdout.write(`${copy.ui.privacyFallback}\n`);
      }
      if (completed.approved) {
        stdout.write(`${copy.ui.approval}\n`);
      }
      return;
    }
  } finally {
    terminal.close();
  }
}

/**
 * @param {string} directory
 * @param {ReturnType<typeof onboardingCopy>} copy
 */
async function showPreview(directory, copy) {
  const loaded = await loadProfile(directory);
  if (loaded.source !== "stored") throw new Error("Profile unavailable");
  renderLocalPreview(loaded.profile, copy);
  renderTransmissionPreview(
    transmissionPreview(
      loaded.profile,
      loaded.profile.model_processing.approved_fields.length > 0
        ? loaded.profile.model_processing.approved_fields
        : undefined,
    ),
    copy,
  );
}

/** @param {string} directory @param {boolean} noAnalogy */
async function setLocalMode(directory, noAnalogy) {
  const loaded = await loadProfile(directory);
  const profile = localOnlyProfile(loaded.profile, new Date(), {
    noAnalogy,
    presentation: noAnalogy
      ? "neutral"
      : loaded.profile.presentation_preference,
  });
  await saveProfile(directory, profile);
  await clearPersonalizationState(directory);
  stdout.write(
    `${JSON.stringify({ status: "ok", mode: "neutral_local", noAnalogy })}\n`,
  );
}

/** @param {string} directory */
async function runReset(directory) {
  await resetProfile(directory);
  await clearPersonalizationState(directory);
  stdout.write(
    `${JSON.stringify({
      status: "ok",
      reset: true,
      processingMode: "neutral_local",
      approvedFields: [],
    })}\n`,
  );
}

/** @param {string} directory */
async function runDelete(directory) {
  const result = await deleteProfile(directory);
  await clearPersonalizationState(directory);
  stdout.write(
    `${JSON.stringify({ status: "ok", deleted: result.deleted })}\n`,
  );
}

/** @param {string} directory @param {string | undefined} destination */
async function runExport(directory, destination) {
  if (!destination || destination.startsWith("--")) {
    throw new Error("Export destination is required");
  }
  await exportProfile(directory, destination);
  stdout.write(`${JSON.stringify({ status: "ok", exported: true })}\n`);
}

/**
 * @param {import("../src/profile/profile.mjs").LearnerProfile} profile
 * @param {ReturnType<typeof onboardingCopy>} copy
 */
function renderLocalPreview(profile, copy) {
  stdout.write(`\n${copy.ui.localPreview}\n`);
  stdout.write(
    `${JSON.stringify({
      language: profile.language,
      familiar_worlds: profile.familiar_worlds,
      profile_truth_source: "user_authored_local_file",
      observed_experience: profile.observed_experience,
      presentation_preference: profile.presentation_preference,
      safety_concerns: profile.safety_concerns,
      no_analogy: profile.no_analogy,
    })}\n`,
  );
}

/**
 * @param {ReturnType<typeof transmissionPreview>} preview
 * @param {ReturnType<typeof onboardingCopy>} copy
 */
function renderTransmissionPreview(preview, copy) {
  stdout.write(`${copy.ui.transmissionPreview}\n`);
  if (preview.status === "ready") {
    stdout.write(
      `${JSON.stringify({
        destination: preview.destination,
        purpose: preview.purpose,
        fields: preview.fields,
        projection: preview.projection,
      })}\n`,
    );
  } else {
    stdout.write(
      `${JSON.stringify({
        destination: preview.destination,
        purpose: preview.purpose,
        fields: [],
        fallback: "neutral_local",
      })}\n`,
    );
  }
}

/** @param {string} value */
function commaList(value) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

/** @param {string[]} values */
function noneAsEmpty(values) {
  return values.length === 1 && ["none", "없음"].includes(values[0])
    ? []
    : values;
}

/** @param {Readonly<Record<string, string>>} options */
function renderOptions(options) {
  return Object.entries(options)
    .map(([key, label]) => `${key} (${label})`)
    .join(", ");
}

/** @param {string[]} values @returns {"en" | "ko"} */
function readLocale(values) {
  const value = readOption(values, "--locale") ?? "en";
  if (value !== "en" && value !== "ko") {
    throw new Error("Unsupported locale option");
  }
  return value;
}

/** @param {string[]} values @returns {"claude" | "codex" | undefined} */
function readHost(values) {
  const value = readOption(values, "--host");
  if (value === undefined) return undefined;
  if (value !== "claude" && value !== "codex") {
    throw new Error("Unsupported host option");
  }
  return value;
}

/** @param {string[]} values @param {string} name */
function readOption(values, name) {
  const indexes = values.flatMap((value, index) =>
    value === name ? [index] : [],
  );
  if (indexes.length > 1) throw new Error(`Duplicate ${name} option`);
  if (indexes.length === 0) return undefined;
  const value = values[indexes[0] + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing ${name} option value`);
  }
  return value;
}
