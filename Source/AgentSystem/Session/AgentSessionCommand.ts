import { sha256HexOfCanonicalJson } from "../Core/AgentHash.js";
import { AgentBaseError } from "../Core/AgentBaseError.js";
import type { AgentExecutionApprovalMode } from "../Safety/AgentExecutionApprovalMode.js";

export const AgentSessionCommandStates = {
  Running: "running",
  Completed: "completed",
  Failed: "failed",
  Cancelled: "cancelled",
} as const;

export type AgentSessionCommandState = (typeof AgentSessionCommandStates)[keyof typeof AgentSessionCommandStates];

export interface AgentSessionCommandDescriptor {
  readonly commandId: string;
  readonly operationKind: string;
  readonly payloadHash: string;
  readonly requestId: string;
  readonly createdAt: string;
}

export interface AgentSessionCommandRecord extends AgentSessionCommandDescriptor {
  readonly sessionId: string;
  readonly state: AgentSessionCommandState;
  readonly updatedAt: string;
}

export type AgentSessionCommandAdmission =
  | { readonly kind: "accepted"; readonly command: AgentSessionCommandRecord }
  | { readonly kind: "replayed"; readonly command: AgentSessionCommandRecord };

export class AgentSessionCommandConflictError extends AgentBaseError {
  constructor(
    readonly sessionId: string,
    readonly commandId: string,
    readonly expected: Pick<AgentSessionCommandRecord, "operationKind" | "payloadHash" | "requestId">,
    readonly received: Pick<AgentSessionCommandDescriptor, "operationKind" | "payloadHash" | "requestId">,
  ) {
    super(`Session command identity conflict: ${sessionId}/${commandId}`);
  }
}

export function createAgentSessionMessageCommand(input: {
  readonly requestId: string;
  readonly modelProviderId?: string;
  readonly text: string;
  readonly approvalMode: AgentExecutionApprovalMode;
  readonly attachments?: readonly unknown[];
  readonly systemPromptLayer?: unknown;
  readonly allowedToolNames?: readonly string[];
  readonly pinnedSkills?: readonly unknown[];
  readonly thinkingLevel?: string;
  readonly inheritProjectContext?: boolean;
  readonly createdAt: string;
}): AgentSessionCommandDescriptor {
  const operationKind = "session.message";
  return {
    commandId: input.requestId,
    operationKind,
    requestId: input.requestId,
    createdAt: input.createdAt,
    payloadHash: sha256HexOfCanonicalJson({
      version: 4,
      operationKind,
      approvalMode: input.approvalMode,
      modelProviderId: input.modelProviderId?.trim() || null,
      input: input.text,
      attachments: input.attachments ?? [],
      systemPromptLayer: input.systemPromptLayer ?? null,
      allowedToolNames: input.allowedToolNames ?? null,
      pinnedSkills: input.pinnedSkills ?? null,
      thinkingLevel: input.thinkingLevel ?? null,
      inheritProjectContext: input.inheritProjectContext ?? null,
    }),
  };
}

export function assertMatchingAgentSessionCommand(
  existing: AgentSessionCommandRecord,
  incoming: AgentSessionCommandDescriptor,
): void {
  if (
    existing.operationKind !== incoming.operationKind ||
    existing.payloadHash !== incoming.payloadHash ||
    existing.requestId !== incoming.requestId
  ) {
    throw new AgentSessionCommandConflictError(existing.sessionId, existing.commandId, existing, incoming);
  }
}
