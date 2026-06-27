class ToolLearningRecord {
  toolName string
  tags string[]
  sourceTerms string[]
  triggers string[]
  reason string
  confidence float
}

class ToolLearningResult {
  records ToolLearningRecord[]
}

function LearnToolUse(promptJson: string) -> ToolLearningResult {
  client SeneraActionPlannerPromptBuilder
  prompt #"
    {{ _.role("system") }}
    Learn compact Senera tool-use triggers from a successful completed tool-search episode.

    Requirements:
    - Return only ToolLearningResult.
    - Output one ToolLearningRecord per selected tool that should be reinforced.
    - Use only exact tool names from plannerInput.selectedTools.
    - tags must contain only exact tag strings allowed for that same tool in plannerInput.toolTagCatalogByTool.
    - sourceTerms must contain only exact strings from plannerInput.candidateSourceTerms.
    - sourceTerms are compact source words from the standalone request that explain why the selected tool was relevant.
    - triggers are short natural-language user expressions that would justify this tool next time.
    - Learn from plannerInput.standaloneRequest, not from raw follow-up wording.
    - Do not copy parameter names, evidence labels, URLs, long titles, IDs, file paths, or provider internals as triggers.
    - Do not put generic politeness, filler, or function words in sourceTerms.
    - Do not learn from failed, canceled, repaired-failed, or inconclusive episodes.
    - Keep each trigger concise and user-like.
    - reason must be one concise sentence.
    - confidence must be between 0 and 1.
    - Return records as an empty array when the episode has no reusable tool-use lesson.
    - Read plannerInput from the latest user JSON object's plannerInput property.
    - plannerInput.directive.stage is learnToolUse.

    {{ ctx.output_format }}

    {{ _.role("user") }}
    {{ promptJson }}
  "#
}

function RepairToolLearning(promptJson: string) -> ToolLearningResult {
  client SeneraActionPlannerPromptBuilder
  prompt #"
    {{ _.role("system") }}
    Repair Senera tool learning output.

    Requirements:
    - Return only ToolLearningResult.
    - Fix every issue in plannerInput.directive.issues.
    - Use only exact tool names and exact per-tool tags from plannerInput.toolTagCatalogByTool.
    - Use only exact sourceTerms from plannerInput.candidateSourceTerms.
    - Remove invalid records rather than inventing unsupported tags.
    - Do not output explanations, markdown, XML, or chain-of-thought.
    - Read plannerInput from the latest user JSON object's plannerInput property.
    - plannerInput.directive.stage is repairToolLearning.

    {{ ctx.output_format }}

    {{ _.role("user") }}
    {{ promptJson }}
  "#
}
