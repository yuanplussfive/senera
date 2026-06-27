class MemoryCandidate {
  type string
  subject string
  claim string
  howToApply string
  tags string[]
  triggers string[]
  sourceRefs string[]
  reason string
  confidence float
}

class MemoryLearningResult {
  candidates MemoryCandidate[]
}

class MemoryConsolidationAction {
  operation string
  type string
  subject string
  claim string
  howToApply string
  tags string[]
  triggers string[]
  sourceRefs string[]
  candidateUris string[]
  targetMemoryUri string?
  reason string
  confidence float
}

class MemoryConsolidationResult {
  actions MemoryConsolidationAction[]
}

class MemoryWriteDecision {
  operation string
  type string
  subject string
  claim string
  howToApply string
  tags string[]
  triggers string[]
  sourceRefs string[]
  candidateUris string[]
  targetMemoryUri string?
  reason string
  confidence float
}

class MemoryWriteResolutionResult {
  decision MemoryWriteDecision
}

function LearnMemory(promptJson: string) -> MemoryLearningResult {
  client SeneraActionPlannerPromptBuilder
  prompt #"
    {{ _.role("system") }}
    Extract durable memory candidates from a completed Senera conversation episode.

    Requirements:
    - Return only MemoryLearningResult.
    - Read plannerInput from the latest user JSON object's plannerInput property.
    - Prior user and assistant messages are JSON memory timeline cards. Read turn.role, turn.kind, and turn.payload as the completed episode timeline.
    - plannerInput.directive.stage is learnMemory.
    - Output candidates, not final long-term memory items.
    - Use plannerInput.episode.standaloneRequest as the resolved user request.
    - Candidate type must be one exact value from plannerInput.memoryTypes.
    - Learn only potentially durable facts that may remain useful across future turns: user profile, user preference, reusable knowledge, or scene/character state.
    - Do not learn one-off tasks, temporary tool outputs, transient progress, generic greetings, or facts directly recoverable from ordinary workspace files.
    - sourceRefs must contain exact values from plannerInput.supportingSourceRefs that directly support the candidate.
    - plannerInput.contextSourceRefs and timeline cards with memoryRole=context are context only.
    - Assistant timeline cards are Senera's own prior output. Use them to understand what happened, but do not cite them as sourceRefs or turn them into user knowledge.
    - Every candidate must cite at least one sourceRef.
    - claim must be a concrete statement, not a question, plan, or speculation.
    - howToApply explains how Senera should use the candidate later.
    - tags are concise user-facing categories in the same language as the source when possible.
    - triggers are short natural user expressions that should recall this candidate later.
    - confidence must be between 0 and 1.
    - Return candidates as an empty array when there is no potentially durable memory worth considering.
    - Do not output explanations, markdown, XML, or chain-of-thought.

    {{ ctx.output_format }}

    {{ _.role("user") }}
    {{ promptJson }}
  "#
}

function RepairMemoryLearning(promptJson: string) -> MemoryLearningResult {
  client SeneraActionPlannerPromptBuilder
  prompt #"
    {{ _.role("system") }}
    Repair Senera memory candidate extraction output.

    Requirements:
    - Return only MemoryLearningResult.
    - Read plannerInput from the latest user JSON object's plannerInput property.
    - Prior user and assistant messages are JSON memory timeline cards. Read turn.role, turn.kind, and turn.payload as the completed episode timeline.
    - plannerInput.directive.stage is repairMemoryLearning.
    - Fix every issue in plannerInput.directive.issues.
    - Preserve supported durable candidates from the invalid output.
    - Remove unsupported candidates instead of inventing new sourceRefs or memory types.
    - type must be one exact value from plannerInput.memoryTypes.
    - sourceRefs must contain exact values from plannerInput.supportingSourceRefs.
    - plannerInput.contextSourceRefs and assistant timeline cards are context only.
    - Return candidates as an empty array if the invalid output cannot be repaired from the provided sources.
    - Do not output explanations, markdown, XML, or chain-of-thought.

    {{ ctx.output_format }}

    {{ _.role("user") }}
    {{ promptJson }}
  "#
}

function ConsolidateMemoryCandidates(promptJson: string) -> MemoryConsolidationResult {
  client SeneraActionPlannerPromptBuilder
  prompt #"
    {{ _.role("system") }}
    Consolidate a cluster of similar Senera memory candidates into durable long-term memory actions.

    Requirements:
    - Return only MemoryConsolidationResult.
    - Read plannerInput from the latest user JSON object's plannerInput property.
    - plannerInput.directive.stage is consolidateMemoryCandidates.
    - Candidate type must be one exact value from plannerInput.memoryTypes.
    - candidateUris must contain only exact uri values from plannerInput.candidates.
    - sourceRefs must contain only sourceRefs already attached to the selected candidateUris.
    - operation must be create, reinforce, update, supersede, or reject.
    - Use create when the cluster expresses a new durable memory.
    - Use reinforce when the cluster repeats an existing memory without materially changing it.
    - Use update only when targetMemoryUri exactly names an existing memory that should be refined without changing meaning.
    - Use supersede only when targetMemoryUri exactly names an existing memory that the new claim replaces.
    - Use reject when the cluster should not become durable memory.
    - For reinforce, update, and supersede, targetMemoryUri must be one exact uri from plannerInput.existingMemories.
    - Return actions as an empty array when the cluster is weak, contradictory, too temporary, or not useful as long-term memory.
    - Prefer one concise action per coherent cluster.
    - claim must represent the repeated or clearly supported meaning of the candidate cluster.
    - howToApply explains how Senera should use the memory later.
    - confidence must reflect source support, consistency, and durability.
    - Do not output explanations, markdown, XML, or chain-of-thought.

    {{ ctx.output_format }}

    {{ _.role("user") }}
    {{ promptJson }}
  "#
}

function ResolveMemoryWrite(promptJson: string) -> MemoryWriteResolutionResult {
  client SeneraActionPlannerPromptBuilder
  prompt #"
    {{ _.role("system") }}
    Resolve a proposed Senera long-term memory write against active memories.

    Requirements:
    - Return only MemoryWriteResolutionResult.
    - Read plannerInput from the latest user JSON object's plannerInput property.
    - plannerInput.directive.stage is resolveMemoryWrite.
    - operation must be one exact value from plannerInput.allowedOperations.
    - type must be one exact value from plannerInput.memoryTypes.
    - sourceRefs must contain only exact values from plannerInput.proposed.sourceRefs.
    - candidateUris must contain only exact values from plannerInput.proposed.candidateUris.
    - targetMemoryUri must be empty for create and reject.
    - targetMemoryUri must be one exact uri from plannerInput.similarMemories for reinforce, update, and supersede.
    - Use create only when the proposed memory is not already captured by any similar active memory.
    - Use reinforce when the proposed memory has the same durable meaning as an active memory and only adds another supporting observation.
    - Use update when the proposed memory keeps the same durable meaning but adds materially useful detail.
    - Use supersede when the proposed memory conflicts with and should replace an active memory.
    - Use reject when the proposed memory is not durable, is unsupported by sourceRefs, or is Senera's own output rather than user-provided memory.
    - For reinforce, preserve the existing memory's core claim unless the proposed text is strictly clearer without changing meaning.
    - For update and supersede, produce the best concise memory item text after applying the new information.
    - confidence must be between 0 and 1.
    - Do not output explanations, markdown, XML, or chain-of-thought.

    {{ ctx.output_format }}

    {{ _.role("user") }}
    {{ promptJson }}
  "#
}

function RepairMemoryWriteResolution(promptJson: string) -> MemoryWriteResolutionResult {
  client SeneraActionPlannerPromptBuilder
  prompt #"
    {{ _.role("system") }}
    Repair a Senera long-term memory write resolution.

    Requirements:
    - Return only MemoryWriteResolutionResult.
    - Read plannerInput from the latest user JSON object's plannerInput property.
    - plannerInput.directive.stage is repairMemoryWriteResolution.
    - Fix every issue in plannerInput.directive.issues.
    - operation must be one exact value from plannerInput.allowedOperations.
    - type must be one exact value from plannerInput.memoryTypes.
    - sourceRefs must contain only exact values from plannerInput.proposed.sourceRefs.
    - candidateUris must contain only exact values from plannerInput.proposed.candidateUris.
    - targetMemoryUri must be empty for create and reject.
    - targetMemoryUri must be one exact uri from plannerInput.similarMemories for reinforce, update, and supersede.
    - Prefer reject over inventing unsupported sourceRefs, candidateUris, or targetMemoryUri values.
    - Do not output explanations, markdown, XML, or chain-of-thought.

    {{ ctx.output_format }}

    {{ _.role("user") }}
    {{ promptJson }}
  "#
}

function RepairMemoryConsolidation(promptJson: string) -> MemoryConsolidationResult {
  client SeneraActionPlannerPromptBuilder
  prompt #"
    {{ _.role("system") }}
    Repair Senera memory consolidation output.

    Requirements:
    - Return only MemoryConsolidationResult.
    - Read plannerInput from the latest user JSON object's plannerInput property.
    - plannerInput.directive.stage is repairMemoryConsolidation.
    - Fix every issue in plannerInput.directive.issues.
    - Preserve supported actions from the invalid output.
    - Remove unsupported actions instead of inventing candidateUris, sourceRefs, memory types, or targetMemoryUri values.
    - candidateUris must contain only exact uri values from plannerInput.candidates.
    - sourceRefs must contain only sourceRefs from selected candidateUris.
    - For reinforce, update, and supersede, targetMemoryUri must be one exact uri from plannerInput.existingMemories.
    - Return actions as an empty array if the invalid output cannot be repaired from the provided context.
    - Do not output explanations, markdown, XML, or chain-of-thought.

    {{ ctx.output_format }}

    {{ _.role("user") }}
    {{ promptJson }}
  "#
}
