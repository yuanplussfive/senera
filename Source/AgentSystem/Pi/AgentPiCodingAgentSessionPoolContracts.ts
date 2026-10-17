import type {
  DefaultResourceLoader,
  SessionManager,
  AgentSession as CodingAgentSession,
} from "@earendil-works/pi-coding-agent";
import type { ResolvedAgentModelProviderConfig, ResolvedAgentPiCompactionConfig } from "../Types/AgentConfigTypes.js";
import type { AgentPiCodingAgentSessionFrame, AgentPiMutableSessionFrame } from "./AgentPiCodingAgentSessionFrame.js";
import type { AgentPiDiagnosticSink } from "./AgentPiDiagnostics.js";
import type { AgentPiSession } from "./AgentPiRuntimeTypes.js";
import type { AgentPiToolSet } from "./AgentPiToolRegistryProjector.js";
import type { AgentPiProviderProjection } from "./AgentPiTypes.js";
import type { AgentPiPlanningCompilerFactory } from "./AgentPiPlanningCompiler.js";
import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import type { AgentToolExposureState } from "../ToolRuntime/AgentToolExposureState.js";
import type { AgentResidentSpeechProjector } from "../ResidentSpeech/AgentResidentSpeechTypes.js";
import type { AgentToolResultObservationCompressor } from "../ToolRuntime/AgentToolResultObservationCompressor.js";
import type { AgentPiProjectContext } from "./AgentPiProjectContext.js";

export interface AgentPiCodingAgentSessionPoolOptions {
  workspaceLayout?: import("../Core/AgentWorkspaceLayout.js").AgentWorkspaceLayout;
  workspaceRoot: string;
  sessionsRoot: string;
  systemPromptPath: string;
  provider: AgentPiProviderProjection;
  modelProvider: ResolvedAgentModelProviderConfig;
  planningCompilerFactory: AgentPiPlanningCompilerFactory;
  residentSpeech?: AgentResidentSpeechProjector;
  compaction: ResolvedAgentPiCompactionConfig;
  maxIdleSessions?: number;
  diagnostics?: AgentPiDiagnosticSink;
  beforeCompaction?: (sessionId: string) => Promise<void>;
  afterCompaction?: (sessionId: string) => Promise<void> | void;
  observationCompressor: AgentToolResultObservationCompressor;
  observationTokenBudget: number;
}

export interface AgentPiCodingAgentLeaseInput {
  sessionId: string;
  signal?: AbortSignal;
  allTools: AgentPiToolSet;
  activeToolNames: readonly string[];
  frame: AgentPiCodingAgentSessionFrame;
  thinkingLevel?: ModelThinkingLevel;
  inheritProjectContext: boolean;
}

export interface AgentPiCodingAgentLeaseResult {
  session: AgentPiSession;
  storage: "created" | "existing";
}

export interface AgentPiPooledCodingSession {
  readonly registerDiscoveredTools: (
    tools: readonly import("@earendil-works/pi-coding-agent").ToolDefinition[],
  ) => void;
  readonly session: CodingAgentSession;
  readonly sessionManager: SessionManager;
  readonly frame: AgentPiMutableSessionFrame;
  readonly resourceLoader: DefaultResourceLoader;
  readonly projectContext: AgentPiProjectContext;
  readonly disposeDiagnostics: () => void;
  disposeToolExposure: () => void;
  toolExposure?: AgentToolExposureState;
  toolFingerprint: string;
  skillCatalogFingerprint: string;
  projectContextFingerprint: string;
  inheritProjectContext: boolean;
  activeLeases: number;
  lastAccess: number;
  shutdownPromise?: Promise<void>;
}
