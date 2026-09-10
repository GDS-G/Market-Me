import type {
  AiCapability,
  AiMode,
  AiModeIndicators,
  AiPrivacyClass,
  AiProviderAdapterDescriptor,
  AiSpendReservation,
  AiCapResponsePlan,
  AiAssistantAction,
  AiAssistantProfile,
  AiAssistantProfileId,
  AiAssistantSelection,
  AiAssistantWorkPlan,
  AiAdapterIdentity,
  AiRoutingDecision,
  AiRoutingRequest,
} from "@market-me/domain";

/**
 * The first adapter is deliberately local and deterministic. It describes the
 * existing grounded generators; it does not imply that an arbitrary local LLM
 * is installed or that an external provider may receive workspace data.
 */
export const BUILT_IN_AI_ADAPTERS: readonly AiProviderAdapterDescriptor[] = [
  {
    provider: "market-me",
    model: "grounded-template",
    displayName: "Market Me grounded templates",
    capabilities: ["generate_text", "generate_structured_output"],
    privacyClass: "local",
    quality: "standard",
    speed: "fast",
    cost: "low",
    contextLimit: 32_000,
    available: true,
    approved: true,
    requiresPaidReservation: false,
  },
];

export const AI_MODE_INDICATORS: Readonly<Record<AiMode, AiModeIndicators>> = {
  recommended: {
    quality: "enhanced",
    speed: "balanced",
    privacy: "cloud",
    estimatedCost: "medium",
  },
  lower_cost: {
    quality: "standard",
    speed: "balanced",
    privacy: "cloud",
    estimatedCost: "low",
  },
  highest_quality: {
    quality: "highest",
    speed: "thorough",
    privacy: "cloud",
    estimatedCost: "high",
  },
  faster: {
    quality: "standard",
    speed: "fast",
    privacy: "cloud",
    estimatedCost: "medium",
  },
  private_local: {
    quality: "standard",
    speed: "balanced",
    privacy: "local",
    estimatedCost: "low",
  },
  custom: {
    quality: "enhanced",
    speed: "balanced",
    privacy: "private_cloud",
    estimatedCost: "medium",
  },
};

export const AI_ASSISTANT_PROFILES: readonly AiAssistantProfile[] = [
  {
    id: "content_analyst",
    displayName: "Content Analyst",
    purpose: "Understands incoming material and returns grounded observations for review.",
    actions: ["understand_content", "review_rules_rights_and_claims"],
    capabilities: ["generate_structured_output", "analyze_image", "transcribe", "embed"],
    outputKinds: ["analysis", "recommendation"],
    executionAuthority: false,
  },
  {
    id: "copy_assistant",
    displayName: "Copy Assistant",
    purpose: "Prepares evidence-backed channel and audience variants.",
    actions: ["prepare_copy", "draft_eligible_interaction"],
    capabilities: ["generate_text", "generate_structured_output"],
    outputKinds: ["draft", "recommendation"],
    executionAuthority: false,
  },
  {
    id: "campaign_planner",
    displayName: "Campaign Planner",
    purpose: "Recommends reviewable campaign stages and dependencies.",
    actions: ["plan_campaign", "evaluate_results_and_experiments"],
    capabilities: ["generate_structured_output", "rerank", "use_tools"],
    outputKinds: ["analysis", "recommendation", "proposed_action"],
    executionAuthority: false,
  },
  {
    id: "discovery_assistant",
    displayName: "Discovery Assistant",
    purpose: "Finds relevant profiles and content from eligible indexed data.",
    actions: ["discover_profiles_and_content", "understand_content"],
    capabilities: ["embed", "rerank", "generate_structured_output", "use_tools"],
    outputKinds: ["analysis", "recommendation"],
    executionAuthority: false,
  },
  {
    id: "conversation_assistant",
    displayName: "Conversation Assistant",
    purpose: "Drafts and organizes eligible interactions for human review.",
    actions: ["draft_eligible_interaction", "prepare_copy"],
    capabilities: ["generate_text", "generate_structured_output", "use_tools"],
    outputKinds: ["analysis", "draft", "recommendation", "proposed_action"],
    executionAuthority: false,
  },
  {
    id: "compliance_reviewer",
    displayName: "Compliance Reviewer",
    purpose: "Checks configured rules, rights, disclosures, and evidence-backed claims.",
    actions: ["review_rules_rights_and_claims", "understand_content"],
    capabilities: ["moderate", "generate_structured_output", "analyze_image"],
    outputKinds: ["analysis", "recommendation"],
    executionAuthority: false,
  },
  {
    id: "performance_analyst",
    displayName: "Performance Analyst",
    purpose: "Evaluates measured results and proposes reviewable experiments.",
    actions: ["evaluate_results_and_experiments", "plan_campaign", "discover_profiles_and_content"],
    capabilities: ["generate_structured_output", "embed", "rerank"],
    outputKinds: ["analysis", "recommendation", "proposed_action"],
    executionAuthority: false,
  },
] as const;

const assistantById = Object.fromEntries(
  AI_ASSISTANT_PROFILES.map((profile) => [profile.id, profile]),
) as Readonly<Record<AiAssistantProfileId, AiAssistantProfile>>;

const automaticAssistantByAction = {
  understand_content: { profileId: "content_analyst", capability: "generate_structured_output" },
  prepare_copy: { profileId: "copy_assistant", capability: "generate_text" },
  plan_campaign: { profileId: "campaign_planner", capability: "generate_structured_output" },
  discover_profiles_and_content: { profileId: "discovery_assistant", capability: "rerank" },
  draft_eligible_interaction: { profileId: "conversation_assistant", capability: "generate_text" },
  review_rules_rights_and_claims: { profileId: "compliance_reviewer", capability: "generate_structured_output" },
  evaluate_results_and_experiments: { profileId: "performance_analyst", capability: "generate_structured_output" },
} as const satisfies Readonly<
  Record<AiAssistantAction, { profileId: AiAssistantProfileId; capability: AiCapability }>
>;

/**
 * Selects the product-facing assistant for an action. This is role presentation
 * only: the returned profile cannot select a provider, invoke a model, approve
 * spend, mutate product state, or execute a proposed action.
 */
export function isAiAssistantCompatible(
  action: AiAssistantAction,
  profileId: AiAssistantProfileId,
): boolean {
  const profile = assistantById[profileId];
  const requiredCapability = automaticAssistantByAction[action].capability;
  return Boolean(
    profile &&
    profile.actions.includes(action) &&
    profile.capabilities.includes(requiredCapability)
  );
}

export function requiredAiCapabilityForAction(
  action: AiAssistantAction,
): AiCapability {
  return automaticAssistantByAction[action].capability;
}

export function isAiRoutingPreferenceCompatible(
  action: AiAssistantAction,
  preference: AiAdapterIdentity,
  adapters: readonly AiProviderAdapterDescriptor[] = BUILT_IN_AI_ADAPTERS,
): boolean {
  const capability = requiredAiCapabilityForAction(action);
  return adapters.some(
    (adapter) =>
      adapter.provider === preference.provider &&
      adapter.model === preference.model &&
      adapter.approved &&
      adapter.capabilities.includes(capability),
  );
}

export function selectAiAssistant(
  action: AiAssistantAction,
  profileId?: AiAssistantProfileId,
): AiAssistantSelection {
  const assignment = automaticAssistantByAction[action];
  const selectedProfileId = profileId ?? assignment.profileId;
  if (!isAiAssistantCompatible(action, selectedProfileId))
    throw new Error(
      `${selectedProfileId} is not compatible with ${action}.`,
    );
  const profile = assistantById[selectedProfileId];
  return {
    action,
    profile,
    requiredCapability: assignment.capability,
    status: "selected",
    automatic: profileId === undefined,
    executionAuthority: false,
    reasons: [
      `${profile.displayName} is the ${profileId === undefined ? "automatic" : "workspace-selected"} assistant for ${action.replaceAll("_", " ")}.`,
      "Deterministic services still validate privacy, evidence, permissions, budgets, approvals, and connector capability before execution.",
    ],
  };
}

/**
 * Combines one product-facing assistant selection with ordinary gateway
 * routing so the UI can show honest readiness and a qualitative cost class.
 * It is a plan only; cost class is not a currency quote or spend authority.
 */
export function planAiAssistantWork(
  input: {
    action: AiAssistantAction;
    profileId?: AiAssistantProfileId;
    mode: AiMode;
    maximumPrivacyClass: AiPrivacyClass;
    routingPreference?: AiAdapterIdentity;
  },
  adapters: readonly AiProviderAdapterDescriptor[] = BUILT_IN_AI_ADAPTERS,
): AiAssistantWorkPlan {
  const selection = selectAiAssistant(input.action, input.profileId);
  const routing = routeAiTask(
    {
      capability: selection.requiredCapability,
      mode: input.mode,
      maximumPrivacyClass: input.maximumPrivacyClass,
      requiresTools: selection.requiredCapability === "use_tools",
      ...(input.routingPreference
        ? { preferredAdapter: input.routingPreference }
        : {}),
    },
    adapters,
  );
  if (routing.status !== "selected" || !routing.adapter)
    return {
      selection,
      routing,
      status: "unavailable",
      currencyEstimateAvailable: false,
      execution: false,
      reasons: [
        `${selection.profile.displayName} is selected, but its required capability is not configured within the current policy boundaries.`,
        ...routing.reasons,
      ],
    };
  return {
    selection,
    routing,
    status: "ready",
    estimatedCost: routing.adapter.cost,
    currencyEstimateAvailable: false,
    execution: false,
    reasons: [
      `${selection.profile.displayName} can use an approved ${routing.adapter.cost} cost-class route for this action.`,
      "This is a qualitative indicator, not a currency quote, reservation, or provider call.",
    ],
  };
}

export interface AiGatewayInvocation<TInput = unknown> {
  capability: AiCapability;
  input: TInput;
}

/**
 * Maps a persisted cap denial to a deterministic next step. The adapter list
 * passed here must contain only execution paths known by the caller to require
 * no paid spend reservation; the built-in grounded templates satisfy that
 * boundary. This function plans only and never invokes an adapter.
 */
export function planAiCapResponse(
  input: {
    reservation: AiSpendReservation;
    maximumPrivacyClass: AiPrivacyClass;
  },
  noPaidAdapters: readonly AiProviderAdapterDescriptor[] = BUILT_IN_AI_ADAPTERS,
): AiCapResponsePlan {
  const { reservation } = input;
  if (reservation.status !== "denied")
    return {
      deniedReservationId: reservation.id,
      capability: reservation.capability,
      capBehavior: reservation.capBehavior,
      status: "unavailable",
      action: "manual",
      requiresApproval: false,
      requiresPaidReservation: false,
      limitations: ["denied_reservation_required"],
      reasons: ["A cap response can be planned only from a persisted denied reservation."],
    };

  if (reservation.capBehavior === "pause_ai_work")
    return {
      deniedReservationId: reservation.id,
      capability: reservation.capability,
      capBehavior: reservation.capBehavior,
      status: "ready",
      action: "pause",
      requiresApproval: false,
      requiresPaidReservation: false,
      limitations: ["no_ai_execution"],
      reasons: ["AI work remains paused because the configured cap was reached."],
    };

  if (reservation.capBehavior === "require_approval")
    return {
      deniedReservationId: reservation.id,
      capability: reservation.capability,
      capBehavior: reservation.capBehavior,
      status: "ready",
      action: "request_approval",
      requiresApproval: true,
      requiresPaidReservation: false,
      limitations: ["exact_denied_estimate", "one_time_exception"],
      reasons: ["A workspace writer may request approval for this exact denied estimate."],
    };

  const route = routeAiTask(
    {
      capability: reservation.capability,
      mode: "lower_cost",
      maximumPrivacyClass: input.maximumPrivacyClass,
    },
    noPaidAdapters,
  );
  if (route.status !== "selected" || !route.adapter)
    return {
      deniedReservationId: reservation.id,
      capability: reservation.capability,
      capBehavior: reservation.capBehavior,
      status: "unavailable",
      action: "manual",
      requiresApproval: false,
      requiresPaidReservation: false,
      limitations: ["no_no_paid_adapter"],
      reasons: [
        "No approved no-paid adapter satisfies the denied capability and privacy boundary.",
        "Market Me will not reinterpret the cap as permission to call another paid provider.",
      ],
    };

  if (reservation.capBehavior === "limited_drafts") {
    if (
      reservation.capability !== "generate_text" &&
      reservation.capability !== "generate_structured_output"
    )
      return {
        deniedReservationId: reservation.id,
        capability: reservation.capability,
        capBehavior: reservation.capBehavior,
        status: "unavailable",
        action: "manual",
        requiresApproval: false,
        requiresPaidReservation: false,
        limitations: ["draft_capability_required"],
        reasons: ["Limited-analysis drafting is available only for text or structured-output work."],
      };
    return {
      deniedReservationId: reservation.id,
      capability: reservation.capability,
      capBehavior: reservation.capBehavior,
      status: "ready",
      action: "create_limited_draft",
      adapter: route.adapter,
      requiresApproval: false,
      requiresPaidReservation: false,
      limitations: ["grounded_templates_only", "no_premium_reasoning", "human_review_required"],
      reasons: [
        `${route.adapter.displayName} can create a grounded limited-analysis draft without paid spend.`,
      ],
    };
  }

  return {
    deniedReservationId: reservation.id,
    capability: reservation.capability,
    capBehavior: reservation.capBehavior,
    status: "ready",
    action: "use_lower_cost_adapter",
    adapter: route.adapter,
    requiresApproval: false,
    requiresPaidReservation: false,
    limitations: ["no_paid_spend", "capability_and_privacy_bound"],
    reasons: [
      `${route.adapter.displayName} is an approved no-paid fallback for this capability and privacy boundary.`,
    ],
  };
}

export interface AiGatewayResult<TOutput = unknown> {
  output: TOutput;
  usage: {
    inputUnits: number;
    outputUnits: number;
    cachedInputUnits: number;
    latencyMs: number;
  };
}

export interface AiProviderAdapter<TInput = unknown, TOutput = unknown> {
  descriptor: AiProviderAdapterDescriptor;
  invoke(invocation: AiGatewayInvocation<TInput>): Promise<AiGatewayResult<TOutput>>;
}

/**
 * Chooses an approved adapter deterministically. Privacy and capability filters
 * are hard constraints; cost, quality, and speed only rank eligible adapters.
 */
export function routeAiTask(
  request: AiRoutingRequest,
  adapters: readonly AiProviderAdapterDescriptor[] = BUILT_IN_AI_ADAPTERS,
): AiRoutingDecision {
  const eligible = adapters.filter(
    (adapter) =>
      adapter.available &&
      adapter.approved &&
      adapter.capabilities.includes(request.capability) &&
      (!request.requiresTools || adapter.capabilities.includes("use_tools")) &&
      permitsPrivacy(request.maximumPrivacyClass, adapter.privacyClass) &&
      (request.estimatedInputUnits === undefined ||
        request.estimatedInputUnits <= adapter.contextLimit) &&
      (request.mode !== "private_local" || adapter.privacyClass === "local"),
  );

  if (eligible.length === 0) {
    return {
      status: "unavailable",
      consideredAdapters: adapters.length,
      reasons: [
        "No approved and available adapter satisfies the requested capability, privacy, tools, and context constraints.",
        "Market Me will not broaden data exposure or switch to an unapproved provider automatically.",
      ],
      requiresApproval: false,
    };
  }

  if (request.preferredAdapter) {
    const preferred = eligible.find(
      (adapter) =>
        adapter.provider === request.preferredAdapter!.provider &&
        adapter.model === request.preferredAdapter!.model,
    );
    if (!preferred)
      return {
        status: "unavailable",
        consideredAdapters: adapters.length,
        reasons: [
          "The workspace-preferred processing route is not eligible for this capability and current policy.",
          "Market Me will not silently fall back from an explicit route preference or broaden data exposure.",
        ],
        requiresApproval: false,
      };
    return {
      status: "selected",
      adapter: preferred,
      consideredAdapters: adapters.length,
      reasons: [
        `${preferred.displayName} is the workspace-preferred route for this action.`,
        `${preferred.privacyClass.replaceAll("_", " ")} processing satisfies the task privacy boundary.`,
        "Hard capability, approval, availability, tools, context, and privacy filters were applied before the preference.",
      ],
      requiresApproval: false,
    };
  }

  const adapter = [...eligible].sort((left, right) => {
    const scoreDifference = score(request.mode, left) - score(request.mode, right);
    return (
      scoreDifference ||
      left.provider.localeCompare(right.provider) ||
      left.model.localeCompare(right.model)
    );
  })[0]!;

  return {
    status: "selected",
    adapter,
    consideredAdapters: adapters.length,
    reasons: [
      `${adapter.displayName} supports ${request.capability.replaceAll("_", " ")}.`,
      `${adapter.privacyClass.replaceAll("_", " ")} processing satisfies the task privacy boundary.`,
      `${request.mode.replaceAll("_", " ")} mode ranked this adapter first among ${eligible.length} eligible option${eligible.length === 1 ? "" : "s"}.`,
    ],
    requiresApproval: false,
  };
}

function permitsPrivacy(
  maximum: AiPrivacyClass,
  actual: AiPrivacyClass,
): boolean {
  const exposure: Record<AiPrivacyClass, number> = {
    local: 0,
    private_cloud: 1,
    cloud: 2,
  };
  return exposure[actual] <= exposure[maximum];
}

function score(mode: AiMode, adapter: AiProviderAdapterDescriptor): number {
  const cost = { low: 0, medium: 1, high: 2 }[adapter.cost];
  const speed = { fast: 0, balanced: 1, thorough: 2 }[adapter.speed];
  const quality = { standard: 2, enhanced: 1, highest: 0 }[adapter.quality];
  const privacy = { local: 0, private_cloud: 1, cloud: 2 }[
    adapter.privacyClass
  ];
  switch (mode) {
    case "lower_cost":
      return cost * 100 + speed * 10 + quality;
    case "highest_quality":
      return quality * 100 + speed * 10 + cost;
    case "faster":
      return speed * 100 + cost * 10 + quality;
    case "private_local":
      return privacy * 100 + cost * 10 + quality;
    case "custom":
      return privacy * 100 + quality * 10 + cost;
    case "recommended":
      return quality * 30 + cost * 20 + speed * 10 + privacy;
  }
}
