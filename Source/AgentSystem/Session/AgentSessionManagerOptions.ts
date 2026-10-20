import type { AgentConversationPolicy } from "../Conversation/AgentConversationPolicy.js";
import type { AgentConversationProjector } from "../Conversation/AgentConversationProjector.js";
import type { AgentLogger } from "../Diagnostics/AgentLogger.js";
import type { AgentLoopRunner } from "../Loop/AgentLoopRunner.js";
import type { AgentMemoryService } from "../Memory/AgentMemoryService.js";
import type { AgentMemorySourceRepository } from "../Memory/AgentMemorySourceRepository.js";
import type { AgentPiActiveSessionRegistry } from "../Pi/AgentPiActiveSessionRegistry.js";
import type { AgentPiDiagnosticSink } from "../Pi/AgentPiDiagnostics.js";
import type { AgentPiSessionCleanupPort } from "../Pi/AgentPiSessionCleanupService.js";
import type { AgentPiSessionManagementPort, AgentPiSessionMutationPort } from "../Pi/AgentPiSessionMutationService.js";
import type { AgentSessionArtifactLifecycle } from "./AgentSessionArtifactLifecycle.js";
import type { AgentSessionResource } from "./AgentSessionResource.js";
import type { AgentSessionRunControlPolicy } from "./AgentSessionRunControlPolicy.js";
import type { AgentSessionRunResource } from "./AgentSessionRunResource.js";
import type { AgentSessionStore } from "./AgentSessionStore.js";
import type { AgentUploadStore } from "../Uploads/AgentUploadStore.js";
import type { AgentSessionHistoryPresentationResolver } from "./AgentSessionHistoryReplay.js";

export interface AgentSessionManagerOptions {
  loopFactory: (modelProviderId?: string) => AgentLoopRunner;
  store?: AgentSessionStore;
  conversationPolicy?: AgentConversationPolicy;
  conversationProjector?: AgentConversationProjector;
  memoryService?: AgentMemoryService;
  memorySourceRepository?: AgentMemorySourceRepository;
  logger?: AgentLogger;
  runResources?: readonly AgentSessionRunResource[];
  sessionResources?: readonly AgentSessionResource[];
  piSessions?: AgentPiActiveSessionRegistry;
  piDiagnostics?: AgentPiDiagnosticSink;
  uploadStore?: Pick<AgentUploadStore, "resolve">;
  piSessionMutations?: AgentPiSessionMutationPort;
  piSessionManagement?: AgentPiSessionManagementPort;
  piSessionCleanup?: AgentPiSessionCleanupPort;
  runControl: AgentSessionRunControlPolicy;
  artifactSessionCleanup?: AgentSessionArtifactLifecycle;
  /** Resolves current declarative presentation for compatible historical tool traces. */
  createHistoryPresentationResolver?: () => AgentSessionHistoryPresentationResolver;
  /** Child sessions created before ownership metadata was introduced. */
  managedSessionIds?: ReadonlySet<string>;
}
