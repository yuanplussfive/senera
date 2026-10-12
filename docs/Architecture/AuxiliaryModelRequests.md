# Auxiliary model requests

Auxiliary model features provide a domain prompt and a strict output contract to `AgentStructuredModelClient`. StateCard resolution, MemOS fragment reconciliation, day/month summaries, tool observation summaries, channel serialization, image analysis and MCP image sampling use this path.

In native mode the client generates the Pi tool schema from Zod and requires exactly one named tool call. Repairs retain that required selection. Ordinary text is never accepted as a replacement tool call. In BAML mode the generated BAML function renders the output contract locally; Pi performs the supplier request, and the generated BAML parser validates its output against the same domain schema. MemOS action choices are built from the actual supplied candidates in both modes.

`AgentPiModelRequestExecutor` owns provider configuration, prompt-cache capture, first-output and request deadlines, cancellation, usage and timing. Text planning and resident native continuation also share this executor. A resident continuation keeps its owning Pi transcript and transport. Provider requests contain native image content; image bytes are excluded from text token accounting.

Response budgets apply to Pi output: `MaxResponseBytes` bounds accumulated deltas and the authoritative terminal message, while the existing `MaxSseEventBytes` and `MaxSseEvents` settings bound projected Pi events and their count. Shared partial messages are excluded from per-event accounting. A limit failure aborts the provider stream and retains its typed cause; it never triggers an output-contract repair.

Repairs follow configured budgets. Durable MemOS jobs own their total attempts and disable inner provider/contract retries. The background request ledger continues attempt counts and retry deadlines after restart and records usage even when output validation fails. Exhausted jobs cannot restart at attempt one for the same operation and source revision. Shutdown cancels pending model requests and retry waits.

StateCard v3 contains structural history, tool outcomes, references, skills, time and the resolved request. Follow-up resolution asks the model only for `topicRelation` and `standaloneRequest`; there is no keyword-based intent or context classification, free-text JSON extraction, or phase-of-day inference. A conversation with no history skips the model. Production reads completed physical conversation records after restart. Users remain intact; assistant previews and the history window use the configured MemOS budgets. Time uses Asia/Shanghai.

Retired StateCard producer contracts are excluded from new scenario learning rather than converted or repaired. Existing semantic memories and physical conversation history remain available. The physical history schema retires the unused context-mode column through a column-only upgrade; no configuration or memory database is cleared.

Tool summary transport or persistence failure is reported to its caller. Capacity-pressure observations remain an explicit protocol result when an observation cannot fit its reserved context budget; they are not substitute model summaries.
