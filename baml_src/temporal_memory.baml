class TemporalMemoryTextPart {
  kind string
  text string?
  role string?
}

class TemporalMemoryDigest {
  summary TemporalMemoryTextPart[]
  topics TemporalMemoryTextPart[][]
  openLoops TemporalMemoryTextPart[][]
}

class ConversationBoundary {
  relation string
  confidence float
  focus string
}

function ClassifyConversationBoundary(promptJson: string) -> ConversationBoundary {
  client SeneraActionPlannerPromptBuilder
  prompt #"
    {{ _.role("system") }}
    Classify whether one completed turn continues the open conversation segment.

    Requirements:
    - Return only ConversationBoundary.
    - relation must be exactly continue or boundary.
    - confidence must be between 0 and 1.
    - focus must be one short, source-grounded description of the active subject or intention after the decision.
    - For continue, update the prior focus; for boundary, describe only the candidate turn.
    - Follow the semantic criteria and physical evidence in the JSON user message.
    - Elapsed time and date changes are evidence, not automatic boundaries.
    - focus is classifier state, not a factual claim or final memory summary.
    - Do not explain or invent events.

    {{ ctx.output_format }}

    {{ _.role("user") }}
    {{ promptJson }}
  "#
}

function SummarizeTemporalMemory(promptJson: string) -> TemporalMemoryDigest {
  client SeneraActionPlannerPromptBuilder
  prompt #"
    {{ _.role("system") }}
    Produce one evidence-backed temporal memory digest.

    Requirements:
    - Return only TemporalMemoryDigest.
    - Follow every requirement in context embedded in the JSON user message.
    - summary, topics, and openLoops are ordered structured text. Use TemporalMemoryTextPart(kind=text, text=...) for prose and TemporalMemoryTextPart(kind=identity, role=user|resident) for conversation participants. Each topic and open loop is one inner parts array.
    - summary is concise, source-faithful, and written in the primary language of the entries.
    - topics contains concise retrieval labels.
    - openLoops contains only unresolved intentions, questions, or promised follow-up grounded in the entries.
    - Preserve concrete entities, dates, negation, uncertainty, modality, and outcomes.
    - Keep participant references as identity parts when consolidating child summaries. Do not encode identities as interpolation syntax, Liquid tags, filters, markdown, or other variables.
    - Do not invent events or output source references, explanations, markdown, XML, interpolation syntax, or chain-of-thought.

    {{ ctx.output_format }}

    {{ _.role("user") }}
    {{ promptJson }}
  "#
}
