import { StringDecoder } from "node:string_decoder";
import { AgentEventKinds, emitAgentEvent } from "../Events/AgentEvent.js";
import type { AgentEventSink } from "../Events/AgentEvent.js";
import type { SeneraProcessOutputChunk } from "../Execution/SeneraExecutionTypes.js";
import type { SeneraOutputStream } from "../Execution/SeneraOutputSpool.js";

export interface AgentToolOutputSink {
  write(stream: SeneraOutputStream, data: Uint8Array): boolean;
  waitForDrain(stream: SeneraOutputStream): Promise<void>;
}

export interface AgentToolExecutionReporterOptions {
  toolName: string;
  callId?: string;
  requestId?: string;
  step?: number;
  batchId?: string;
  resourceId?: string;
  onEvent?: AgentEventSink;
  outputSink?: AgentToolOutputSink;
  capabilities?: {
    progress: boolean;
    outputStreaming: boolean;
  };
}

export interface AgentToolTextOutput {
  stream: "stdout" | "stderr";
  text: string;
  byteLength?: number;
}

export interface AgentToolProgress {
  message?: string;
  completed?: number;
  total?: number;
  unit?: string;
  taskId?: string;
  state?: string;
  terminal?: boolean;
  pollIntervalMs?: number;
}

export class AgentToolExecutionReporter {
  private readonly decoders = {
    stdout: new StringDecoder("utf8"),
    stderr: new StringDecoder("utf8"),
  };
  private pending: Promise<void> = Promise.resolve();
  private readonly totalBytes = { stdout: 0, stderr: 0 };
  private outputSequence = 0;
  private progressSequence = 0;
  private outputSinkError: unknown;
  constructor(private readonly options: AgentToolExecutionReporterOptions) {}

  output(chunk: SeneraProcessOutputChunk): void {
    this.writeOutputSink(chunk.stream, chunk.data);
    if (!this.outputEnabled()) return;
    const text = this.decoders[chunk.stream].write(Buffer.from(chunk.data));
    this.totalBytes[chunk.stream] = Math.max(this.totalBytes[chunk.stream], chunk.totalBytes);
    if (text.length > 0) {
      this.enqueueOutput(chunk.stream, text, chunk.data.byteLength, this.totalBytes[chunk.stream]);
    }
  }

  outputText(output: AgentToolTextOutput): void {
    if (output.text.length === 0) return;
    this.writeOutputSink(output.stream, Buffer.from(output.text, "utf8"));
    const byteLength = output.byteLength ?? Buffer.byteLength(output.text, "utf8");
    this.totalBytes[output.stream] += byteLength;
    this.enqueueOutput(output.stream, output.text, byteLength, this.totalBytes[output.stream]);
  }

  progress(progress: AgentToolProgress): void {
    if (!this.progressEnabled()) return;
    const progressSequence = ++this.progressSequence;
    this.enqueue(() =>
      emitAgentEvent(this.options.onEvent, {
        kind: AgentEventKinds.ToolCallProgress,
        context: this.eventContext(),
        data: {
          toolName: this.options.toolName,
          callId: this.options.callId!,
          progressSequence,
          ...progress,
          batchId: this.options.batchId,
          resourceId: this.options.resourceId,
        },
      }),
    );
  }

  async flush(): Promise<void> {
    for (const stream of ["stdout", "stderr"] as const) {
      const text = this.decoders[stream].end();
      if (text.length > 0) {
        this.writeOutputSink(stream, Buffer.from(text, "utf8"));
        this.enqueueOutput(stream, text, 0, this.totalBytes[stream]);
      }
    }
    await this.pending;
    if (this.outputSinkError) throw this.outputSinkError;
  }

  private enqueueOutput(stream: "stdout" | "stderr", text: string, byteLength: number, totalBytes: number): void {
    if (!this.outputEnabled() && !this.options.outputSink) return;
    const outputSequence = ++this.outputSequence;
    this.enqueueOutputTask(async () => {
      await this.options.outputSink?.waitForDrain(stream);
      if (!this.outputEnabled()) return;
      await emitAgentEvent(this.options.onEvent, {
        kind: AgentEventKinds.ToolCallOutput,
        context: this.eventContext(),
        data: {
          toolName: this.options.toolName,
          callId: this.options.callId!,
          stream,
          outputSequence,
          text,
          byteLength,
          totalBytes,
          batchId: this.options.batchId,
          resourceId: this.options.resourceId,
        },
      }).catch(() => undefined);
    });
  }

  private writeOutputSink(stream: SeneraOutputStream, data: Uint8Array): void {
    if (!this.options.outputSink || data.byteLength === 0) return;
    try {
      this.options.outputSink.write(stream, data);
    } catch (error) {
      this.outputSinkError ??= error;
    }
  }

  private enqueueOutputTask(task: () => Promise<void>): void {
    this.pending = this.pending.then(task).catch((error) => {
      this.outputSinkError ??= error;
    });
  }

  private enqueue(task: () => Promise<void>): void {
    this.pending = this.pending.then(task).catch(() => undefined);
  }

  private isEnabled(): boolean {
    return Boolean(
      this.options.onEvent && this.options.callId && this.options.requestId && this.options.step !== undefined,
    );
  }

  private progressEnabled(): boolean {
    return this.isEnabled() && this.options.capabilities?.progress !== false;
  }

  private outputEnabled(): boolean {
    return this.isEnabled() && this.options.capabilities?.outputStreaming !== false;
  }

  private eventContext(): { requestId: string; step: number } {
    return {
      requestId: this.options.requestId!,
      step: this.options.step!,
    };
  }
}
