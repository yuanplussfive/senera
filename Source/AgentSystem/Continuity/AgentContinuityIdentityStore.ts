import fs from "node:fs";
import { z } from "zod";
import { createOpaqueId } from "../Core/AgentIds.js";
import { writeFileAtomicSync } from "../Core/AgentFs.js";
import { parseJsonText } from "../Core/AgentJsonParsing.js";

const AgentContinuityIdentityDocumentVersion = 1 as const;

const AgentContinuityIdentityDocumentSchema = z
  .object({
    version: z.literal(AgentContinuityIdentityDocumentVersion),
    workspaceId: z.string().trim().min(1),
    accountId: z.string().trim().min(1),
    userId: z.string().trim().min(1),
    createdAt: z.string().datetime(),
  })
  .strict();

type AgentContinuityIdentityDocument = z.infer<typeof AgentContinuityIdentityDocumentSchema>;

export interface AgentContinuityIdentityContext {
  readonly workspaceId: string;
  readonly accountId?: string;
  readonly userId?: string;
  readonly runtimeId: string;
  readonly sessionId?: string;
}

/** Owns stable logical identities independently from workspace filesystem paths. */
export class AgentContinuityIdentityStore {
  private readonly runtimeId = createOpaqueId("runtime");
  private document: AgentContinuityIdentityDocument | undefined;

  constructor(
    readonly filePath: string,
    private readonly workspaceId?: string,
  ) {}

  context(input: { readonly sessionId?: string } = {}): AgentContinuityIdentityContext {
    const document = (this.document ??= this.readOrCreate());
    return {
      workspaceId: this.workspaceId ?? document.workspaceId,
      accountId: document.accountId,
      userId: document.userId,
      runtimeId: this.runtimeId,
      ...(input.sessionId ? { sessionId: requireIdentity(input.sessionId, "session") } : {}),
    };
  }

  private readOrCreate(): AgentContinuityIdentityDocument {
    if (fs.existsSync(this.filePath)) {
      const document = AgentContinuityIdentityDocumentSchema.parse(
        parseJsonText(fs.readFileSync(this.filePath, "utf8"), "Continuity identity document"),
      );
      if (this.workspaceId !== undefined && document.workspaceId !== this.workspaceId) {
        throw new Error("Continuity identity does not belong to the registered workspace.");
      }
      return document;
    }

    const document: AgentContinuityIdentityDocument = {
      version: AgentContinuityIdentityDocumentVersion,
      workspaceId: this.workspaceId ?? createOpaqueId("workspace"),
      accountId: createOpaqueId("account"),
      userId: createOpaqueId("user"),
      createdAt: new Date().toISOString(),
    };
    writeFileAtomicSync(this.filePath, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600 });
    return document;
  }
}

export function withAgentContinuitySession(
  identity: AgentContinuityIdentityContext,
  sessionId: string | undefined,
): AgentContinuityIdentityContext {
  return sessionId
    ? { ...identity, sessionId: requireIdentity(sessionId, "session") }
    : { ...identity, sessionId: undefined };
}

export function requireAgentContinuityIdentity(
  identity: AgentContinuityIdentityContext,
  kind: "account" | "user",
): string {
  const value = identity[`${kind}Id`];
  if (!value) throw new Error(`Continuity ${kind} identity is required for this operation.`);
  return value;
}

function requireIdentity(value: string, kind: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`Continuity ${kind} identity must not be empty.`);
  return normalized;
}
