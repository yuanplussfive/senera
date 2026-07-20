import * as AjvModule from "ajv";
import type { ErrorObject, ValidateFunction } from "ajv";
import { createOpaqueId } from "../Core/AgentIds.js";
import { AgentEventKinds, emitAgentEvent, type AgentEventSink } from "../Events/AgentEvent.js";
import {
  AgentInteractionInputActions,
  AgentInteractionInputModes,
  type AgentInteractionInputContent,
  type AgentExternalInteractionCompletion,
  type AgentExternalInteractionHandle,
  type AgentInteractionInputRequest,
  type AgentInteractionInputResolution,
  type AgentInteractionInputResolveCommand,
  type AgentInteractionInputWaitOptions,
} from "./AgentInteractionInputTypes.js";
import { resolveAgentExternalUrl } from "./AgentExternalUrlPolicy.js";

const Ajv = (AjvModule.default ?? AjvModule) as unknown as typeof import("ajv").default;

interface PendingInteractionInput {
  readonly request: AgentInteractionInputRequest;
  readonly promise: Promise<AgentInteractionInputResolution>;
  readonly resolve: (resolution: AgentInteractionInputResolution) => void;
  readonly validate?: ValidateFunction<AgentInteractionInputContent>;
  readonly eventSink?: AgentEventSink;
  readonly cleanup: () => void;
  readonly resolveExternalCompletion?: (completion: AgentExternalInteractionCompletion) => void;
}

export interface AgentInteractionInputRuntimeOptions {
  defaultDeadlineMs?: number;
}

export const AgentInteractionInputDefaultDeadlineMs = 120_000;

interface ActiveExternalInteraction {
  readonly request: Extract<AgentInteractionInputRequest, { mode: "url" }>;
  readonly resolution: AgentInteractionInputResolution;
  readonly eventSink?: AgentEventSink;
  readonly cleanup: () => void;
  readonly resolveCompletion?: (completion: AgentExternalInteractionCompletion) => void;
}

export class AgentInteractionInputNotPendingError extends Error {
  constructor(readonly interactionId: string) {
    super(`Interaction input ${interactionId} is no longer pending.`);
    this.name = "AgentInteractionInputNotPendingError";
  }
}

export class AgentInteractionInputValidationError extends Error {
  constructor(
    readonly interactionId: string,
    readonly errors: readonly ErrorObject[],
  ) {
    super(`Interaction input ${interactionId} does not match the requested schema.`);
    this.name = "AgentInteractionInputValidationError";
  }
}

export class AgentInteractionInputRuntime {
  private readonly pending = new Map<string, PendingInteractionInput>();
  private readonly activeExternal = new Map<string, ActiveExternalInteraction>();
  private readonly interactionIdByExternalId = new Map<string, string>();
  private readonly validator = new Ajv({ allErrors: true, strict: false, validateFormats: false });
  private eventSink?: AgentEventSink;
  private readonly defaultDeadlineMs: number;

  constructor(options: AgentInteractionInputRuntimeOptions = {}) {
    this.defaultDeadlineMs = normalizeDeadline(options.defaultDeadlineMs ?? AgentInteractionInputDefaultDeadlineMs);
  }

  setEventSink(eventSink: AgentEventSink | undefined): void {
    this.eventSink = eventSink;
  }

  async request(options: AgentInteractionInputWaitOptions): Promise<AgentInteractionInputResolution> {
    return this.startRequest(options);
  }

  requestExternal(options: Extract<AgentInteractionInputWaitOptions, { mode: "url" }>): AgentExternalInteractionHandle {
    let resolveCompletion!: (completion: AgentExternalInteractionCompletion) => void;
    const completion = new Promise<AgentExternalInteractionCompletion>((resolve) => {
      resolveCompletion = resolve;
    });
    return {
      response: this.startRequest(options, resolveCompletion),
      completion,
    };
  }

  private async startRequest(
    options: AgentInteractionInputWaitOptions,
    resolveExternalCompletion?: (completion: AgentExternalInteractionCompletion) => void,
  ): Promise<AgentInteractionInputResolution> {
    const deadlineMs = normalizeDeadline(options.deadlineMs ?? this.defaultDeadlineMs);
    const request = createInteractionRequest(options, deadlineMs);
    if (request.mode === AgentInteractionInputModes.Url) {
      if (this.interactionIdByExternalId.has(request.externalId)) {
        throw new Error(`External interaction ${request.externalId} is already active.`);
      }
      this.interactionIdByExternalId.set(request.externalId, request.interactionId);
    }
    const pending = this.createPending(request, options, deadlineMs, resolveExternalCompletion);
    this.pending.set(request.interactionId, pending);

    try {
      await this.emitRequested(pending);
    } catch (error) {
      this.removePending(pending, true);
      pending.resolveExternalCompletion?.("cancelled");
      throw error;
    }

    if (options.signal?.aborted) {
      await this.cancel(request.interactionId, readAbortMessage(options.signal));
    }
    return pending.promise;
  }

  async resolve(command: AgentInteractionInputResolveCommand): Promise<AgentInteractionInputResolution> {
    const pending = this.pending.get(command.interactionId);
    if (!pending) {
      const external = this.activeExternal.get(command.interactionId);
      if (external && command.action === AgentInteractionInputActions.Cancel) {
        return this.cancelExternal(external, command.message);
      }
      throw new AgentInteractionInputNotPendingError(command.interactionId);
    }
    if (
      pending.request.mode === AgentInteractionInputModes.Url &&
      command.action === AgentInteractionInputActions.Accept
    ) {
      return this.acceptExternal(pending, command.message);
    }
    const content =
      pending.request.mode === AgentInteractionInputModes.Form && command.action === AgentInteractionInputActions.Accept
        ? (command.content ?? {})
        : undefined;
    if (content && pending.validate && !pending.validate(content)) {
      throw new AgentInteractionInputValidationError(command.interactionId, pending.validate.errors ?? []);
    }
    return this.settle(pending, {
      interactionId: command.interactionId,
      action: command.action,
      content,
      message: command.message,
      resolvedAt: new Date().toISOString(),
    });
  }

  async cancelByRequestId(requestId: string, message?: string): Promise<number> {
    const matches = [...this.pending.values()].filter((pending) => pending.request.requestId === requestId);
    const externalMatches = [...this.activeExternal.values()].filter(
      (interaction) => interaction.request.requestId === requestId,
    );
    await Promise.all([
      ...matches.map((pending) => this.cancelPending(pending, message)),
      ...externalMatches.map((interaction) => this.cancelExternal(interaction, message)),
    ]);
    return matches.length + externalMatches.length;
  }

  async close(message = "Interaction input runtime closed."): Promise<void> {
    await Promise.all([
      ...[...this.pending.values()].map((pending) => this.cancelPending(pending, message)),
      ...[...this.activeExternal.values()].map((interaction) => this.cancelExternal(interaction, message)),
    ]);
  }

  listPending(sessionId?: string): AgentInteractionInputRequest[] {
    return [...this.pending.values(), ...this.activeExternal.values()]
      .map((entry) => entry.request)
      .filter((request) => !sessionId || request.sessionId === sessionId);
  }

  async completeExternal(externalId: string): Promise<boolean> {
    const interactionId = this.interactionIdByExternalId.get(externalId);
    const active = interactionId ? this.activeExternal.get(interactionId) : undefined;
    if (!active) return false;
    this.removeExternal(active);
    await this.emitResolved(active, { ...active.resolution, resolvedAt: new Date().toISOString() }, "resolved");
    active.resolveCompletion?.("completed");
    return true;
  }

  private createPending(
    request: AgentInteractionInputRequest,
    options: AgentInteractionInputWaitOptions,
    deadlineMs: number,
    resolveExternalCompletion?: (completion: AgentExternalInteractionCompletion) => void,
  ): PendingInteractionInput {
    let resolvePromise!: (resolution: AgentInteractionInputResolution) => void;
    const promise = new Promise<AgentInteractionInputResolution>((resolve) => {
      resolvePromise = resolve;
    });
    const abort = (): void => {
      void this.cancel(request.interactionId, readAbortMessage(options.signal));
    };
    options.signal?.addEventListener("abort", abort, { once: true });
    const deadlineTimer = deadlineMs
      ? setTimeout(() => {
          void this.cancel(request.interactionId, "交互输入等待已过期。", "expired");
        }, deadlineMs)
      : undefined;
    deadlineTimer?.unref();
    return {
      request,
      promise,
      resolve: resolvePromise,
      validate:
        request.mode === AgentInteractionInputModes.Form
          ? this.validator.compile({
              ...request.schema,
              $schema: undefined,
              additionalProperties: false,
            })
          : undefined,
      eventSink: options.onEvent,
      cleanup: () => {
        options.signal?.removeEventListener("abort", abort);
        if (deadlineTimer) clearTimeout(deadlineTimer);
      },
      resolveExternalCompletion,
    };
  }

  private async cancel(
    interactionId: string,
    message?: string,
    status: "resolved" | "expired" = "resolved",
  ): Promise<AgentInteractionInputResolution | undefined> {
    const pending = this.pending.get(interactionId);
    if (pending) return this.cancelPending(pending, message, status);
    const external = this.activeExternal.get(interactionId);
    return external ? this.cancelExternal(external, message, status) : undefined;
  }

  private cancelPending(
    pending: PendingInteractionInput,
    message?: string,
    status: "resolved" | "expired" = "resolved",
  ): Promise<AgentInteractionInputResolution> {
    return this.settle(
      pending,
      {
        interactionId: pending.request.interactionId,
        action: AgentInteractionInputActions.Cancel,
        message,
        resolvedAt: new Date().toISOString(),
      },
      status,
    );
  }

  private async settle(
    pending: PendingInteractionInput,
    resolution: AgentInteractionInputResolution,
    status: "resolved" | "expired" = "resolved",
  ): Promise<AgentInteractionInputResolution> {
    if (this.pending.get(pending.request.interactionId) !== pending) return resolution;
    this.removePending(pending, true);
    try {
      await this.emitResolved(pending, resolution, status);
    } finally {
      pending.resolve(resolution);
      if (pending.request.mode === AgentInteractionInputModes.Url) {
        pending.resolveExternalCompletion?.("cancelled");
      }
    }
    return resolution;
  }

  private async acceptExternal(
    pending: PendingInteractionInput,
    message?: string,
  ): Promise<AgentInteractionInputResolution> {
    if (pending.request.mode !== AgentInteractionInputModes.Url) {
      throw new Error("Only URL interactions can enter external-pending state.");
    }
    const resolution: AgentInteractionInputResolution = {
      interactionId: pending.request.interactionId,
      action: AgentInteractionInputActions.Accept,
      message,
      resolvedAt: new Date().toISOString(),
    };
    this.removePending(pending, false);
    const active: ActiveExternalInteraction = {
      request: pending.request,
      resolution,
      eventSink: pending.eventSink,
      cleanup: pending.cleanup,
      resolveCompletion: pending.resolveExternalCompletion,
    };
    this.activeExternal.set(active.request.interactionId, active);
    try {
      await this.emitResolved(active, resolution, "external_pending");
    } finally {
      pending.resolve(resolution);
    }
    return resolution;
  }

  private async cancelExternal(
    interaction: ActiveExternalInteraction,
    message?: string,
    status: "resolved" | "expired" = "resolved",
  ): Promise<AgentInteractionInputResolution> {
    const resolution: AgentInteractionInputResolution = {
      interactionId: interaction.request.interactionId,
      action: AgentInteractionInputActions.Cancel,
      message,
      resolvedAt: new Date().toISOString(),
    };
    this.removeExternal(interaction);
    await this.emitResolved(interaction, resolution, status);
    interaction.resolveCompletion?.("cancelled");
    return resolution;
  }

  private removePending(pending: PendingInteractionInput, cleanup: boolean): void {
    if (cleanup) pending.cleanup();
    this.pending.delete(pending.request.interactionId);
    if (cleanup && pending.request.mode === AgentInteractionInputModes.Url) {
      this.interactionIdByExternalId.delete(pending.request.externalId);
    }
  }

  private removeExternal(interaction: ActiveExternalInteraction): void {
    interaction.cleanup();
    this.activeExternal.delete(interaction.request.interactionId);
    this.interactionIdByExternalId.delete(interaction.request.externalId);
  }

  private emitRequested(pending: PendingInteractionInput): Promise<void> {
    return emitAgentEvent(pending.eventSink ?? this.eventSink, {
      kind: AgentEventKinds.InteractionInputRequested,
      context: interactionContext(pending.request),
      data: { ...interactionData(pending.request), status: "pending" },
    });
  }

  private async emitResolved(
    pending: Pick<PendingInteractionInput, "request" | "eventSink">,
    resolution: AgentInteractionInputResolution,
    status: "external_pending" | "resolved" | "expired",
  ): Promise<void> {
    try {
      await emitAgentEvent(pending.eventSink ?? this.eventSink, {
        kind: AgentEventKinds.InteractionInputResolved,
        context: interactionContext(pending.request),
        data: {
          ...interactionData(pending.request),
          status,
          action: resolution.action,
          content: resolution.content,
          resolutionMessage: resolution.message,
          resolvedAt: resolution.resolvedAt,
        },
      });
    } catch {
      // A transport failure does not reopen an interaction already resolved by the user.
    }
  }
}

function interactionContext(request: AgentInteractionInputRequest) {
  return { sessionId: request.sessionId, requestId: request.requestId, step: request.step };
}

function interactionData(request: AgentInteractionInputRequest) {
  const common = {
    interactionId: request.interactionId,
    message: request.message,
    mode: request.mode,
    toolName: request.toolName,
    toolCallId: request.toolCallId,
    batchId: request.batchId,
    createdAt: request.createdAt,
    deadlineAt: request.deadlineAt,
  };
  return request.mode === AgentInteractionInputModes.Form
    ? { ...common, schema: request.schema }
    : {
        ...common,
        externalId: request.externalId,
        url: request.url,
        hostname: request.hostname,
      };
}

function createInteractionRequest(
  options: AgentInteractionInputWaitOptions,
  deadlineMs: number,
): AgentInteractionInputRequest {
  const common = {
    ...options.owner,
    interactionId: createOpaqueId("interaction"),
    message: options.message,
    createdAt: new Date().toISOString(),
    deadlineAt: deadlineMs ? new Date(Date.now() + deadlineMs).toISOString() : undefined,
  };
  if (options.mode === AgentInteractionInputModes.Form) {
    return { ...common, mode: options.mode, schema: structuredClone(options.schema) };
  }
  const external = resolveAgentExternalUrl(options.url);
  return {
    ...common,
    mode: options.mode,
    externalId: options.externalId,
    url: external.url,
    hostname: external.hostname,
  };
}

function normalizeDeadline(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError("Interaction input deadline must be a non-negative finite number.");
  }
  return Math.trunc(value);
}

function readAbortMessage(signal: AbortSignal | undefined): string | undefined {
  if (!signal?.aborted) return undefined;
  return signal.reason instanceof Error
    ? signal.reason.message
    : signal.reason === undefined
      ? undefined
      : String(signal.reason);
}
