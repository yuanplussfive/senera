class FastContextScoutCommand {
  type string
  pattern string?
  path string?
  include string[]?
  exclude string[]?
  regex bool?
  caseSensitive bool?
  startLine int?
  endLine int?
  depth int?
}

class FastContextScoutFileSelection {
  path string
  startLine int
  endLine int
  reason string
}

class FastContextScoutPlannerDecision {
  action string
  commands FastContextScoutCommand[]
  files FastContextScoutFileSelection[]
  reason string
}

function PlanFastContextScout(promptJson: string) -> FastContextScoutPlannerDecision {
  client SeneraActionPlannerPromptBuilder
  prompt #"
    {{ _.role("system") }}
    You are Senera's local workspace context scout planner.

    Requirements:
    - Return only FastContextScoutPlannerDecision.
    - action must be commands or final.
    - Use commands when more local evidence is needed.
    - When action is commands, commands must contain at least one command and files should be empty.
    - Use final when enough file paths and line ranges are known.
    - When action is final, files must contain at least one supported file selection and commands should be empty.
    - commands may only use command types declared in plannerInput.allowedCommands.
    - Never output shell commands.
    - Paths must be workspace-relative or start with /codebase/.
    - Keep commands targeted and within plannerInput.commandBudget.
    - Read plannerInput from the latest user JSON object's plannerInput property.

    {{ ctx.output_format }}

    {{ _.role("user") }}
    {{ promptJson }}
  "#
}

function RepairFastContextScoutPlan(promptJson: string) -> FastContextScoutPlannerDecision {
  client SeneraActionPlannerPromptBuilder
  prompt #"
    {{ _.role("system") }}
    Repair Senera's local workspace context scout planner output.

    Requirements:
    - Return only FastContextScoutPlannerDecision.
    - Preserve plannerInput.directive.invalidDecision intent when possible.
    - Fix every issue listed in plannerInput.directive.issues.
    - action must be commands or final.
    - When action is commands, commands must contain at least one command and files should be empty.
    - When action is final, files must contain at least one supported file selection and commands should be empty.
    - commands may only use command types declared in plannerInput.allowedCommands.
    - Never output shell commands, prose, markdown, XML, or comments.
    - Paths must be workspace-relative or start with /codebase/.
    - Do not invent files that are not supported by plannerInput observations or deterministicCandidates.
    - Read plannerInput from the latest user JSON object's plannerInput property.

    {{ ctx.output_format }}

    {{ _.role("user") }}
    {{ promptJson }}
  "#
}
