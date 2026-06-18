enum ActionKind {
  Answer
  AskUser
  DiscoverTools
  UseTools
}

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
  loaded bool
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
  confidence float
  toolName string
  artifactUri string
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
  plannerJournal PlannerJournalItem[]
  toolCatalog ToolCatalogItem[]
}

class ActionSelection {
  action ActionKind
}

class ActionDecision {
  action ActionKind
  askUser AskUserActionPayload?
  useTools UseToolsActionPayload?
  discoverTools DiscoverToolsActionPayload?
}

class AskUserActionPayload {
  question string
  reason string?
}

class UseToolsActionPayload {
  preferredTools string[]
  instruction string
}

class DiscoverToolsActionPayload {
  queries string[]
  needs CapabilityNeed[]
}

class CapabilityNeed {
  actions string[]?
  targets string[]?
  inputs string[]?
  outputs string[]?
  evidence string[]?
  effects string[]?
}

client<llm> SeneraActionPlannerPromptBuilder {
  provider "openai-generic"
  options {
    base_url "https://example.invalid/v1"
    model "prompt-builder"
    temperature 0
  }
}

function SelectAction(promptJson: string) -> ActionSelection {
  client SeneraActionPlannerPromptBuilder
  prompt #"
    {{ _.role("system") }}
    You are Senera's action selector. Decide only the next execution action before the main agent runs.

    Authority:
    - Return only ActionSelection.action.
    - Do not produce action payload, explanation, confidence, tags, tool arguments, or final answer text.
    - Current visible tools may be only a subset of all registered tools.
    - If the task needs hidden capabilities, choose DiscoverTools and describe the needed capabilities.

    Action semantics:
    - Answer: let the main agent respond from the timeline without tools.
    - AskUser: blocked by missing essential user information.
    - DiscoverTools: current loaded tools are insufficient and dynamic tools can search the catalog.
    - UseTools: suitable loaded tools are already available and should be used by the main agent.

    Decision rules:
    - Treat the timeline below as the chronological conversation and observation stream.
    - Use user turns for the user's actual requests and constraints.
    - Use assistant turns for prior assistant decisions or answers.
    - Use tool_observation/read_only_evidence turns as completed evidence from tools.
    - Use evidenceMemory as the compact cross-request evidence card store.
    - Use plannerJournal as planner control history, not as user-provided facts.
    - Use runState only for execution control signals such as step, loaded tools, progress, and repeated-call warnings.
    - Do not treat runState as factual evidence beyond those control signals.
    - If timeline or evidenceMemory already contains enough fresh evidence facts to answer the latest user_message turn, choose Answer.
    - Prefer evidenceMemory over new tools when its display, locator, and facts contain the same factual target requested by the user.
    - If runState shows repeated calls or stalled progress, avoid more tools unless the selected payload names a concrete missing fact.
    - Do not claim a file, URL, fact, or tool result was observed unless it appears in the timeline.
    - Choose UseTools only when the current catalog and timeline show that a concrete missing fact requires a tool.
    - For vague requests that still require inspection, prefer DiscoverTools only when current loaded tools cannot perform the next concrete step.
    - For normal conversation or explanation that does not require external state, use Answer.
    - When a task needs evidence, choose tools by matching the task to toolCatalog capabilities first, then summary/useCases/examples.
    - Use PascalCase enum values exactly as defined.
    - Read the planner input from the JSON object in the user message.
    - The JSON object has context.timeline, context.runState, context.toolCatalog, context.evidenceMemory, context.plannerJournal, and directive.
    - The directive.stage is selectAction for this function.

    {{ ctx.output_format }}

    {{ _.role("user") }}
    {{ promptJson }}
  "#
}

function RepairActionSelection(promptJson: string) -> ActionSelection {
  client SeneraActionPlannerPromptBuilder
  prompt #"
    {{ _.role("system") }}
    Repair Senera's action selector output. Return exactly one valid ActionSelection.

    Requirements:
    - Preserve the original user intent.
    - Fix all validation issues.
    - Return only action.
    - Do not explain the repair.
    - Use PascalCase enum values exactly as defined.
    - Read the planner input from the JSON object in the user message.
    - The JSON object has context.timeline, context.runState, context.toolCatalog, context.evidenceMemory, context.plannerJournal, and directive.
    - The directive.stage is repairActionSelection and contains the invalid output plus validation issues.

    {{ ctx.output_format }}

    {{ _.role("user") }}
    {{ promptJson }}
  "#
}

function BuildActionPayload(promptJson: string) -> ActionDecision {
  client SeneraActionPlannerPromptBuilder
  prompt #"
    {{ _.role("system") }}
    Build Senera's payload for one already-selected action from the same chronological context used by action selection.

    Requirements:
    - Return exactly one valid ActionDecision.
    - Keep action exactly equal to selectedAction.
    - Answer does not need this payload-building stage; if selectedAction is Answer, return only action Answer and no payload fields.
    - For AskUser, UseTools, and DiscoverTools, provide exactly one payload field and it must match selectedAction.
    - If selectedAction is AskUser, set only askUser.question and optional askUser.reason.
    - If selectedAction is UseTools, set only useTools.preferredTools and useTools.instruction.
    - If selectedAction is DiscoverTools, set only discoverTools.queries and discoverTools.needs.
    - Read selectedAction from directive.selectedAction.
    - For UseTools, use only currently loaded tool names from context.runState.loadedTools.
    - For DiscoverTools, describe capability needs using compact facets from context.toolCatalog when useful.
    - Treat plannerJournal as planner control history, not as user-provided facts.
    - Do not put debug text, confidence, progress assessment, or chain-of-thought in the payload.
    - Use PascalCase enum values exactly as defined.
    - Read the planner input from the JSON object in the user message.
    - The JSON object has context.timeline, context.runState, context.toolCatalog, context.evidenceMemory, context.plannerJournal, and directive.
    - The directive.stage is buildActionPayload for this function.

    {{ ctx.output_format }}

    {{ _.role("user") }}
    {{ promptJson }}
  "#
}

function RepairActionPayload(promptJson: string) -> ActionDecision {
  client SeneraActionPlannerPromptBuilder
  prompt #"
    {{ _.role("system") }}
    Repair Senera's action payload. Return exactly one valid ActionDecision.

    Requirements:
    - Keep action exactly equal to directive.selectedAction.
    - Fix all validation issues.
    - Answer does not need a payload; if selectedAction is Answer, return only action Answer and no payload fields.
    - For AskUser, UseTools, and DiscoverTools, provide exactly one payload field and it must match selectedAction.
    - If selectedAction is AskUser, askUser.question must contain the user-visible question.
    - If selectedAction is UseTools, useTools.preferredTools and useTools.instruction must be present.
    - If selectedAction is DiscoverTools, discoverTools.queries and discoverTools.needs must be present.
    - Do not explain the repair.
    - For UseTools, use only currently loaded tool names from context.runState.loadedTools.
    - Use PascalCase enum values exactly as defined.
    - Read the planner input from the JSON object in the user message.
    - The JSON object has context.timeline, context.runState, context.toolCatalog, context.evidenceMemory, context.plannerJournal, and directive.
    - The directive.stage is repairActionPayload and contains selectedAction, invalid output, and validation issues.

    {{ ctx.output_format }}

    {{ _.role("user") }}
    {{ promptJson }}
  "#
}
