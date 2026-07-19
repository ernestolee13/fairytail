#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { stderr, stdout } from "node:process";
import { fileURLToPath } from "node:url";

import { validateProfile } from "../src/profile/profile.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const profileScript = join(root, "scripts", "fairytail-profile.mjs");
const doctorScript = join(root, "scripts", "fairytail-doctor.mjs");
const personalizeScript = join(root, "scripts", "fairytail-personalize.mjs");
const explainScript = join(
  root,
  "skills",
  "fairytail-explain-concept",
  "scripts",
  "explain.mjs",
);
const smokeRoot = await mkdtemp(join(tmpdir(), "fairytail-codex-beginner-"));
const codexHome = join(smokeRoot, "codex-home");
const environment = { ...process.env, CODEX_HOME: codexHome };

try {
  const initial = parseJson(
    (
      await runNode(
        profileScript,
        ["status", "--host", "codex", "--locale", "ko"],
        environment,
      )
    ).stdout,
  );
  assert.equal(initial.onboardingRequired, true);
  assert.equal(initial.processingMode, "neutral_local");

  const onboarding = await runInteractiveProfile(
    ["onboard", "--host", "codex", "--locale", "ko"],
    [
      "동네 빵집 업무",
      "주문표, 수령대, 빵 쟁반",
      "none",
      "analogy_first",
      "privacy",
      "approve",
    ],
    environment,
  );
  assert.equal(onboarding.code, 0);
  assert.match(
    onboarding.stdout,
    /1\/5[\s\S]*2\/5[\s\S]*3\/5[\s\S]*4\/5[\s\S]*5\/5/u,
  );
  assert.match(onboarding.stdout, /personalized_model/u);

  const dataDir = join(codexHome, "fairytail");
  const profilePath = join(dataDir, "profile.json");
  const profile = validateProfile(
    JSON.parse(await readFile(profilePath, "utf8")),
  );
  assert.equal(profile.language, "ko");
  assert.equal(profile.model_processing.mode, "personalized_model");
  assert.equal((await stat(dataDir)).mode & 0o777, 0o700);
  assert.equal((await stat(profilePath)).mode & 0o777, 0o600);

  const status = parseJson(
    (
      await runNode(
        profileScript,
        ["status", "--host", "codex", "--locale", "ko"],
        environment,
      )
    ).stdout,
  );
  assert.equal(status.onboardingRequired, false);
  assert.equal(status.processingMode, "personalized_model");

  const doctor = parseJson(
    (await runNode(doctorScript, ["--host", "codex"], environment)).stdout,
  );
  assert.equal(doctor.onboarding.host, "codex");
  assert.equal(doctor.onboarding.required, false);
  assert.equal(doctor.onboarding.rawAnswersIncluded, false);
  assert.equal(doctor.claims.codexLocalOnboardingReady, true);

  const pending = parseJson(
    (
      await runNode(
        explainScript,
        ["--concept", "api", "--locale", "ko", "--host", "codex", "--json"],
        environment,
      )
    ).stdout,
  );
  assert.deepEqual(pending.analogy, {
    kind: "generic",
    reason: "personalized-mapping-pending",
  });

  const prepared = parseJson(
    (
      await runNode(
        personalizeScript,
        ["prepare", "--scenario", "S04", "--host", "codex"],
        environment,
      )
    ).stdout,
  );
  assert.equal(prepared.status, "ready");
  const request = prepared.request;
  const candidatePath = join(smokeRoot, "candidate.json");
  await writeFile(
    candidatePath,
    `${JSON.stringify({
      schema_version: request.schema_version,
      request_id: request.request_id,
      source_context: "동네 빵집 업무",
      analogy_label: "동네 빵집 업무",
      role_bindings: {
        API: "동네 빵집 업무",
        endpoint: "수령대",
        request: "주문표",
        response: "빵 쟁반",
      },
    })}\n`,
    { encoding: "utf8", mode: 0o600, flag: "wx" },
  );
  await chmod(candidatePath, 0o600);
  const accepted = parseJson(
    (
      await runNode(
        personalizeScript,
        [
          "accept",
          "--scenario",
          "S04",
          "--candidate",
          candidatePath,
          "--host",
          "codex",
        ],
        environment,
      )
    ).stdout,
  );
  assert.equal(accepted.status, "ready");
  await rm(candidatePath);

  const personalized = parseJson(
    (
      await runNode(
        explainScript,
        ["--concept", "api", "--locale", "ko", "--host", "codex", "--json"],
        environment,
      )
    ).stdout,
  );
  assert.equal(personalized.analogy.kind, "mapped");
  assert.equal(personalized.analogy.reason, "validated-profile-binding");
  assert.deepEqual(personalized.effects, {
    model_calls: 0,
    network_calls: 0,
    execution_calls: 0,
  });

  stdout.write(
    `${JSON.stringify(
      {
        status: "pass",
        host: "codex",
        locale: "ko",
        journey: [
          "fresh-status",
          "five-question-local-onboarding",
          "private-profile-persistence",
          "doctor-status",
          "reviewed-generic-while-map-pending",
          "consent-bound-personalization",
          "personalized-render-reuse",
        ],
        tasksPassed: "7/7",
        localDirectoryMode: "0700",
        localProfileMode: "0600",
        rawAnswersInDoctor: false,
        explanationEffects: personalized.effects,
        automatedProxyOnly: true,
        humanComprehensionProven: false,
      },
      null,
      2,
    )}\n`,
  );
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  stderr.write(`Fairytail Codex beginner smoke failed: ${message}\n`);
  process.exitCode = 1;
} finally {
  await rm(smokeRoot, { recursive: true, force: true });
}

/** @param {string} value */
function parseJson(value) {
  return JSON.parse(value);
}

/**
 * @param {string} script
 * @param {string[]} args
 * @param {NodeJS.ProcessEnv} childEnvironment
 */
function runNode(script, args, childEnvironment) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: root,
      env: childEnvironment,
      stdio: ["ignore", "pipe", "pipe"],
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
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout: commandStdout, stderr: commandStderr });
      } else {
        reject(
          new Error(
            `${script} exited ${code}: ${commandStderr || commandStdout}`,
          ),
        );
      }
    });
  });
}

/**
 * @param {string[]} args
 * @param {string[]} answers
 * @param {NodeJS.ProcessEnv} childEnvironment
 */
function runInteractiveProfile(args, answers, childEnvironment) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [profileScript, ...args], {
      cwd: root,
      env: childEnvironment,
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
    child.on("close", (code) => {
      resolve({ code, stdout: commandStdout, stderr: commandStderr });
    });
  });
}
