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
  tags string[]
  useCases string[]
  examples string[]
  avoid string[]
  permissions string[]
  loaded bool
}

class ActionTask {
  userMessage string
}

class ActionRuntime {
  currentStep int
  dynamicTools bool
  loadedTools string[]
}

class PlannerHistoryTurn {
  index int
  role string
  kind string
  content string
}

class ToolCallRecord {
  step int
  toolName string
  argsHash string
  status ToolCallStatus
  artifactId string
  evidenceKeys string[]
  error string
}

class EvidenceRecord {
  key string
  kind string
  label string
  artifactId string
  source string
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

class ExecutionState {
  calls ToolCallRecord[]
  evidence EvidenceRecord[]
  warnings RepeatedCallWarning[]
  progress ProgressSignals
}

class ExecutionDelta {
  step int
  op ExecutionDeltaOp
  key string
  toolName string
  argsHash string
  status ToolCallStatus
  artifactId string
  evidenceKeys string[]
  note string
}

class ActionPlanInput {
  task ActionTask
  runtime ActionRuntime
  history PlannerHistoryTurn[]
  executionState ExecutionState
  recentDeltas ExecutionDelta[]
  toolCatalog ToolCatalogItem[]
}

class ActionDecision {
  action ActionKind
  intent string
  progressAssessment string
  nextStepGoal string
  requiredCapabilities string[]
  tags string[]
  toolSearchQueries string[]
  preferredTools string[]
  confidence float
  instructionToMainModel string
}

client<llm> SeneraActionPlannerDefault {
  provider "openai-generic"
  options {
    base_url "https://api.openai.com/v1"
    api_key env.OPENAI_API_KEY
    model "gpt-4.1-mini"
    temperature 0.1
  }
}

function PlanAction(input: ActionPlanInput) -> ActionDecision {
  client SeneraActionPlannerDefault
  prompt #"
    {{ _.role("system") }}
    You are Senera's action planner. Decide the next execution action before the main agent runs.

    Authority:
    - This planner produces an execution directive, not a user-facing answer.
    - Current visible tools may be only a subset of all registered tools.
    - If the task needs hidden capabilities, choose DiscoverTools or name exact catalog tools in preferredTools.
    - Do not invent tool names. Only use preferredTools from loaded tools or catalog items with strong evidence.
    - Use tags as compact routing hints derived from the task and the visible tool catalog metadata.

    Action semantics:
    - Answer: the main agent can answer directly without tools.
    - AskUser: the task is blocked by missing essential user information.
    - DiscoverTools: dynamic tools are enabled and current loaded tools are insufficient.
    - UseTools: suitable loaded tools are already available and should be used by the main agent.

    Decision rules:
    - Treat history as sanitized conversation memory. Use it to preserve user constraints, prior assistant answers, and completed tool observations.
    - Use executionState and recentDeltas as the source of progress truth.
    - If history plus executionState already contains enough evidence to answer the user, choose Answer.
    - If recentDeltas show repeated calls or stalled progress, avoid more tools unless nextStepGoal names a concrete missing fact.
    - Do not claim a file, URL, fact, or tool result was observed unless it appears in history or executionState.
    - Extract compact tags from the task even when the user does not explicitly name a tool.
    - Prefer exact tags already present in toolCatalog.tags. Add only short user-intent tags when no catalog tag fits.
    - Choose UseTools only when the current catalog and executionState show that a concrete missing fact requires a tool.
    - For vague requests that still require inspection, prefer DiscoverTools only when current loaded tools cannot perform the next concrete step.
    - For normal conversation or explanation that does not require external state, use Answer.
    - When a task needs evidence, choose tools by matching the task to toolCatalog metadata.
    - progressAssessment must state whether the current evidence is enough, insufficient, repeated, or blocked.
    - nextStepGoal must be concrete. If action is Answer, use a final-answer goal.
    - Tool search queries should combine user terms with the strongest catalog-aligned tags.
    - Keep instructionToMainModel short, imperative, and directly actionable.
    - Use PascalCase enum values exactly as defined.

    {{ ctx.output_format }}

    {{ _.role("user") }}
    Task:
    {{ input.task }}

    {{ _.role("user") }}
    Runtime:
    {{ input.runtime }}

    {{ _.role("user") }}
    Sanitized conversation and run history:
    {{ input.history }}

    {{ _.role("user") }}
    Execution state:
    {{ input.executionState }}

    {{ _.role("user") }}
    Recent state deltas:
    {{ input.recentDeltas }}

    {{ _.role("user") }}
    Visible tool catalog:
    {{ input.toolCatalog }}
  "#
}

function RepairActionDecision(input: ActionPlanInput, invalidDecision: string, issues: string[]) -> ActionDecision {
  client SeneraActionPlannerDefault
  prompt #"
    {{ _.role("system") }}
    Repair Senera's action planner output. Return exactly one valid ActionDecision.

    Requirements:
    - Preserve the original user intent.
    - Fix all validation issues.
    - Do not explain the repair.
    - Use PascalCase enum values exactly as defined.

    {{ ctx.output_format }}

    {{ _.role("user") }}
    Runtime input:
    {{ input }}

    Invalid output:
    {{ invalidDecision }}

    Validation issues:
    {{ issues }}

    {{ ctx.output_format }}
  "#
}
