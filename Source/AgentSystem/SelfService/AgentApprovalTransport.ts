import type {
  AgentSelfApprovalChannel,
  AgentSelfApprovalRequest,
  AgentSelfApprovalResolveOutcome,
  AgentSelfApprovalVerdict,
} from "./AgentSelfApprovalTypes.js";
import type { AgentSelfApprovalRegistry } from "./AgentSelfApprovalRegistry.js";

export const AgentApprovalTransportKinds = {
  ModelCard: "model-card",
  CliTerminal: "cli-terminal",
  Custom: "custom",
} as const;
export type AgentApprovalTransportKind = (typeof AgentApprovalTransportKinds)[keyof typeof AgentApprovalTransportKinds];

/**
 * A named, registrable approval channel. The two built-in transports are the
 * model-facing card and the CLI terminal handshake; plugins may register
 * additional transports through `register(ctx).registerApprovalTransport`.
 * Structurally satisfies `AgentSelfApprovalChannel`, so executors keep a
 * single adjudication path while presentation stays transport-specific.
 */
export interface AgentApprovalTransport extends AgentSelfApprovalChannel {
  readonly name: string;
  readonly kind: AgentApprovalTransportKind;
}

export class AgentApprovalTransportRegistry {
  private readonly transports = new Map<string, AgentApprovalTransport>();

  register(transport: AgentApprovalTransport): () => void {
    if (this.transports.has(transport.name)) {
      throw new Error(`Approval transport is already registered: ${transport.name}`);
    }
    this.transports.set(transport.name, transport);
    return () => {
      if (this.transports.get(transport.name) === transport) this.transports.delete(transport.name);
    };
  }

  unregister(name: string): boolean {
    return this.transports.delete(name);
  }

  get(name: string): AgentApprovalTransport | undefined {
    return this.transports.get(name);
  }

  list(): AgentApprovalTransport[] {
    return [...this.transports.values()];
  }

  /** First registered transport, preserving built-in registration order. */
  preferred(): AgentApprovalTransport | undefined {
    return [...this.transports.values()][0];
  }
}

/**
 * Built-in CLI/HTTP transport: defers to a one-shot approval ledger that the
 * terminal handshake (or an external client) resolves by approval id. This is
 * the transport behind `POST /senera/self`.
 */
export function createHttpApprovalTransport(registry: AgentSelfApprovalRegistry): AgentApprovalTransport {
  return {
    name: "http",
    kind: AgentApprovalTransportKinds.CliTerminal,
    async request({ command }: AgentSelfApprovalRequest): Promise<AgentSelfApprovalVerdict> {
      const entry = registry.create(command);
      return { status: "deferred", approvalId: entry.approvalId, deadlineAt: entry.deadlineAt };
    },
    async resolve(approvalId: string, decision: "approve" | "deny"): Promise<AgentSelfApprovalResolveOutcome> {
      return registry.resolve(approvalId, decision);
    },
  };
}
