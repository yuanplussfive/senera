import {
  InMemoryAgentMemorySourceRepository,
  type AgentMemoryCompletedTurnInput,
  type AgentMemoryRecordedTurn,
  type AgentMemorySourceRepository,
} from "./AgentMemorySourceRepository.js";

export interface AgentMemoryLearningSink {
  enqueue(recordedTurn: AgentMemoryRecordedTurn): void;
  stop?(): void;
}

export interface AgentMemoryServiceOptions {
  learning?: AgentMemoryLearningSink;
  sourceRepository?: AgentMemorySourceRepository;
}

export class AgentMemoryService {
  private readonly learning?: AgentMemoryLearningSink;
  private readonly sourceRepository: AgentMemorySourceRepository;

  constructor(options: AgentMemoryServiceOptions = {}) {
    this.learning = options.learning;
    this.sourceRepository = options.sourceRepository ?? new InMemoryAgentMemorySourceRepository();
  }

  deleteSession(sessionId: string): void {
    this.sourceRepository.deleteSession(sessionId);
  }

  deleteFromSessionRequest(sessionId: string, requestId: string): void {
    this.sourceRepository.deleteFromSessionRequest(sessionId, requestId);
  }

  recordCompletedTurn(input: AgentMemoryCompletedTurnInput): AgentMemoryRecordedTurn {
    const recordedTurn = this.sourceRepository.recordCompletedTurn(input);
    this.learning?.enqueue(recordedTurn);
    return recordedTurn;
  }

  close(): void {
    this.learning?.stop?.();
    this.sourceRepository.close();
  }
}
