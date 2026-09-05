class TemporalMemoryDigest {
  summary string
  topics string[]
  openLoops string[]
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
    - summary is concise, source-faithful, and written in the primary language of the entries.
    - topics contains concise retrieval labels.
    - openLoops contains only unresolved intentions, questions, or promised follow-up grounded in the entries.
    - Preserve concrete entities, dates, negation, uncertainty, modality, and outcomes.
    - Use the literal user placeholder (two curly braces around user) and resident placeholder (two curly braces around resident) for conversation participants instead of display names, and preserve them when consolidating child summaries.
    - The user placeholder means the user and the resident placeholder means the resident persona. Do not use a bot placeholder, Liquid tags, filters, or other variables.
    - Do not invent events or output source references, explanations, markdown, XML, or chain-of-thought.

    {{ ctx.output_format }}

    {{ _.role("user") }}
    {{ promptJson }}
  "#
}
