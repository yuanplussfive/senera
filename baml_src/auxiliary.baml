class StateCardRewrite {
  topicRelation "continue" | "new_topic"
  standaloneRequest string
}

class MemOSFragment {
  topic string
  summary string
  type "fact" | "preference" | "relationship" | "context" | "entity" | "custom"
  @@dynamic
}

class AuxiliarySummary {
  summary string
}

class AuxiliaryImageAnalysis {
  analysis string
}

class ChannelTextPart {
  kind "text"
  text string
}

class ChannelResourcePart {
  kind "resource"
  uri string
  alt string?
  mediaKind "image" | "video" | "audio" | "file"?
  mime string?
  fileName string?
}

class ChannelCodePart {
  kind "code"
  language string?
  code string
}

class ChannelDelivery {
  parts (ChannelTextPart | ChannelResourcePart | ChannelCodePart)[]
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

function ExtractMemOSFragment(promptJson: string) -> MemOSFragment {
  client SeneraActionPlannerPromptBuilder
  prompt #"
    {{ _.role("system") }}
    Return only the requested structured memory.
    {{ ctx.output_format }}
    {{ _.role("user") }}
    {{ promptJson }}
  "#
}

function SummarizeMemOSPeriod(promptJson: string) -> AuxiliarySummary {
  client SeneraActionPlannerPromptBuilder
  prompt #"
    {{ _.role("system") }}
    Return only the requested period summary.
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

function ChannelFinalDelivery(promptJson: string) -> ChannelDelivery {
  client SeneraActionPlannerPromptBuilder
  prompt #"
    {{ _.role("system") }}
    Return the ordered channel parts, preserving the supplied answer and resource manifest.
    {{ ctx.output_format }}
    {{ _.role("user") }}
    {{ promptJson }}
  "#
}

function AnalyzeImage(promptJson: string) -> AuxiliaryImageAnalysis {
  client SeneraActionPlannerPromptBuilder
  prompt #"
    {{ _.role("system") }}
    Analyze the supplied image evidence for the request. Return only the grounded analysis.
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
