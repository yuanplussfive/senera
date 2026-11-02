import type { MemOS } from "@mem-os/sdk";
import type { AgentMemoryRecordedTurn, AgentMemorySourceRecord } from "../Memory/AgentMemorySourceRepository.js";
import type { AgentMemoryLearningLedger } from "./AgentMemoryLearningLedger.js";
import type { AgentMemOSSemanticDecision } from "./AgentMemOSSemanticTypes.js";

/** Settles task utility against acknowledged deliveries without truth-score validation. */
export class AgentMemOSMemoryAssessment {
  constructor(
    private readonly memos: MemOS,
    private readonly ledger?: AgentMemoryLearningLedger,
  ) {}

  sources(turn: AgentMemoryRecordedTurn): AgentMemorySourceRecord[] {
    const task = this.ledger?.binding(turn.episode.sessionId, turn.episode.requestId);
    return turn.sources.filter(
      (source) =>
        (source.sourceKind === "user_message" && task?.actorKind === "user" && Boolean(source.textContent?.trim())) ||
        (source.sourceKind === "tool_evidence" && isIndependentToolSource(source)),
    );
  }

  async settle(
    turn: AgentMemoryRecordedTurn,
    decision: AgentMemOSSemanticDecision,
    targets: readonly string[],
    knowledgeId?: string,
    isCurrent: () => boolean = () => true,
  ): Promise<void> {
    const ledger = this.ledger;
    const task = ledger?.binding(turn.episode.sessionId, turn.episode.requestId);
    if (!ledger || !task || !isCurrent()) return;
    const nodeIds = new Set([
      ...ledger.delivered(turn.episode.sessionId, turn.episode.requestId).map((entry) => entry.id),
      ...(knowledgeId && decision.action !== "skip" ? [knowledgeId] : []),
      ...decision.assessments.map((assessment) => {
        const target = targets[assessment.candidate];
        if (!target) throw new Error("Memory assessment cites an unavailable candidate.");
        return target;
      }),
    ]);
    const existing = new Set(
      (await Promise.all([...nodeIds].map((id) => this.memos.retrieve(id)))).flatMap((node) => (node ? [node.id] : [])),
    );
    if (!isCurrent()) return;
    const delivered = new Set(
      ledger
        .delivered(turn.episode.sessionId, turn.episode.requestId)
        .filter((entry) => existing.has(entry.id))
        .map((entry) => entry.id),
    );
    // A memory deleted while learning was in flight must never be resurrected.
    const assessed = decision.assessments
      .map((assessment) => targets[assessment.candidate]!)
      .filter((id) => existing.has(id));
    if (
      new Set(assessed).size !== assessed.length ||
      assessed.some((id) => !delivered.has(id)) ||
      [...delivered].some((id) => !assessed.includes(id))
    )
      throw new Error("Every existing delivered memory must be assessed exactly once.");
    ledger.reconcileAssessment(turn.episode.sessionId, turn.episode.requestId, () => {
      if (knowledgeId && decision.action !== "skip" && existing.has(knowledgeId)) {
        ledger.register(knowledgeId);
      }
      for (const assessment of decision.assessments) {
        const target = targets[assessment.candidate]!;
        if (!existing.has(target)) continue;
        ledger.settleUtility(
          turn.episode.sessionId,
          turn.episode.requestId,
          target,
          assessment.usefulness,
          assessment.reason,
        );
      }
    });
  }
}

function isIndependentToolSource(source: AgentMemorySourceRecord): boolean {
  const evidence = source.metadata.evidence;
  return Boolean(
    evidence &&
    typeof evidence === "object" &&
    "kind" in evidence &&
    evidence.kind !== "continuity_write" &&
    evidence.kind !== "continuity_recall",
  );
}
