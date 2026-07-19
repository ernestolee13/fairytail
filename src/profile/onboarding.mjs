import {
  PROFILE_ID,
  PROJECTION_FIELDS,
  isoDate,
  localOnlyProfile,
  validateProfile,
} from "./profile.mjs";
import { approvePersonalization, transmissionPreview } from "./privacy.mjs";
import { MAX_FAMILIAR_LABELS, sanitizeFamiliarLabels } from "./sanitize.mjs";

/**
 * @typedef {"en" | "ko"} OnboardingLocale
 * @typedef {{ id: string, prompt: string }} OnboardingQuestion
 * @typedef {{
 *   options: string,
 *   commaSeparated: string,
 *   decision: string,
 *   saved: string,
 *   noAnalogy: string,
 *   privacyFallback: string,
 *   approval: string,
 *   localPreview: string,
 *   transmissionPreview: string
 * }} OnboardingUi
 * @typedef {{
 *   locale: OnboardingLocale,
 *   disclosure: string,
 *   backgroundCategories: Readonly<Record<string, string>>,
 *   experienceOptions: Readonly<Record<string, string>>,
 *   presentationOptions: Readonly<Record<string, string>>,
 *   safetyOptions: Readonly<Record<string, string>>,
 *   questions: ReadonlyArray<OnboardingQuestion>,
 *   ui: OnboardingUi
 * }} OnboardingCopy
 */

export const DATA_FLOW_DISCLOSURE_EN =
  "Your answers are stored in Fairytail's data folder on this device and remain the source of truth. If you choose personalized analogies, the exact preview sent to the currently configured coding-model service contains only your language, presentation preference, and up to five approved short familiar-context labels. If you choose neutral analogies or no analogy, Fairytail does not add profile information to the model prompt. Your coding agent's normal conversation being processed by its configured service is separate from Fairytail adding this approved projection.";

export const DATA_FLOW_DISCLOSURE_KO =
  "응답은 이 기기의 Fairytail 데이터 폴더에 저장되며 진실원천으로 사용됩니다. 개인화 비유를 선택하면 현재 설정된 코딩 모델 서비스로 보내는 정확한 미리보기에 언어, 설명 방식 선호, 승인한 짧은 익숙한 맥락 라벨 최대 5개만 포함됩니다. 중립 비유 또는 비유 없음을 고르면 Fairytail은 프로필 정보를 모델 프롬프트에 추가하지 않습니다. 코딩 에이전트의 일반 대화가 설정된 서비스에서 처리되는 것과 Fairytail이 이 승인 투영본을 추가하는 것은 서로 다릅니다.";

/** @type {Readonly<Record<string, string>>} */
export const BACKGROUND_CATEGORIES = {
  office: "Office and document work",
  education: "Education and learning",
  healthcare: "Health and care",
  retail: "Sales and customer service",
  content: "Content and writing",
  research: "Research and analysis",
  design: "Design and creative work",
  operations: "Operations and project management",
  hobby: "Everyday life and hobbies",
  none: "No specific category",
};

/** @type {Readonly<Record<string, string>>} */
export const EXPERIENCE_OPTIONS = {
  none: "No coding experience",
  edited_file: "Edited code or a configuration file",
  ran_command: "Ran a terminal command",
  used_nocode: "Used no-code automation",
  built_small_project: "Completed a small coding project",
};

/** @type {Readonly<Record<string, string>>} */
export const SAFETY_OPTIONS = {
  cost: "Unexpected cost",
  secret: "Secret or credential exposure",
  privacy: "Personal data transmission",
  breakage: "Damage to files or the environment",
  external: "External publishing or messaging",
  none: "No current concern",
};

/** @type {Readonly<Record<string, string>>} */
export const PRESENTATION_OPTIONS = {
  analogy_first: "Analogy first",
  try_first: "Try it first",
  checklist: "Checklist",
  neutral: "Direct explanation",
};

export const ONBOARDING_QUESTIONS = [
  {
    id: "familiar_contexts",
    prompt:
      "1/5 Describe up to three work, study, hobby, or everyday contexts you genuinely know. Use short general labels, not a category choice or a person's or organization's name.",
  },
  {
    id: "familiar_anchors",
    prompt:
      "2/5 Add familiar roles, objects, or routines that make those contexts concrete. Across both answers, enter at most five labels of 40 characters or fewer.",
  },
  {
    id: "coding_actions",
    prompt: "3/5 Select coding actions you have tried. None is a valid answer.",
  },
  {
    id: "presentation_preference",
    prompt:
      "4/5 Select the explanation style you prefer: analogy, try it first, checklist, or direct explanation.",
  },
  {
    id: "safety_concerns",
    prompt:
      "5/5 Select any concerns that matter most, such as cost, secrets, privacy, breakage, or external actions.",
  },
];

/** @type {Readonly<Record<string, string>>} */
const BACKGROUND_CATEGORIES_KO = {
  office: "사무·문서 업무",
  education: "교육·학습",
  healthcare: "보건·돌봄",
  retail: "판매·고객 응대",
  content: "콘텐츠·글쓰기",
  research: "연구·분석",
  design: "디자인·창작",
  operations: "운영·프로젝트 관리",
  hobby: "생활·취미",
  none: "특정 범주 없음",
};

/** @type {Readonly<Record<string, string>>} */
const EXPERIENCE_OPTIONS_KO = {
  none: "코딩 경험 없음",
  edited_file: "코드나 설정 파일을 수정해 봄",
  ran_command: "터미널 명령을 직접 실행해 봄",
  used_nocode: "노코드 자동화를 사용해 봄",
  built_small_project: "작은 코딩 결과물을 완성해 봄",
};

/** @type {Readonly<Record<string, string>>} */
const SAFETY_OPTIONS_KO = {
  cost: "예상하지 못한 비용 발생",
  secret: "시크릿·인증 정보 노출",
  privacy: "개인정보 전송",
  breakage: "파일·환경 손상",
  external: "외부 공개·메시지 전송",
  none: "현재 선택한 우려 없음",
};

/** @type {Readonly<Record<string, string>>} */
const PRESENTATION_OPTIONS_KO = {
  analogy_first: "비유부터 설명",
  try_first: "직접 해보기부터 설명",
  checklist: "체크리스트",
  neutral: "직접적인 설명",
};

/** @type {ReadonlyArray<OnboardingQuestion>} */
const ONBOARDING_QUESTIONS_KO = [
  {
    id: "familiar_contexts",
    prompt:
      "1/5 실제로 익숙한 일·공부·취미·생활 맥락을 짧은 일반 라벨로 최대 3개 적으세요. 분류를 고르는 문항이 아니며 실명이나 조직명은 넣지 마세요.",
  },
  {
    id: "familiar_anchors",
    prompt:
      "2/5 그 맥락에서 익숙한 역할·물건·절차를 더 적으세요. 두 답변을 합쳐 최대 5개, 각 40자 이하로 입력하세요.",
  },
  {
    id: "coding_actions",
    prompt: "3/5 직접 해 본 코딩 행동을 고르세요. 없음도 괜찮습니다.",
  },
  {
    id: "presentation_preference",
    prompt:
      "4/5 편한 표현 방식을 고르세요: 비유 / 직접 해보기 / 체크리스트 / 직접적인 설명.",
  },
  {
    id: "safety_concerns",
    prompt:
      "5/5 비용·시크릿·개인정보·손상·외부 동작 중 특히 걱정되는 것을 고르세요.",
  },
];

/** @type {OnboardingUi} */
const ENGLISH_UI = {
  options: "Options",
  commaSeparated: "Enter comma-separated keys, or none",
  decision: "Choose: approve, edit, neutral, no-analogy, or later",
  saved: "Saved",
  noAnalogy: "no analogy",
  privacyFallback:
    "Identifying or uncertain labels were not stored or transmitted; Fairytail switched to neutral mode.",
  approval:
    "Only the approved projection and its consent digest were recorded. A host-managed mapper may fill bounded analogy role slots; the local adapter itself made no model or network call.",
  localPreview: "Full local-storage preview",
  transmissionPreview: "Fields planned for the configured coding-model service",
};

/** @type {OnboardingUi} */
const KOREAN_UI = {
  options: "선택 항목",
  commaSeparated: "쉼표로 구분한 키를 입력하거나 none을 입력하세요",
  decision:
    "선택: approve(승인), edit(수정), neutral(중립 비유), no-analogy(비유 없이), later(나중에 다시)",
  saved: "저장 완료",
  noAnalogy: "비유 없음",
  privacyFallback:
    "식별 가능하거나 불확실한 라벨은 저장·전송하지 않았고 중립 모드로 전환했습니다.",
  approval:
    "승인한 투영 필드와 동의 해시만 기록했습니다. 호스트가 관리하는 매퍼가 제한된 비유 역할 슬롯을 채울 수 있지만 로컬 어댑터 자체는 모델이나 네트워크를 호출하지 않았습니다.",
  localPreview: "로컬 저장 전체 미리보기",
  transmissionPreview: "설정된 코딩 모델 서비스로 보낼 필드 미리보기",
};

/** @type {Readonly<Record<OnboardingLocale, OnboardingCopy>>} */
const ONBOARDING_COPY = {
  en: {
    locale: "en",
    disclosure: DATA_FLOW_DISCLOSURE_EN,
    backgroundCategories: BACKGROUND_CATEGORIES,
    experienceOptions: EXPERIENCE_OPTIONS,
    presentationOptions: PRESENTATION_OPTIONS,
    safetyOptions: SAFETY_OPTIONS,
    questions: ONBOARDING_QUESTIONS,
    ui: ENGLISH_UI,
  },
  ko: {
    locale: "ko",
    disclosure: DATA_FLOW_DISCLOSURE_KO,
    backgroundCategories: BACKGROUND_CATEGORIES_KO,
    experienceOptions: EXPERIENCE_OPTIONS_KO,
    presentationOptions: PRESENTATION_OPTIONS_KO,
    safetyOptions: SAFETY_OPTIONS_KO,
    questions: ONBOARDING_QUESTIONS_KO,
    ui: KOREAN_UI,
  },
};

/**
 * Return reviewed UI copy for the explicitly supported setup locale.
 * Locale selection remains outside the five-question learner profile.
 *
 * @param {unknown} locale
 * @returns {OnboardingCopy}
 */
export function onboardingCopy(locale = "en") {
  if (locale !== "en" && locale !== "ko") {
    throw new TypeError("Unsupported onboarding locale");
  }
  return ONBOARDING_COPY[locale];
}

/**
 * @typedef {{
 *   familiar_contexts: string[],
 *   familiar_anchors: string[],
 *   background_categories: string[],
 *   familiar_labels: string[],
 *   coding_actions: string[],
 *   presentation_preference: string,
 *   safety_concerns: string[],
 *   language?: "ko" | "en"
 * }} OnboardingAnswers
 */

/**
 * Convert the five answers into a bounded local profile. Free text is never
 * stored when it fails the privacy contract; the whole flow falls back to
 * neutral mode without echoing rejected input.
 *
 * @param {unknown} answersValue
 * @param {Date} [now]
 */
export function profileFromOnboarding(answersValue, now = new Date()) {
  const answers = onboardingAnswers(answersValue);
  const copy = onboardingCopy(answers.language);
  const categoryWorlds = answers.background_categories
    .filter((key) => key !== "none")
    .map((key) => ({
      id: `category-${key}`,
      label: copy.backgroundCategories[key],
    }));
  const directWorlds = [
    ...answers.familiar_contexts.map((label, index) => ({
      id: `context-${index + 1}`,
      label,
    })),
    ...answers.familiar_anchors.map((label, index) => ({
      id: `anchor-${index + 1}`,
      label,
    })),
  ];
  const legacyLabels = answers.familiar_labels;
  const availableCustomCount = Math.max(
    0,
    MAX_FAMILIAR_LABELS - categoryWorlds.length,
  );
  const customResult = sanitizeFamiliarLabels(
    directWorlds.length > 0
      ? directWorlds.map((world) => world.label)
      : legacyLabels.slice(0, availableCustomCount),
  );
  const privacyFallback = !customResult.ok;
  const customWorlds = customResult.ok
    ? customResult.values.map((label, index) => ({
        id:
          directWorlds.find((world) => world.label === label)?.id ??
          customWorldId(index),
        label,
      }))
    : [];

  const profile = validateProfile({
    profile_version: 2,
    profile_id: PROFILE_ID,
    language: answers.language ?? "en",
    familiar_worlds: [...categoryWorlds, ...customWorlds].slice(
      0,
      MAX_FAMILIAR_LABELS,
    ),
    observed_experience: answers.coding_actions.map(
      (key) => copy.experienceOptions[key],
    ),
    presentation_preference: answers.presentation_preference,
    safety_concerns: answers.safety_concerns
      .filter((key) => key !== "none")
      .map((key) => copy.safetyOptions[key]),
    no_analogy: false,
    model_processing: {
      mode: "neutral_local",
      approved_fields: [],
      approved_at: null,
      approved_projection_digest: null,
    },
    pii_redaction_enabled: true,
    updated_at: isoDate(now),
  });

  return {
    profile,
    privacyFallback,
    fallbackReason: privacyFallback ? "unsafe-or-uncertain-label" : null,
  };
}

/**
 * @param {unknown} answersValue
 * @param {"approve" | "neutral" | "no-analogy" | "later"} decision
 * @param {Date} [now]
 */
export function completeOnboarding(answersValue, decision, now = new Date()) {
  const built = profileFromOnboarding(answersValue, now);
  if (built.privacyFallback) {
    const blockedPreview = transmissionPreview(
      localOnlyProfile(built.profile, now, {
        noAnalogy: true,
        presentation: "neutral",
      }),
    );
    return {
      ...built,
      decision: "neutral",
      approved: false,
      preview: blockedPreview,
    };
  }
  if (decision === "approve") {
    const approval = approvePersonalization(
      built.profile,
      PROJECTION_FIELDS,
      now,
    );
    return {
      ...built,
      profile: approval.profile,
      decision: approval.approved ? "approve" : "neutral",
      approved: approval.approved,
      preview: approval.preview,
    };
  }
  if (decision === "no-analogy") {
    return {
      ...built,
      profile: localOnlyProfile(built.profile, now, {
        noAnalogy: true,
        presentation: "neutral",
      }),
      decision,
      approved: false,
      preview: transmissionPreview(built.profile),
    };
  }
  if (decision === "neutral" || decision === "later") {
    return {
      ...built,
      profile: localOnlyProfile(built.profile, now),
      decision,
      approved: false,
      preview: transmissionPreview(built.profile),
    };
  }
  throw new TypeError("Unsupported onboarding decision");
}

/** @param {unknown} value @returns {OnboardingAnswers} */
function onboardingAnswers(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Onboarding answers must be an object");
  }
  const input = /** @type {Record<string, unknown>} */ (value);
  const allowed = [
    "familiar_contexts",
    "familiar_anchors",
    "background_categories",
    "familiar_labels",
    "coding_actions",
    "presentation_preference",
    "safety_concerns",
    "language",
  ];
  for (const key of [
    "coding_actions",
    "presentation_preference",
    "safety_concerns",
  ]) {
    if (!Object.hasOwn(input, key))
      throw new TypeError("Incomplete onboarding answers");
  }
  if (Object.keys(input).some((key) => !allowed.includes(key))) {
    throw new TypeError("Unknown onboarding answer field");
  }

  const directShape =
    Object.hasOwn(input, "familiar_contexts") ||
    Object.hasOwn(input, "familiar_anchors");
  const legacyShape =
    Object.hasOwn(input, "background_categories") ||
    Object.hasOwn(input, "familiar_labels");
  if (directShape === legacyShape) {
    throw new TypeError("Choose exactly one onboarding profile shape");
  }
  if (
    directShape &&
    (!Object.hasOwn(input, "familiar_contexts") ||
      !Object.hasOwn(input, "familiar_anchors"))
  ) {
    throw new TypeError("Incomplete direct profile answers");
  }
  if (
    legacyShape &&
    (!Object.hasOwn(input, "background_categories") ||
      !Object.hasOwn(input, "familiar_labels"))
  ) {
    throw new TypeError("Incomplete legacy profile answers");
  }

  const contexts = directShape ? rawStringList(input.familiar_contexts, 3) : [];
  const anchors = directShape
    ? rawStringList(input.familiar_anchors, MAX_FAMILIAR_LABELS)
    : [];
  if (contexts.length + anchors.length > MAX_FAMILIAR_LABELS) {
    throw new TypeError("Too many direct familiar labels");
  }
  const background = legacyShape
    ? optionList(
        input.background_categories,
        Object.keys(BACKGROUND_CATEGORIES),
        3,
      )
    : [];
  const labels = legacyShape
    ? rawStringList(input.familiar_labels, MAX_FAMILIAR_LABELS)
    : [];
  const coding = optionList(
    input.coding_actions,
    Object.keys(EXPERIENCE_OPTIONS),
    3,
  );
  const preference = option(input.presentation_preference, [
    "analogy_first",
    "try_first",
    "checklist",
    "neutral",
  ]);
  const concerns = optionList(
    input.safety_concerns,
    Object.keys(SAFETY_OPTIONS),
    5,
  );
  const language = /** @type {"ko" | "en"} */ (
    input.language === undefined ? "en" : option(input.language, ["ko", "en"])
  );
  return {
    familiar_contexts: contexts,
    familiar_anchors: anchors,
    background_categories: background,
    familiar_labels: labels,
    coding_actions: coding,
    presentation_preference: preference,
    safety_concerns: concerns,
    language,
  };
}

/** @param {unknown} value @param {string[]} allowed */
function option(value, allowed) {
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new TypeError("Unsupported onboarding option");
  }
  return value;
}

/** @param {unknown} value @param {string[]} allowed @param {number} maximum */
function optionList(value, allowed, maximum) {
  const values = rawStringList(value, maximum);
  if (values.some((item) => !allowed.includes(item))) {
    throw new TypeError("Unsupported onboarding option");
  }
  return values;
}

/** @param {unknown} value @param {number} maximum */
function rawStringList(value, maximum) {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new TypeError("Invalid onboarding answer list");
  }
  const result = value.map((item) => {
    if (typeof item !== "string" || item !== item.normalize("NFC")) {
      throw new TypeError("Invalid onboarding answer value");
    }
    return item;
  });
  if (new Set(result).size !== result.length) {
    throw new TypeError("Duplicate onboarding answer value");
  }
  return result;
}

/** @param {number} index */
function customWorldId(index) {
  return `custom-${index + 1}`;
}
