import assert from "node:assert/strict";
import test from "node:test";

import {
  VERIFIED_CLAUDE_CODE,
  VERIFIED_CODEX_CLI,
  diagnosticReport,
} from "../src/doctor.mjs";

test("doctor reports the verified platform and refuses premature claims", () => {
  const report = diagnosticReport({
    dataDirAvailable: true,
    host: "codex",
    profile: {
      source: "stored",
      onboardingRequired: false,
      processingMode: "personalized_model",
      noAnalogy: false,
      approvedFields: [
        "language",
        "presentation_preference",
        "familiar_worlds",
      ],
    },
  });

  assert.equal(VERIFIED_CLAUDE_CODE, "2.1.215");
  assert.equal(VERIFIED_CODEX_CLI, "0.144.5");
  assert.equal(report.compatibility.verifiedClaudeCode, "2.1.215");
  assert.equal(report.compatibility.verifiedCodexCli, "0.144.5");
  assert.equal(report.plugin.phase, "G012");
  assert.deepEqual(report.compatibility.explicitSkills, [
    "before",
    "build",
    "doctor",
    "error",
    "fairytail-explain-concept",
    "finish",
    "onboard",
    "personalize",
    "profile",
    "review",
    "safety",
  ]);
  assert.deepEqual(report.compatibility.optionalAgents, [
    "fairytail-explainer",
  ]);
  assert.equal(report.compatibility.sourceLocale, "en");
  assert.deepEqual(report.compatibility.reviewedPresentationLocales, [
    "en",
    "ko",
  ]);
  assert.equal(report.claims.personalizesNow, true);
  assert.equal(report.claims.profileBoundaryReady, true);
  assert.equal(report.claims.userAuthoredAnalogyMappingReady, true);
  assert.equal(report.claims.reviewedAnalogySelectionReady, true);
  assert.equal(report.claims.ponytailBuildDecisionContractReady, true);
  assert.equal(report.claims.deterministicExplanationPacketReady, true);
  assert.equal(
    report.claims.optionalLightweightPresentationAgentIncluded,
    true,
  );
  assert.equal(report.claims.personalizedAnalogyGenerationEnabled, true);
  assert.equal(report.claims.genericFirstUseAnalogyReady, true);
  assert.equal(report.claims.enforcesSafetyNow, true);
  assert.equal(report.claims.blocksExposedP0HostileFixtures, true);
  assert.equal(report.claims.cleanLocalInstallUninstallVerified, true);
  assert.equal(report.claims.coexistenceFixturePreserved, true);
  assert.equal(report.claims.everyHarnessReleaseCertified, false);
  assert.equal(report.claims.grantsExecutionPermission, false);
  assert.equal(report.claims.securesUnexposedHostActions, false);
  assert.equal(report.claims.humanComprehensionProven, false);
  assert.equal(report.claims.generalTokenSavingsProven, false);
  assert.equal(report.explanationRouting.changesParentModel, false);
  assert.equal(
    report.explanationRouting.codexRouteWithoutSeparateAgent,
    "deterministic_inline",
  );
  assert.equal(report.explanationRouting.delegatesCodeOrVerification, false);
  assert.deepEqual(report.integration.verifiedInteractiveHosts, [
    "claude_code",
    "codex_cli",
  ]);
  assert.deepEqual(report.integration.verifiedPackagingHosts, [
    "claude_code",
    "codex_cli",
  ]);
  assert.equal(
    report.integration.verifiedCoexistenceFixture,
    "superpowers_shaped_inert_plugin",
  );
  assert.equal(report.integration.nativeOpenCodeAdapterIncluded, false);
  assert.equal(report.integration.codexAdapterIncluded, true);
  assert.equal(report.integration.codexLocalOnboardingIncluded, true);
  assert.equal(report.integration.codexInteractiveRuntimeVerified, true);
  assert.equal(report.integration.codexOmxHookOrderVerified, false);
  assert.equal(report.integration.ownsOrchestration, false);
  assert.equal(report.integration.assumesHookOrder, false);
  assert.equal(report.integration.writesGlobalGuidance, false);
  assert.equal(report.claims.codexRepositoryInstallLifecycleVerified, true);
  assert.equal(report.claims.codexInteractiveRuntimeVerified, true);
  assert.equal(report.claims.codexLocalOnboardingReady, true);
  assert.equal(
    report.efficiency.pinnedCommit,
    "16f29800fd2681bdf24f3eb4ccffe38be3baec6b",
  );
  assert.equal(report.privacy.dataDirAvailable, true);
  assert.equal(report.privacy.profileTruthSource, "user_authored_local_file");
  assert.deepEqual(report.onboarding, {
    host: "codex",
    dataDirConfigured: true,
    source: "stored",
    required: false,
    processingMode: "personalized_model",
    noAnalogy: false,
    approvedFields: ["language", "presentation_preference", "familiar_worlds"],
    rawAnswersIncluded: false,
  });
});
