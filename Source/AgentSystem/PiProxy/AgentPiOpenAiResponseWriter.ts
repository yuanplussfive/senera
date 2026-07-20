import type http from "node:http";
import type { AgentLanguageModelStream } from "../ModelEndpoints/AgentLanguageModel.js";
import { agentErrorMessage } from "../I18n/AgentMessageCatalog.js";
import type { AgentModelUsageValue } from "../ModelEndpoints/AgentModelUsage.js";
import type { AgentPiAssistantMessage } from "./AgentPiAssistantMessageTypes.js";
import {
  AgentPiChatCompletionStreamProjector,
  projectPiChatCompletionResponse,
} from "./AgentPiOpenAiResponseProjector.js";

export interface AgentPiOpenAiResponseWriter {
  writeMessage(message: AgentPiAssistantMessage): Promise<string>;
  writeFinalAnswer(stream: AgentLanguageModelStream): Promise<string>;
}

export class AgentPiFinalAnswerEmptyError extends Error {
  constructor() {
    super(agentErrorMessage("pi.finalAnswerEmpty"));
    this.name = "AgentPiFinalAnswerEmptyError";
  }
}

export function createAgentPiOpenAiResponseWriter(options: {
  response: http.ServerResponse;
  model: string;
  streaming: boolean;
  usage?: () => AgentModelUsageValue | undefined;
  onFirstOutput?: () => void | Promise<void>;
}): AgentPiOpenAiResponseWriter {
  return options.streaming
    ? new AgentPiOpenAiSseResponseWriter(options.response, options.model, options.usage, options.onFirstOutput)
    : new AgentPiOpenAiJsonResponseWriter(options.response, options.model, options.usage, options.onFirstOutput);
}

class AgentPiOpenAiJsonResponseWriter implements AgentPiOpenAiResponseWriter {
  constructor(
    private readonly response: http.ServerResponse,
    private readonly model: string,
    private readonly usage: () => AgentModelUsageValue | undefined = () => undefined,
    private readonly onFirstOutput?: () => void | Promise<void>,
  ) {}

  async writeMessage(message: AgentPiAssistantMessage): Promise<string> {
    await this.writeProjectedMessage(message);
    return message.content;
  }

  async writeFinalAnswer(stream: AgentLanguageModelStream): Promise<string> {
    const content = await collectFinalAnswer(stream);
    await this.writeProjectedMessage({ kind: "final_text", content, toolCalls: [] }, stream.usage);
    return content;
  }

  private async writeProjectedMessage(
    message: AgentPiAssistantMessage,
    streamUsage?: AgentModelUsageValue,
  ): Promise<void> {
    writeJson(this.response, projectPiChatCompletionResponse(this.model, message, this.usage() ?? streamUsage));
    await this.onFirstOutput?.();
  }
}

class AgentPiOpenAiSseResponseWriter implements AgentPiOpenAiResponseWriter {
  private readonly projector: AgentPiChatCompletionStreamProjector;
  private started = false;
  private firstOutputNotified = false;

  constructor(
    private readonly response: http.ServerResponse,
    model: string,
    private readonly usage: () => AgentModelUsageValue | undefined = () => undefined,
    private readonly onFirstOutput?: () => void | Promise<void>,
  ) {
    this.projector = new AgentPiChatCompletionStreamProjector(model);
  }

  async writeMessage(message: AgentPiAssistantMessage): Promise<string> {
    this.start();
    for (const [index, event] of this.projector.messageEvents(message).entries()) {
      await writeSseEvent(this.response, event);
      if (index === 0) await this.notifyFirstOutput();
    }
    await this.writeUsage();
    this.finish();
    return message.content;
  }

  async writeFinalAnswer(stream: AgentLanguageModelStream): Promise<string> {
    let content = "";
    let pending = "";
    try {
      for await (const chunk of stream) {
        content += chunk.textDelta;
        pending += chunk.textDelta;
        if (!pending.trim()) continue;

        await this.startFinalAnswer();
        await writeSseEvent(this.response, this.projector.textDeltaEvent(pending));
        pending = "";
      }

      if (!content.trim()) throw new AgentPiFinalAnswerEmptyError();
      if (pending) {
        await this.startFinalAnswer();
        await writeSseEvent(this.response, this.projector.textDeltaEvent(pending));
      }
      await writeSseEvent(this.response, this.projector.finishEvent("stop"));
      await this.writeUsage(stream.usage);
      this.finish();
      return content;
    } catch (error) {
      stream.abort();
      throw error;
    }
  }

  private start(): void {
    if (this.started) return;
    this.response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    this.started = true;
  }

  private async startFinalAnswer(): Promise<void> {
    if (this.started) return;
    this.start();
    await writeSseEvent(this.response, this.projector.roleEvent());
    await this.notifyFirstOutput();
  }

  private async notifyFirstOutput(): Promise<void> {
    if (this.firstOutputNotified) return;
    this.firstOutputNotified = true;
    await this.onFirstOutput?.();
  }

  private finish(): void {
    this.response.end("data: [DONE]\n\n");
  }

  private async writeUsage(streamUsage?: AgentModelUsageValue): Promise<void> {
    const event = this.projector.usageEvent(this.usage() ?? streamUsage);
    if (event) await writeSseEvent(this.response, event);
  }
}

async function collectFinalAnswer(stream: AgentLanguageModelStream): Promise<string> {
  let content = "";
  try {
    for await (const chunk of stream) content += chunk.textDelta;
  } catch (error) {
    stream.abort();
    throw error;
  }
  if (!content.trim()) throw new AgentPiFinalAnswerEmptyError();
  return content;
}

async function writeSseEvent(response: http.ServerResponse, event: unknown): Promise<void> {
  if (response.write(`data: ${JSON.stringify(event)}\n\n`)) return;
  await waitForDrain(response);
}

function waitForDrain(response: http.ServerResponse): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      response.off("drain", onDrain);
      response.off("close", onClose);
      response.off("error", onError);
    };
    const onDrain = (): void => {
      cleanup();
      resolve();
    };
    const onClose = (): void => {
      cleanup();
      reject(new Error(agentErrorMessage("pi.responseClosedDuringBackpressure")));
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    response.once("drain", onDrain);
    response.once("close", onClose);
    response.once("error", onError);
  });
}

function writeJson(response: http.ServerResponse, payload: unknown): void {
  response.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(payload));
}
