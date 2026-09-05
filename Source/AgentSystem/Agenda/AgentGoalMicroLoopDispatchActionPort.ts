import { sha256HexOfCanonicalJson } from "../Core/AgentHash.js";
import { uniqueStrings } from "../Core/AgentCollections.js";
import { AgentExecutionApprovalModes } from "../Safety/AgentExecutionApprovalMode.js";
import { AgentRunContextModes, type AgentRunDispatchPort } from "../Orchestration/AgentRunDispatchPort.js";
import { AgentGoalMicroLoopDecisionKinds, type AgentGoalMicroLoopActionPort } from "./AgentGoalMicroLoopRuntime.js";

/** Executes only host-approved Goal proposals through the existing dispatcher. */
export class AgentGoalMicroLoopDispatchActionPort implements AgentGoalMicroLoopActionPort {
  constructor(
    private readonly options: {
      readonly dispatch: AgentRunDispatchPort;
      readonly allowedToolNames: readonly string[] | (() => readonly string[]);
      readonly reviewDelayMs: number | (() => number);
      readonly requestId?: () => string;
    },
  ) {
    const initialDelay = typeof options.reviewDelayMs === "function" ? options.reviewDelayMs() : options.reviewDelayMs;
    if (!Number.isSafeInteger(initialDelay) || initialDelay < 1_000) {
      throw new RangeError("Goal micro-loop review delay must be a safe integer of at least 1000 ms.");
    }
  }

  async act(input: Parameters<AgentGoalMicroLoopActionPort["act"]>[0]): Promise<{
    readonly outcome: "applied" | "waiting" | "blocked" | "verified";
    readonly evidenceRefs: readonly string[];
    readonly nextReviewAt?: string | null;
    readonly progress?: number;
    readonly blockedReason?: string | null;
  }> {
    const ownerSessionId = input.candidate.ownerSessionId;
    if (!ownerSessionId) {
      return {
        outcome: "blocked",
        evidenceRefs: [],
        blockedReason: "Goal has no owner session for autonomous delivery.",
      };
    }
    const requestId =
      this.options.requestId?.() ??
      `run_goal_${sha256HexOfCanonicalJson({
        goalId: input.candidate.goalId,
        triggerKey: input.candidate.triggerKey,
        decision: input.decision.kind,
      }).slice(0, 32)}`;
    const interactive =
      input.decision.kind === AgentGoalMicroLoopDecisionKinds.AskUser ||
      input.decision.kind === AgentGoalMicroLoopDecisionKinds.Propose;
    const instruction = renderGoalInstruction(
      input,
      interactive,
      input.decision.kind === AgentGoalMicroLoopDecisionKinds.Complete,
    );
    if (this.options.dispatch.followUp) {
      const queued = await this.options.dispatch.followUp(ownerSessionId, instruction, undefined, requestId);
      if (queued) {
        const reviewDelayMs = this.readReviewDelayMs();
        return {
          outcome: "waiting",
          evidenceRefs: [`senera://goal-queue/${encodeURIComponent(input.candidate.goalId)}`],
          nextReviewAt: interactive ? null : new Date(Date.parse(input.now.toString()) + reviewDelayMs).toISOString(),
          progress: input.candidate.progress,
        };
      }
    }
    const result = await this.options.dispatch.dispatch({
      sessionId: ownerSessionId,
      requestId,
      input: instruction,
      approvalMode: AgentExecutionApprovalModes.Agent,
      allowedToolNames: interactive
        ? []
        : [
            ...(typeof this.options.allowedToolNames === "function"
              ? this.options.allowedToolNames()
              : this.options.allowedToolNames),
          ],
      contextMode: AgentRunContextModes.Fresh,
      scope: { jobId: input.candidate.goalId, role: "merge" },
      signal: undefined,
    });
    const reviewDelayMs = this.readReviewDelayMs();
    const runEvidenceRef = `senera://goal-run/${encodeURIComponent(input.candidate.goalId)}/${encodeURIComponent(result.requestId)}`;
    const evidenceRefs = uniqueStrings([runEvidenceRef, ...(result.evidenceRefs ?? [])]);
    if (input.decision.kind === AgentGoalMicroLoopDecisionKinds.Complete) {
      const verifiedEvidenceRefs = uniqueStrings(result.evidenceRefs ?? []);
      return {
        outcome: result.completion === "complete" && verifiedEvidenceRefs.length > 0 ? "verified" : "blocked",
        evidenceRefs,
        ...(result.completion === "complete" && verifiedEvidenceRefs.length > 0
          ? {}
          : {
              blockedReason:
                result.completion !== "complete"
                  ? "Goal run did not publish a terminal completion."
                  : "Goal run completed without verifiable evidence.",
            }),
      };
    }
    return {
      outcome: interactive ? "waiting" : "applied",
      evidenceRefs,
      nextReviewAt: interactive ? null : new Date(Date.parse(input.now.toString()) + reviewDelayMs).toISOString(),
      progress: input.candidate.progress,
    };
  }

  private readReviewDelayMs(): number {
    const reviewDelayMs =
      typeof this.options.reviewDelayMs === "function" ? this.options.reviewDelayMs() : this.options.reviewDelayMs;
    if (!Number.isSafeInteger(reviewDelayMs) || reviewDelayMs < 1_000) {
      throw new RangeError("Goal micro-loop review delay must be a safe integer of at least 1000 ms.");
    }
    return reviewDelayMs;
  }
}

function renderGoalInstruction(
  input: Parameters<AgentGoalMicroLoopActionPort["act"]>[0],
  interactive: boolean,
  completionRequested: boolean,
): string {
  const mode = interactive
    ? "Do not execute external actions. Present the necessary question or proposal to the user and wait."
    : completionRequested
      ? "Verify the success criteria against observable evidence and publish a terminal completion only when verified."
      : "Perform one bounded next step toward this goal using only the authorized tools, then report observable evidence.";
  const criteria =
    input.candidate.successCriteria.length > 0
      ? input.candidate.successCriteria.map((criterion) => `- ${criterion}`).join("\n")
      : "- No explicit success criteria were supplied; do not invent any.";
  return [
    "Continue one Senera Goal micro-loop step.",
    `Goal: ${input.candidate.summary}`,
    `Current progress: ${Math.round(input.candidate.progress * 100)}%`,
    "Success criteria:",
    criteria,
    `Supervisor reason: ${input.decision.reason}`,
    mode,
    "Do not claim completion without verifiable evidence.",
  ].join("\n");
}
