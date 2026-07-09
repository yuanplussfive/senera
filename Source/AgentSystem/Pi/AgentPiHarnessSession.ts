import type {
  AgentEvent,
  AgentHarnessResources,
  AgentHarness,
  AgentMessage,
  AgentState,
  PromptTemplate,
  Skill,
} from "@earendil-works/pi-agent-core";
import type { AgentPiHarnessEvent } from "./AgentPiHarnessEvents.js";
import {
  isPiCoreAgentEvent,
} from "./AgentPiHarnessEvents.js";
import type {
  AgentPiSession,
  AgentPiSessionEventListener,
} from "./AgentPiSubstrate.js";
import type {
  AgentPiModelProjection,
  AgentPiToolDefinition,
} from "./AgentPiTypes.js";

export interface AgentPiHarnessSessionOptions {
  model: AgentPiModelProjection;
  tools: readonly AgentPiToolDefinition[];
  release?: () => void;
}

export class AgentPiHarnessSession implements AgentPiSession {
  private history: AgentMessage[] = [];
  private lastAssistantText: string | undefined;
  private released = false;

  constructor(
    private readonly harness: AgentHarness,
    private readonly options: AgentPiHarnessSessionOptions,
  ) {}

  get state(): AgentState {
    const owner = this;
    const tools = this.snapshotTools();
    return {
      systemPrompt: "",
      model: this.options.model,
      thinkingLevel: "off",
      get tools() {
        return [...tools];
      },
      set tools(_tools: AgentPiToolDefinition[]) {},
      get messages() {
        return [...owner.history];
      },
      set messages(messages: AgentMessage[]) {
        owner.history = [...messages];
      },
      isStreaming: false,
      pendingToolCalls: new Set(),
    } satisfies AgentState;
  }

  get model(): AgentState["model"] {
    return this.options.model;
  }

  setHistory(messages: readonly AgentMessage[]): void {
    this.history = [...messages];
  }

  async prompt(text: string): Promise<void> {
    await this.appendHistory();
    const assistant = await this.harness.prompt(text);
    this.lastAssistantText = readAssistantText(assistant);
  }

  async steer(text: string): Promise<void> {
    await this.harness.steer(text);
  }

  async followUp(text: string): Promise<void> {
    await this.harness.followUp(text);
  }

  async nextTurn(text: string): Promise<void> {
    await this.harness.nextTurn(text);
  }

  async setResources(resources: AgentHarnessResources<Skill, PromptTemplate>): Promise<void> {
    await this.harness.setResources(resources);
  }

  subscribe(listener: AgentPiSessionEventListener): () => void {
    return this.harness.subscribe((event) => {
      if (isPiCoreAgentEvent(event as AgentPiHarnessEvent)) {
        void listener(event as AgentEvent);
      }
    });
  }

  async abort(): Promise<void> {
    await this.harness.abort();
    await this.harness.waitForIdle();
  }

  dispose(): void {
    if (this.released) {
      return;
    }

    this.released = true;
    this.options.release?.();
  }

  getLastAssistantText(): string | undefined {
    return this.lastAssistantText;
  }

  getActiveToolNames(): string[] {
    return this.options.tools.map((tool) => tool.name);
  }

  private async appendHistory(): Promise<void> {
    for (const message of this.history) {
      await this.harness.appendMessage(message);
    }
  }

  private snapshotTools(): AgentPiToolDefinition[] {
    return [...this.options.tools];
  }
}

function readAssistantText(message: AgentState["messages"][number]): string {
  const content = message.role === "assistant" ? message.content : [];
  return content.flatMap((entry) =>
    entry.type === "text" && typeof entry.text === "string" ? [entry.text] : [],
  ).join("").trim();
}
