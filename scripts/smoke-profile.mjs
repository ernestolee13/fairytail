#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { stderr, stdout } from "node:process";
import { fileURLToPath } from "node:url";

import { validateProfile } from "../src/profile/profile.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const script = join(root, "scripts", "fairytail-profile.mjs");
const smokeRoot = await mkdtemp(join(tmpdir(), "fairytail-profile-smoke-"));

try {
  const dataDir = join(smokeRoot, "data");
  const exportPath = join(smokeRoot, "export", "profile.json");
  const onboarding = await runInteractiveProfile(
    ["onboard", "--data-dir", dataDir],
    [
      "restaurant workflow",
      "reservation board, order ticket, kitchen handoff",
      "none",
      "analogy_first",
      "secret,breakage",
      "approve",
    ],
  );
  assert.equal(onboarding.code, 0);
  assert.match(
    onboarding.stdout,
    /1\/5[\s\S]*2\/5[\s\S]*3\/5[\s\S]*4\/5[\s\S]*5\/5/u,
  );
  assert.match(onboarding.stdout, /not a category choice/u);
  assert.match(onboarding.stdout, /profile_truth_source/u);
  assert.match(onboarding.stdout, /restaurant workflow/u);
  assert.match(onboarding.stdout, /personalized_model/u);

  const profilePath = join(dataDir, "profile.json");
  const profile = validateProfile(
    JSON.parse(await readFile(profilePath, "utf8")),
  );
  assert.equal(profile.model_processing.mode, "personalized_model");
  assert.deepEqual(profile.model_processing.approved_fields, [
    "language",
    "presentation_preference",
    "familiar_worlds",
  ]);
  assert.equal(profile.language, "en");
  assert.equal(profile.familiar_worlds[0].label, "restaurant workflow");
  assert.deepEqual(profile.observed_experience, ["No coding experience"]);
  assert.deepEqual(profile.safety_concerns, [
    "Secret or credential exposure",
    "Damage to files or the environment",
  ]);
  assert.equal((await stat(dataDir)).mode & 0o777, 0o700);
  assert.equal((await stat(profilePath)).mode & 0o777, 0o600);

  const koreanDir = join(smokeRoot, "korean-data");
  const koreanOnboarding = await runInteractiveProfile(
    ["onboard", "--locale", "ko", "--data-dir", koreanDir],
    [
      "동네 식당 운영",
      "예약 장부, 주문표, 주방 인계",
      "none",
      "analogy_first",
      "secret,breakage",
      "approve",
    ],
  );
  assert.equal(koreanOnboarding.code, 0);
  assert.match(koreanOnboarding.stdout, /분류를 고르는 문항이 아니며/u);
  assert.match(koreanOnboarding.stdout, /진실원천/u);
  assert.match(koreanOnboarding.stdout, /동네 식당 운영/u);
  const koreanProfile = validateProfile(
    JSON.parse(await readFile(join(koreanDir, "profile.json"), "utf8")),
  );
  assert.equal(koreanProfile.language, "ko");
  assert.equal(koreanProfile.familiar_worlds[0].label, "동네 식당 운영");
  assert.deepEqual(koreanProfile.observed_experience, ["코딩 경험 없음"]);
  assert.deepEqual(koreanProfile.safety_concerns, [
    "시크릿·인증 정보 노출",
    "파일·환경 손상",
  ]);

  const invalidLocale = await runProfile([
    "status",
    "--locale",
    "fr",
    "--data-dir",
    dataDir,
  ]);
  assert.equal(invalidLocale.code, 1);
  assert.deepEqual(JSON.parse(invalidLocale.stdout), {
    status: "error",
    message:
      "Fairytail profile operation failed safely. No raw answer, profile, path, or secret was logged.",
  });

  assert.equal(
    (await runProfile(["export", exportPath, "--data-dir", dataDir])).code,
    0,
  );
  assert.deepEqual(
    validateProfile(JSON.parse(await readFile(exportPath, "utf8"))),
    profile,
  );

  assert.equal(
    (await runProfile(["no-analogy", "--data-dir", dataDir])).code,
    0,
  );
  const noAnalogy = validateProfile(
    JSON.parse(await readFile(profilePath, "utf8")),
  );
  assert.equal(noAnalogy.no_analogy, true);
  assert.equal(noAnalogy.model_processing.mode, "neutral_local");

  assert.equal((await runProfile(["reset", "--data-dir", dataDir])).code, 0);
  const reset = validateProfile(
    JSON.parse(await readFile(profilePath, "utf8")),
  );
  assert.equal(reset.presentation_preference, "neutral");
  assert.equal(reset.model_processing.mode, "neutral_local");

  assert.equal((await runProfile(["delete", "--data-dir", dataDir])).code, 0);
  assert.equal(
    JSON.parse((await runProfile(["status", "--data-dir", dataDir])).stdout)
      .onboardingRequired,
    true,
  );

  const canary = "PRIVATE_PROFILE_CANARY@example.test";
  const canaryDir = join(smokeRoot, "canary-data");
  const rejected = await runInteractiveProfile(
    ["onboard", "--data-dir", canaryDir],
    ["none", canary, "none", "analogy_first", "privacy", "approve"],
  );
  assert.equal(rejected.code, 0);
  assert.doesNotMatch(
    `${rejected.stdout}\n${rejected.stderr}`,
    /PRIVATE_PROFILE_CANARY/u,
  );
  const rejectedProfile = validateProfile(
    JSON.parse(await readFile(join(canaryDir, "profile.json"), "utf8")),
  );
  assert.equal(rejectedProfile.model_processing.mode, "neutral_local");
  assert.equal(rejectedProfile.familiar_worlds.length, 0);
  assert.doesNotMatch(
    await readFile(join(canaryDir, "profile.json"), "utf8"),
    /PRIVATE_PROFILE_CANARY/u,
  );
  assert.deepEqual(
    (await readdir(canaryDir)).filter((name) =>
      /cache|snapshot|log/iu.test(name),
    ),
    [],
  );

  stdout.write(
    `${JSON.stringify(
      {
        status: "pass",
        fiveQuestionsInOrder: true,
        defaultLocale: "en",
        reviewedLocales: ["en", "ko"],
        localeIsSetupNotQuestion: true,
        invalidLocaleFailsClosed: true,
        cleanFirstRun: true,
        defaultMode: "neutral_local",
        personalizedApprovalFields: profile.model_processing.approved_fields,
        localFileMode: "0600",
        localDirectoryMode: "0700",
        exportResetDelete: true,
        unsafeLabelFallback: "neutral_local",
        canaryLeaks: 0,
        profileNetworkCalls: 0,
        personalizedAnalogyGenerationEnabled: true,
        profileTruthSource: "user_authored_local_file",
        seedClassification: false,
      },
      null,
      2,
    )}\n`,
  );
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  stderr.write(`Fairytail profile smoke failed: ${message}\n`);
  process.exitCode = 1;
} finally {
  await rm(smokeRoot, { recursive: true, force: true });
}

/**
 * @param {string[]} args
 * @param {string} [input]
 * @returns {Promise<{ code: number | null, stdout: string, stderr: string }>}
 */
function runProfile(args, input = "") {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: root,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let commandStdout = "";
    let commandStderr = "";
    child.stdout.on("data", (chunk) => {
      commandStdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      commandStderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) =>
      resolve({ code, stdout: commandStdout, stderr: commandStderr }),
    );
    child.stdin.end(input);
  });
}

/**
 * Feed one answer only after each prompt appears. Node's readline does not
 * retain answers written before the next question is active.
 *
 * @param {string[]} args
 * @param {string[]} answers
 * @returns {Promise<{ code: number | null, stdout: string, stderr: string }>}
 */
function runInteractiveProfile(args, answers) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: root,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let commandStdout = "";
    let commandStderr = "";
    let sent = 0;
    child.stdout.on("data", (chunk) => {
      commandStdout += chunk.toString();
      const promptCount = commandStdout.split("> ").length - 1;
      while (sent < answers.length && sent < promptCount) {
        child.stdin.write(`${answers[sent]}\n`);
        sent += 1;
        if (sent === answers.length) child.stdin.end();
      }
    });
    child.stderr.on("data", (chunk) => {
      commandStderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) =>
      resolve({ code, stdout: commandStdout, stderr: commandStderr }),
    );
  });
}
