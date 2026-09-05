type ContinuityScalar = string | int | float | bool

class ContinuityCaptureItem {
  kind string
  text string?
  key string?
  value ContinuityScalar?
  from string?
  relation string?
  to string?
}

class ContinuityAgendaDraft {
  kind string
  change string
  actor string
  summary string
  timeText string?
  relatesTo string?
}

class ContinuityCapture {
  items ContinuityCaptureItem[]
  agenda ContinuityAgendaDraft[]
  needsRulePass bool
}

class ContinuityRuleItem {
  kind string
  title string
  target string?
  replace bool?
  value ContinuityScalar?
  when map<string, ContinuityScalar>?
  at string?
  match string?
  threshold float?
  effect string?
  until string
}

class ContinuityRuleExtractionResult {
  items ContinuityRuleItem[]
}

function ExtractContinuityFacts(stablePrompt: string, promptJson: string) -> ContinuityCapture {
  client SeneraActionPlannerPromptBuilder
  prompt #"
    {{ _.role("system") }}
    {{ stablePrompt }}

    {{ ctx.output_format }}

    {{ _.role("user") }}
    {{ promptJson }}
  "#
}

function RepairContinuityFacts(stablePrompt: string, promptJson: string) -> ContinuityCapture {
  client SeneraActionPlannerPromptBuilder
  prompt #"
    {{ _.role("system") }}
    {{ stablePrompt }}

    Repair protocol: read directive from the JSON user message and fix every listed issue without changing the semantic contract.

    {{ ctx.output_format }}

    {{ _.role("user") }}
    {{ promptJson }}
  "#
}

function ExtractContinuityRules(stablePrompt: string, promptJson: string) -> ContinuityRuleExtractionResult {
  client SeneraActionPlannerPromptBuilder
  prompt #"
    {{ _.role("system") }}
    {{ stablePrompt }}

    {{ ctx.output_format }}

    {{ _.role("user") }}
    {{ promptJson }}
  "#
}

function RepairContinuityRules(stablePrompt: string, promptJson: string) -> ContinuityRuleExtractionResult {
  client SeneraActionPlannerPromptBuilder
  prompt #"
    {{ _.role("system") }}
    {{ stablePrompt }}

    Repair protocol: read directive from the JSON user message and fix every listed issue without changing the semantic contract.

    {{ ctx.output_format }}

    {{ _.role("user") }}
    {{ promptJson }}
  "#
}
