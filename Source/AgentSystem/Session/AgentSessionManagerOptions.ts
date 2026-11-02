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
import type { AgentSessionHistoryResource } from "./AgentSessionHistoryMutationCoordinator.js";
import type { AgentSessionRunControlPolicy } from "./AgentSessionRunControlPolicy.js";
import type { AgentSessionRunResource } from "./AgentSessionRunResource.js";
import type { AgentSessionStore } from "./AgentSessionStore.js";
import type { AgentUploadStore } from "../Uploads/AgentUploadStore.js";
import type { AgentSessionHistoryPresentationResolver } from "./AgentSessionHistoryReplay.js";
import type { AgentImageNormalizationService } from "../Images/AgentImageNormalizationService.js";

export interface AgentSessionManagerOptions {
  onQueuedInputAccepted?: import("./AgentSessionInputDelivery.js").AgentSessionInputDeliveryOptions["onQueuedInputAccepted"];
  canWakeQueuedInputs?: (inputs: readonly import("./AgentSessionQueuedInput.js").AgentSessionQueuedInput[]) => boolean;
  /** Let the session's lifecycle owner reserve a queued activation before ordinary recovery starts it. */
  activateQueuedInput?: (
    input: import("./AgentSessionQueuedInput.js").AgentSessionQueuedInput,
    onEvent: import("../Events/AgentEvent.js").AgentEventSink,
  ) =>
    { readonly completion: Promise<void | "parked">; readonly parked?: false } | { readonly parked: true } | undefined;
  onTurnStart?: (context: {
    sessionId: string;
    requestId: string;
    onEvent?: import("../Events/AgentEvent.js").AgentEventSink;
  }) => void | Promise<void>;
  resolveInteraction?: import("./AgentSessionMessageCoordinator.js").AgentSessionMessageCoordinatorOptions["resolveInteraction"];
  loopFactory: (modelProviderId?: string, session?: import("./AgentSession.js").AgentSession) => AgentLoopRunner;
  resolveAgentId?: (id?: string) => string;
  agentModelProviderId?: (id: string) => string | undefined;
  store?: AgentSessionStore;
  conversationPolicy?: AgentConversationPolicy;
  conversationProjector?: AgentConversationProjector;
  memoryService?: Pick<AgentMemoryService, "recordCompletedTurn" | "deleteSession" | "deleteFromSessionRequest">;
  memorySourceRepository?: AgentMemorySourceRepository;
  logger?: AgentLogger;
  runResources?: readonly AgentSessionRunResource[];
  sessionResources?: readonly AgentSessionResource[];
  historyResources?: readonly AgentSessionHistoryResource[];
  piSessions?: AgentPiActiveSessionRegistry;
  piDiagnostics?: AgentPiDiagnosticSink;
  uploadStore?: Pick<AgentUploadStore, "resolve" | "resolvePath" | "resolveImageForModel">;
  imageNormalization?: Pick<AgentImageNormalizationService, "normalize">;
  piSessionMutations?: AgentPiSessionMutationPort;
  piSessionManagement?: AgentPiSessionManagementPort;
  piSessionCleanup?: AgentPiSessionCleanupPort;
  runControl: AgentSessionRunControlPolicy;
  artifactSessionCleanup?: AgentSessionArtifactLifecycle;
  /** Resolves current declarative presentation for compatible historical tool traces. */
  createHistoryPresentationResolver?: () => AgentSessionHistoryPresentationResolver;
  readHistoryBoundary?: (
    sessionId: string,
  ) => Promise<import("./AgentSessionHistoryWindow.js").AgentSessionHistoryBoundary | undefined>;
  /** Native transcript receipt check before replaying previously queued input. */
  readCommittedInputs?: (sessionId: string) => Promise<ReadonlySet<string>>;
  /** Child sessions created before ownership metadata was introduced. */
  managedSessionIds?: ReadonlySet<string>;
}
