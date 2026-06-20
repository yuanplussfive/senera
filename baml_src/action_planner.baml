enum ToolCallStatus {
  Success
  Failure
  Empty
}

enum ExecutionDeltaOp {
  AddCall
  AddEvidence
  AddWarning
}

enum EvidenceVerificationStatus {
  Satisfied
  Partial
  Missing
  Blocked
}

class ToolCatalogItem {
  name string
  title string
  summary string
  capabilities ToolCapabilityItem[]
  tags string[]
  useCases string[]
  examples string[]
  avoid string[]
  permissions string[]
  evidenceCapabilities ToolEvidenceCapabilityItem[]
  loaded bool
}

class ToolEvidenceCapabilityItem {
  produces string
  quality string
  satisfies string[]
  kinds string[]
  capabilityIds string[]
}

class ToolCapabilityItem {
  id string
  title string
  description string
  facets ToolCapabilityFacets
  risk ToolCapabilityRisk?
}

class ToolCapabilityFacets {
  Actions string[]?
  Targets string[]?
  Inputs string[]?
  Outputs string[]?
  Evidence string[]?
  Effects string[]?
}

class ToolCapabilityRisk {
  sideEffect string?
  permission string?
}

class ActionRunState {
  currentStep int
  dynamicTools bool
  loadedTools string[]
  progress ProgressSignals
  warnings RepeatedCallWarning[]
  calls PlannerToolCallStateItem[]
}

class PlannerTimelineTurn {
  index int
  role string
  kind string
  step int?
  content string
  evidenceRefs string[]
  artifactUris string[]
}

class PlannerEvidenceMemoryItem {
  evidenceRef string
  kind string
  locator string
  display string
  label string
  toolName string
  artifactUri string
  facts EvidenceSlot[]
  artifactRefs string[]
}

class PlannerEvidenceStateItem {
  evidenceRef string
  kind string
  toolName string
  artifactUri string
  locator string
  display string
  label string
  source string?
  confidence float?
  facts EvidenceSlot[]
  artifactRefs string[]
}

class PlannerJournalItem {
  requestId string
  step int
  selectedAction string
  evidenceRefs string[]
  artifactUris string[]
  loadedTools string[]
  outcome string
}

class EvidenceSlot {
  name string
  value string
}

class RepeatedCallWarning {
  toolName string
  argsHash string
  count int
  lastStep int
}

class PlannerToolCallStateItem {
  step int
  toolName string
  status ToolCallStatus
  artifactUri string
  evidenceRefs string[]
  resultKind string
  argumentsPreview string
  error string
}

class ProgressSignals {
  totalToolCalls int
  totalEvidence int
  lastNewEvidenceStep int
  repeatedCallCount int
  stalled bool
}

class ActionPlanInput {
  runState ActionRunState
  timeline PlannerTimelineTurn[]
  evidenceMemory PlannerEvidenceMemoryItem[]
  evidenceState PlannerEvidenceStateItem[]
  plannerJournal PlannerJournalItem[]
  compactToolCatalog ToolCatalogSummaryItem[]
  toolCatalog ToolCatalogItem[]
  activeSkills PlannerActiveSkill[]
}

class ToolCatalogSummaryItem {
  name string
  title string
  summary string
  capabilities string[]
  evidence string[]
  effects string[]
  outputs string[]
  permissions string[]
  loaded bool
  rootKind string
}

class PlannerActiveSkill {
  name string
  title string
  summary string
  useCases string[]
  avoid string[]
  recommendedTools string[]
  evidenceRequirements PlannerEvidenceRequirement[]
}

class PlannerEvidenceRequirement {
  need string
  accepts string[]
  minimumQuality string[]
  minimum int
  purpose string
}

class TaskFrame {
  taskType string
  answerGoal string
  intentTags string[]
  targetRefs TaskTargetRef[]
  candidateTools TaskCandidateTool[]
  discoveryQueries string[]
  requiredEffects TaskRequiredEffect[]
  requiredEvidence TaskRequiredEvidence[]
  userInputNeeds TaskUserInputNeed[]
  nextStepPurpose string
  completionCriteria string[]
  notes string[]
}

class TaskCandidateTool {
  name string
  purpose string
  supports string[]
}

class TaskTargetRef {
  kind string
  value string
  status string
}

class TaskRequiredEffect {
  id string
  effect string
  target string
  proof string
  reason string
}

class TaskRequiredEvidence {
  id string
  need string
  minimum int
  reason string
}

class EvidenceVerification {
  ready bool
  requirements EvidenceRequirementVerification[]
  summary string
}

class EvidenceRequirementVerification {
  requirementId string
  need string
  status EvidenceVerificationStatus
  evidenceRefs string[]
  artifactUris string[]
  reason string
  missingFacts string[]
  unsupportedClaims string[]
}

class TaskUserInputNeed {
  question string
  reason string
}

client<llm> SeneraActionPlannerPromptBuilder {
  provider "openai-generic"
  options {
    base_url "https://example.invalid/v1"
    model "prompt-builder"
    temperature 0
  }
}

function BuildTaskFrame(promptJson: string) -> TaskFrame {
  client SeneraActionPlannerPromptBuilder
  prompt #"
    {{ _.role("system") }}
    Build Senera's task contract before the main agent runs.

    Requirements:
    - Return only TaskFrame.
    - Describe what the latest user_message is trying to accomplish as a completion contract.
    - intentTags are compact semantic tags for the task class, not tool names.
    - targetRefs identify concrete targets mentioned or implied by the latest request, such as workspace paths, uploads, URLs, entities, dates, or topics.
    - candidateTools lists possible tools that may help complete the contract; use only exact names from context.compactToolCatalog.
    - candidateTools is advisory, not permission to call a tool; runtime will validate availability and evidence/effect fit.
    - For candidateTools.supports, reuse vocabulary from compactToolCatalog capabilities/evidence/effects/outputs when it fits.
    - discoveryQueries lists concise natural-language or capability-oriented queries for dynamic tool discovery when selected candidate tools are not currently loaded.
    - Keep discoveryQueries empty only when no external tool discovery may be needed.
    - requiredEffects lists side effects that must really happen before the task may be called complete.
    - requiredEvidence lists user-facing claims or observations that must be verified before answering or proving effects happened.
    - Every requiredEffects item and requiredEvidence item must have a stable id that is unique within the TaskFrame.
    - Preserve requirement ids during repair unless an id is empty or duplicated.
    - Do not invent evidence type names, proof strings, source labels, or tool-specific acceptance vocabulary.
    - Use compactToolCatalog for possible tool planning; use toolCatalog only for precise evidence/effect vocabulary.
    - Use activeSkills only as workflow guidance, not as a source of tool availability.
    - nextStepPurpose states the next runtime purpose in one concise sentence.
    - completionCriteria are user-visible completion checks the runtime can compare with evidence.
    - If essential user information is missing and cannot be inferred from the latest request, put concise user-facing questions in userInputNeeds.
    - If no external evidence or side effect is needed, requiredEvidence and requiredEffects may be empty.
    - Search matches, snippets, and cached candidates are not enough for source-of-truth conclusions unless an active skill explicitly accepts that evidence type.
    - Do not produce action, tool names, final answer text, confidence, or chain-of-thought.
    - Read the planner input from the JSON object in the user message.
    - The JSON object has context.timeline, context.runState, context.compactToolCatalog, context.toolCatalog, context.evidenceMemory, context.evidenceState, context.plannerJournal, context.activeSkills, and directive.
    - The directive.stage is buildTaskFrame.

    {{ ctx.output_format }}

    {{ _.role("user") }}
    {{ promptJson }}
  "#
}

function VerifyTaskEvidence(promptJson: string) -> EvidenceVerification {
  client SeneraActionPlannerPromptBuilder
  prompt #"
    {{ _.role("system") }}
    Verify whether Senera's available evidence satisfies the task contract.

    Requirements:
    - Return only EvidenceVerification.
    - Verify every item in context.verificationRequirements.
    - Copy requirementId exactly from context.verificationRequirements[].id.
    - Treat evidence requirements as claims that must be supported by evidence cards.
    - Treat effect requirements as completed only when evidence cards show the effect happened.
    - Use only evidence cards in evidenceState as factual observations.
    - Use evidenceCatalog only to understand what each evidence kind means; do not treat catalog entries as observed facts.
    - Search candidates, workspace maps, and cached candidates are navigation evidence unless an evidence card's facts directly support the required claim.
    - A requirement is Satisfied only when the cited evidenceRefs directly support the claim and target.
    - A requirement is Partial when cited evidence helps but does not fully answer the claim.
    - A requirement is Missing when no cited evidence supports the claim.
    - A requirement is Blocked when recent tool calls show the same target cannot currently produce evidence.
    - Do not cite evidenceRefs or artifactUris that are absent from evidenceState.
    - Keep reason concise and user-visible.
    - Put missing concrete facts in missingFacts.
    - Put unsupported proposed conclusions in unsupportedClaims.
    - ready is true only if every verification requirement is Satisfied.
    - Read verifier input from the JSON object in the user message.
    - The directive.stage is verifyTaskEvidence.

    {{ ctx.output_format }}

    {{ _.role("user") }}
    {{ promptJson }}
  "#
}

function RepairTaskFrame(promptJson: string) -> TaskFrame {
  client SeneraActionPlannerPromptBuilder
  prompt #"
    {{ _.role("system") }}
    Repair Senera's task contract. Return exactly one valid TaskFrame.

    Requirements:
    - Preserve the latest user intent.
    - Fix all validation issues.
    - Return only TaskFrame.
    - Do not explain the repair.
    - Read the planner input from the JSON object in the user message.
    - The directive.stage is repairTaskFrame and contains invalid output plus validation issues.

    {{ ctx.output_format }}

    {{ _.role("user") }}
    {{ promptJson }}
  "#
}

