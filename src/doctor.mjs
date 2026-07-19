export const VERIFIED_CLAUDE_CODE = "2.1.215";
export const VERIFIED_CODEX_CLI = "0.144.5";

/**
 * @param {{
 *   dataDirAvailable?: boolean,
 *   host?: "claude" | "codex" | "unknown",
 *   profile?: {
 *     source: "stored" | "default",
 *     onboardingRequired: boolean,
 *     processingMode: string,
 *     noAnalogy: boolean,
 *     approvedFields: string[]
 *   }
 * }} [options]
 */
export function diagnosticReport(options = {}) {
  return {
    plugin: {
      name: "fairytail",
      version: "0.1.6",
      phase: "G012",
    },
    compatibility: {
      verifiedClaudeCode: VERIFIED_CLAUDE_CODE,
      verifiedCodexCli: VERIFIED_CODEX_CLI,
      activeHookEvents: [
        "SessionStart",
        "PreToolUse",
        "PostToolUse",
        "PostToolUseFailure",
      ],
      explicitSkills: [
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
      ],
      optionalAgents: ["fairytail-explainer"],
      optionalOutputStyles: ["fairytail-friendly"],
      sourceLocale: "en",
      reviewedPresentationLocales: ["en", "ko"],
    },
    integration: {
      modes: [
        "standalone",
        "additive_explanation_only",
        "advisory_only",
        "duplicate_adapter_blocked",
      ],
      recognizedOrchestrators: ["superpowers", "omo", "omx"],
      verifiedInteractiveHosts: ["claude_code", "codex_cli"],
      verifiedPackagingHosts: ["claude_code", "codex_cli"],
      verifiedCoexistenceFixture: "superpowers_shaped_inert_plugin",
      nativeOpenCodeAdapterIncluded: false,
      codexAdapterIncluded: true,
      codexLocalOnboardingIncluded: true,
      codexInteractiveRuntimeVerified: true,
      codexOmxHookOrderVerified: false,
      ownsOrchestration: false,
      assumesHookOrder: false,
      changesParentModel: false,
      writesGlobalGuidance: false,
    },
    boundaries: {
      observes:
        "Configured Claude Code hook events only; Codex onboarding and explanation skills do not inspect projects or persist prompts",
      renders:
        "Claude Code or Codex conversation through an explicitly invoked or semantically selected skill",
      persists:
        "Sanitized event envelopes, an exact-key local profile, and locally validated role bindings under the active host's private Fairytail data directory",
      blocksNow:
        "Deterministic red/P0 actions exposed through PreToolUse; yellow actions are escalated to scoped host approval",
      blockingSurface:
        "Configured PreToolUse only; unexposed host actions remain outside Fairytail",
    },
    efficiency: {
      upstream: "DietrichGebert/ponytail",
      pinnedCommit: "16f29800fd2681bdf24f3eb4ccffe38be3baec6b",
      license: "MIT",
      traceBeforeLadder: true,
      safetyExceptionsPreserved: true,
      runnableCheckForNontrivialLogic: true,
    },
    explanationRouting: {
      defaultRoute: "deterministic_inline",
      claudeNaturalLanguageRoute: "host_semantic_skill_selection",
      optionalClaudeRoute: "isolated_subagent",
      claudeAgent: "fairytail-explainer",
      codexRouteWithoutSeparateAgent: "deterministic_inline",
      changesParentModel: false,
      delegatesCodeOrVerification: false,
      fallback: "precomputed_deterministic_bytes",
      firstUseAnalogy: "generic_reviewed_without_profile_inference",
    },
    privacy: {
      dataDirAvailable: options.dataDirAvailable ?? false,
      loggedFields: [
        "schemaVersion",
        "timestamp",
        "event",
        "phase",
        "PreToolUse.risk",
        "PreToolUse.decision",
        "PreToolUse.reasonCode",
        "PreToolUse.target.display",
        "PreToolUse.target.fingerprint",
        "PreToolUse.sideEffect",
      ],
      forbiddenLogFields: [
        "prompt",
        "profile",
        "toolInput",
        "toolOutput",
        "error",
        "path",
        "identifier",
      ],
      profileDefaultMode: "neutral_local",
      profileTruthSource: "user_authored_local_file",
      personalizationPurpose: "bounded_analogy_role_binding_only",
      promptActivation:
        "host semantic skill selection from shared metadata; Fairytail has no prompt-submission hook and does not persist raw prompts",
      outboundProfileFields: [
        "language",
        "presentation_preference",
        "familiar_worlds[].label",
      ],
    },
    onboarding: {
      host: options.host ?? "unknown",
      dataDirConfigured: options.dataDirAvailable ?? false,
      source: options.profile?.source ?? "default",
      required: options.profile?.onboardingRequired ?? true,
      processingMode: options.profile?.processingMode ?? "neutral_local",
      noAnalogy: options.profile?.noAnalogy ?? false,
      approvedFields: options.profile?.approvedFields ?? [],
      rawAnswersIncluded: false,
    },
    claims: {
      personalizesNow: true,
      profileBoundaryReady: true,
      userAuthoredAnalogyMappingReady: true,
      reviewedAnalogySelectionReady: true,
      ponytailBuildDecisionContractReady: true,
      deterministicExplanationPacketReady: true,
      optionalLightweightPresentationAgentIncluded: true,
      personalizedAnalogyGenerationEnabled: true,
      genericFirstUseAnalogyReady: true,
      enforcesSafetyNow: true,
      blocksExposedP0HostileFixtures: true,
      cleanLocalInstallUninstallVerified: true,
      coexistenceFixturePreserved: true,
      codexRepositoryInstallLifecycleVerified: true,
      codexInteractiveRuntimeVerified: true,
      codexLocalOnboardingReady: true,
      everyHarnessReleaseCertified: false,
      grantsExecutionPermission: false,
      securesUnexposedHostActions: false,
      humanComprehensionProven: false,
      generalTokenSavingsProven: false,
    },
  };
}
