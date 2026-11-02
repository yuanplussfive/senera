class StateCardRewrite {
  topicRelation "continue" | "new_topic"
  standaloneRequest string
  resumeRequestId string?
}

class MemOSFragment {
  topic string
  summary string
  type "fact" | "preference" | "relationship" | "context"
  assessments MemOSMemoryAssessment[]
  @@dynamic
}

class MemOSSkipDecision {
  action "skip"
  assessments MemOSMemoryAssessment[]
}

class MemOSMemoryAssessment {
  candidate int
  usefulness "helpful" | "unhelpful" | "unused" | "uncertain"
  reason string
}

class AuxiliarySummary {
  summary string
}

class MemoryRelevanceRecord {
  recordId int
  relevant bool
  score float
}

class MemoryRelevanceAssessment {
  records MemoryRelevanceRecord[]
}

class MemoryRetention {
  days int
}

function AssessMemoryRetention(promptJson: string) -> MemoryRetention {
  client SeneraActionPlannerPromptBuilder
  prompt #"
    {{ _.role("system") }}
    Return the requested memory retention in days.
    {{ ctx.output_format }}
    {{ _.role("user") }}
    {{ promptJson }}
  "#
}

function AssessMemoryRelevance(promptJson: string) -> MemoryRelevanceAssessment {
  client SeneraActionPlannerPromptBuilder
  prompt #"
    {{ _.role("system") }}
    Return the relevance assessment for every supplied memory reference.
    {{ ctx.output_format }}
    {{ _.role("user") }}
    {{ promptJson }}
  "#
}

function RewriteStateCard(promptJson: string) -> StateCardRewrite {
  client SeneraActionPlannerPromptBuilder
  prompt #"
    {{ _.role("system") }}
    Return only the requested structured result.
    {{ ctx.output_format }}
    {{ _.role("user") }}
    {{ promptJson }}
  "#
}

function ExtractMemOSFragment(promptJson: string) -> MemOSFragment | MemOSSkipDecision {
  client SeneraActionPlannerPromptBuilder
  prompt #"
    {{ _.role("system") }}
    Return only the requested structured memory.
    {{ ctx.output_format }}
    {{ _.role("user") }}
    {{ promptJson }}
  "#
}

class MemoryDiary {
  title string
  body string
}

function WriteMemoryDiary(promptJson: string) -> MemoryDiary {
  client SeneraActionPlannerPromptBuilder
  prompt #"
    {{ _.role("system") }}
    Return the requested diary title and complete Markdown body.
    {{ ctx.output_format }}
    {{ _.role("user") }}
    {{ promptJson }}
  "#
}

function CompressToolObservation(promptJson: string) -> AuxiliarySummary {
  client SeneraActionPlannerPromptBuilder
  prompt #"
    {{ _.role("system") }}
    Return only the grounded tool observation summary.
    {{ ctx.output_format }}
    {{ _.role("user") }}
    {{ promptJson }}
  "#
}

function SummarizePiContext(promptJson: string) -> AuxiliarySummary {
  client SeneraActionPlannerPromptBuilder
  prompt #"
    {{ _.role("system") }}
    Return the context summary required by the supplied compaction instructions.
    {{ ctx.output_format }}
    {{ _.role("user") }}
    {{ promptJson }}
  "#
}
