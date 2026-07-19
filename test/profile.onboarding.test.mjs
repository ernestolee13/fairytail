import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  BACKGROUND_CATEGORIES,
  DATA_FLOW_DISCLOSURE_EN,
  DATA_FLOW_DISCLOSURE_KO,
  EXPERIENCE_OPTIONS,
  ONBOARDING_QUESTIONS,
  SAFETY_OPTIONS,
  completeOnboarding,
  onboardingCopy,
  profileFromOnboarding,
} from "../src/profile/onboarding.mjs";
import { PERSONALIZED_ANALOGY_GENERATION_ENABLED } from "../src/profile/privacy.mjs";
import { validateProfile } from "../src/profile/profile.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const fixture = JSON.parse(
  await readFile(
    join(root, "fixtures", "profile", "clean-onboarding.json"),
    "utf8",
  ),
);
const now = new Date("2026-07-18T10:00:00.000Z");
const cleanFixture = {
  ...fixture,
  familiar_labels: ["Schedules, reviews, and handoffs"],
  language: "en",
};

test("English is the source/default and both locales share exactly five ordered questions", () => {
  const english = onboardingCopy();
  const korean = onboardingCopy("ko");
  assert.equal(ONBOARDING_QUESTIONS.length, 5);
  assert.deepEqual(
    ONBOARDING_QUESTIONS.map((question) => question.id),
    [
      "familiar_contexts",
      "familiar_anchors",
      "coding_actions",
      "presentation_preference",
      "safety_concerns",
    ],
  );
  assert.equal(english.locale, "en");
  assert.equal(korean.locale, "ko");
  assert.deepEqual(
    korean.questions.map((question) => question.id),
    english.questions.map((question) => question.id),
  );
  assert.deepEqual(english.backgroundCategories, BACKGROUND_CATEGORIES);
  assert.deepEqual(english.experienceOptions, EXPERIENCE_OPTIONS);
  assert.deepEqual(english.safetyOptions, SAFETY_OPTIONS);
  for (const [localizedOptions, sourceOptions] of [
    [korean.backgroundCategories, english.backgroundCategories],
    [korean.experienceOptions, english.experienceOptions],
    [korean.presentationOptions, english.presentationOptions],
    [korean.safetyOptions, english.safetyOptions],
  ]) {
    assert.deepEqual(Object.keys(localizedOptions), Object.keys(sourceOptions));
  }
  assert.match(DATA_FLOW_DISCLOSURE_EN, /this device/u);
  assert.match(DATA_FLOW_DISCLOSURE_EN, /coding-model service/u);
  assert.match(DATA_FLOW_DISCLOSURE_EN, /language/u);
  assert.match(DATA_FLOW_DISCLOSURE_EN, /presentation preference/u);
  assert.match(DATA_FLOW_DISCLOSURE_EN, /five.*familiar-context labels/u);
  assert.match(DATA_FLOW_DISCLOSURE_EN, /normal conversation/u);
  assert.match(DATA_FLOW_DISCLOSURE_KO, /이 기기/u);
  assert.match(DATA_FLOW_DISCLOSURE_KO, /코딩 모델 서비스/u);
  assert.match(DATA_FLOW_DISCLOSURE_KO, /언어/u);
  assert.match(DATA_FLOW_DISCLOSURE_KO, /설명 방식 선호/u);
  assert.match(DATA_FLOW_DISCLOSURE_KO, /익숙한 맥락 라벨 최대 5개/u);
  assert.match(DATA_FLOW_DISCLOSURE_KO, /일반 대화/u);
  assert.throws(() => onboardingCopy("fr"), /Unsupported onboarding locale/u);
});

test("clean onboarding remains neutral until the explicit preview decision", () => {
  const built = profileFromOnboarding(cleanFixture, now);
  assert.equal(built.privacyFallback, false);
  assert.equal(built.profile.language, "en");
  assert.equal(
    built.profile.familiar_worlds[0].label,
    "Office and document work",
  );
  assert.deepEqual(built.profile.observed_experience, ["No coding experience"]);
  assert.deepEqual(built.profile.safety_concerns, [
    "Secret or credential exposure",
    "Damage to files or the environment",
  ]);
  assert.equal(built.profile.model_processing.mode, "neutral_local");
  assert.deepEqual(built.profile.model_processing.approved_fields, []);
  assert.equal(built.profile.model_processing.approved_at, null);
  assert.equal(built.profile.model_processing.approved_projection_digest, null);

  const neutral = completeOnboarding(cleanFixture, "neutral", now);
  assert.equal(neutral.profile.model_processing.mode, "neutral_local");
  assert.equal(neutral.approved, false);

  const approved = completeOnboarding(cleanFixture, "approve", now);
  assert.equal(approved.approved, true);
  assert.equal(approved.preview.status, "ready");
  assert.equal(approved.profile.model_processing.mode, "personalized_model");
  assert.deepEqual(approved.profile.model_processing.approved_fields, [
    "language",
    "presentation_preference",
    "familiar_worlds",
  ]);
  const digest = approved.profile.model_processing.approved_projection_digest;
  assert.equal(typeof digest, "string");
  if (typeof digest === "string") assert.match(digest, /^[a-f0-9]{64}$/u);
  assert.equal(PERSONALIZED_ANALOGY_GENERATION_ENABLED, true);
});

test("pre-v0.1.4 personalized profiles load through the host-neutral mode", () => {
  const approved = completeOnboarding(cleanFixture, "approve", now).profile;
  const normalized = validateProfile({
    ...approved,
    model_processing: {
      ...approved.model_processing,
      mode: "personalized_claude",
    },
  });
  assert.equal(normalized.model_processing.mode, "personalized_model");
});

test("omitting language selects English while Korean stores reviewed localized labels", () => {
  const { language: _language, ...withoutLanguage } = cleanFixture;
  const english = profileFromOnboarding(withoutLanguage, now).profile;
  assert.equal(english.language, "en");
  assert.equal(english.familiar_worlds[0].label, "Office and document work");

  const korean = profileFromOnboarding(
    {
      ...cleanFixture,
      familiar_labels: ["일정·문서 검토·업무 인계"],
      language: "ko",
    },
    now,
  ).profile;
  assert.equal(korean.language, "ko");
  assert.deepEqual(korean.familiar_worlds, [
    { id: "category-office", label: "사무·문서 업무" },
    { id: "custom-1", label: "일정·문서 검토·업무 인계" },
  ]);
  assert.deepEqual(korean.observed_experience, ["코딩 경험 없음"]);
  assert.deepEqual(korean.safety_concerns, [
    "시크릿·인증 정보 노출",
    "파일·환경 손상",
  ]);
});

test("no-analogy is local-only and unsafe free text fails to neutral without persistence", () => {
  const noAnalogy = completeOnboarding(cleanFixture, "no-analogy", now);
  assert.equal(noAnalogy.profile.no_analogy, true);
  assert.equal(noAnalogy.profile.presentation_preference, "neutral");
  assert.equal(noAnalogy.profile.model_processing.mode, "neutral_local");

  const unsafe = completeOnboarding(
    {
      ...cleanFixture,
      background_categories: ["none"],
      familiar_labels: ["PRIVATE_PROFILE_CANARY@example.test"],
    },
    "approve",
    now,
  );
  assert.equal(unsafe.privacyFallback, true);
  assert.equal(unsafe.approved, false);
  assert.equal(unsafe.profile.model_processing.mode, "neutral_local");
  assert.deepEqual(unsafe.profile.familiar_worlds, []);
  assert.doesNotMatch(JSON.stringify(unsafe), /PRIVATE_PROFILE_CANARY/u);
});

test("unknown onboarding fields and unsupported choices fail without being copied", () => {
  assert.throws(() =>
    profileFromOnboarding(
      { ...cleanFixture, raw_name: "PRIVATE_NAME_CANARY" },
      now,
    ),
  );
  assert.throws(() =>
    profileFromOnboarding(
      {
        ...cleanFixture,
        presentation_preference: "learning_style_visual",
      },
      now,
    ),
  );
  assert.throws(() =>
    profileFromOnboarding({ ...cleanFixture, language: "fr" }, now),
  );
});

test("multilingual person and organization labels take the neutral fallback", () => {
  for (const label of [
    "서울대학교 과제 제출",
    "홍길동님 업무 인계",
    "Acme Corp handoff",
    "Dr Alice review",
  ]) {
    const result = completeOnboarding(
      {
        ...cleanFixture,
        background_categories: ["none"],
        familiar_labels: [label],
      },
      "approve",
      now,
    );
    assert.equal(result.privacyFallback, true);
    assert.equal(result.profile.model_processing.mode, "neutral_local");
    assert.deepEqual(result.profile.familiar_worlds, []);
  }
});
