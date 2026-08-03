import type {
  DefaultResourceLoader,
  SessionManager,
  AgentSession as CodingAgentSession,
} from "@earendil-works/pi-coding-agent";
import type { ResolvedAgentModelProviderConfig, ResolvedAgentPiCompactionConfig } from "../Types/AgentConfigTypes.js";
import type { AgentPiCodingAgentSessionFrame, AgentPiMutableSessionFrame } from "./AgentPiCodingAgentSessionFrame.js";
import type { AgentPiDiagnosticSink } from "./AgentPiDiagnostics.js";
import type { AgentPiToolObservationDigester } from "./AgentPiToolObservationDigester.js";
import type { AgentPiSession } from "./AgentPiRuntimeTypes.js";
import type { AgentPiToolSet } from "./AgentPiToolRegistryProjector.js";
import type { AgentPiProviderProjection } from "./AgentPiTypes.js";

export interface AgentPiCodingAgentSessionPoolOptions {
  workspaceRoot: string;
  sessionsRoot: string;
  systemSkillsRoot: string;
  provider: AgentPiProviderProjection;
  modelProvider: ResolvedAgentModelProviderConfig;
  compaction: ResolvedAgentPiCompactionConfig;
  maxIdleSessions?: number;
  toolObservationDigester?: AgentPiToolObservationDigester;
  diagnostics?: AgentPiDiagnosticSink;
}

export interface AgentPiCodingAgentLeaseInput {
  sessionId: string;
  signal?: AbortSignal;
  allTools: AgentPiToolSet;
  activeToolNames: readonly string[];
  frame: AgentPiCodingAgentSessionFrame;
}

export interface AgentPiCodingAgentLeaseResult {
  session: AgentPiSession;
  storage: "created" | "existing";
  historyMigrationRequired: boolean;
}

export interface AgentPiPooledCodingSession {
  readonly session: CodingAgentSession;
  readonly sessionManager: SessionManager;
  readonly frame: AgentPiMutableSessionFrame;
  readonly resourceLoader: DefaultResourceLoader;
  readonly disposeDiagnostics: () => void;
  toolFingerprint: string;
  skillCatalogFingerprint: string;
  projectContextFingerprint: string;
  activeLeases: number;
  lastAccess: number;
  shutdownPromise?: Promise<void>;
}
