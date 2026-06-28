import { AgentCliDetailMode } from "../Source/AgentSystem/CliDisplay/AgentCliActivity.js";
import { AgentCliPreviewFormatter } from "../Source/AgentSystem/CliDisplay/AgentCliPreviewFormatter.js";
import { AgentConsoleTheme } from "../Source/AgentSystem/CliDisplay/AgentConsoleTheme.js";
import { AgentEventChannels, type AgentEventEnvelope } from "../Source/AgentSystem/Events/AgentEvent.js";
import type { ClientOptions } from "./CliOptions.js";
import { buildDecisionXmlPreview, previewColor } from "./CliXmlPreview.js";

export interface CliEventPrinterState {
  sessionId: string;
  pendingRequest?: { requestId: string };
  closing: boolean;
  awaitingSessionReady: boolean;
  promptOnSessionReady: boolean;
}

export interface CliEventPrinterContext {
  logger: typeof import("../Source/AgentSystem/Diagnostics/AgentLogger.js").AgentLogger.prototype;
  options: ClientOptions;
  previewFormatter: () => AgentCliPreviewFormatter;
}

const decisionXmlByStep = new Map<number, string>();
const decisionXmlByDetailId = new Map<string, { xml: string; rawXml?: string; sanitized: boolean }>();
const pendingDecisionXmlSummaryByDetailId = new Map<string, AgentEventEnvelope<string, unknown>>();

export function clearCliEventPrinterCaches(): void {
  decisionXmlByStep.clear();
  decisionXmlByDetailId.clear();
  pendingDecisionXmlSummaryByDetailId.clear();
}

export function parseEvent(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return {
      type: "raw",
      text,
    };
  }
}

export function printEvent(
  event: unknown,
  state: CliEventPrinterState,
  context: CliEventPrinterContext,
): boolean {
  if (!isEventEnvelope(event)) {
    context.logger.block("unknown", event);
    return false;
  }

  if (context.options.eventDisplayMode === "activity") {
    return printActivityEvent(event, state, context);
  }

  const envelope = event;
  const kind = envelope.kind;
  const data = normalizeRecord(envelope.data);
  const logger = context.logger;

  const printers: Record<string, () => void> = {
    "session.created": () => logger.event(envelope),
    "session.snapshot": () => logger.event(envelope),
    "session.closed": () => logger.event(envelope),
    "session.busy": () => logger.tree("session.busy", data, AgentConsoleTheme.warning),
    "session.not_found": () => logger.tree("session.not_found", data, AgentConsoleTheme.error),
    "model.delta": () => {
      if (context.options.streamXml && !context.options.livePreview) {
        logger.raw(String(data.text ?? ""));
      }
    },
    "model.stream.opened": () => undefined,
    "model.stream.aborted": () => printModelStreamAborted(envelope, context),
    "model.completed": () => undefined,
    "decision.xml.progress": () => printDecisionXmlPreview(envelope, context),
    "decision.xml.ready": () => undefined,
    "decision.xml.limit_reached": () => logger.tree("decision.xml.limit_reached", data, AgentConsoleTheme.error),
    "decision.xml.summary": () => printDecisionXmlSummary(envelope, context),
    "decision.xml.detail": () => cacheDecisionXmlDetail(envelope, context),
    "decision.parsed": () => printParsedDecision(envelope, context),
    "decision.parsed.detail": () => undefined,
    "retry.planned": () => printRetryPlanned(envelope, context),
    "retry.detail": () => printRetryDetail(envelope, context),
    "tool.results": () => printToolResultsSummary(envelope, context),
    "tool.results.detail": () => printToolResultsDetail(envelope, context),
    "final.answer": () => logger.block("final.answer", data.content ?? "", AgentConsoleTheme.success),
    "ask.user": () => logger.block("ask.user", data.question ?? "", AgentConsoleTheme.warning),
    "run.failed": () => logger.tree("run.failed", data, AgentConsoleTheme.error),
    "request.invalid": () => logger.block("request.invalid", data, AgentConsoleTheme.error),
  };

  const printer = printers[kind] ?? (() => logger.event(envelope));
  printer();

  return isTerminalEvent(envelope)
    && (!state.pendingRequest || envelope.requestId === state.pendingRequest.requestId);
}

export function isSessionReadyEvent(
  event: unknown,
  state: {
    sessionId: string;
    awaitingSessionReady: boolean;
  },
): boolean {
  if (!state.awaitingSessionReady || !isEventEnvelope(event)) {
    return false;
  }

  return (
    (event.kind === "session.created" || event.kind === "session.snapshot")
    && event.sessionId === state.sessionId
  );
}

function printActivityEvent(
  envelope: AgentEventEnvelope<string, unknown>,
  state: CliEventPrinterState,
  context: CliEventPrinterContext,
): boolean {
  const kind = envelope.kind;
  const data = normalizeRecord(envelope.data);
  const logger = context.logger;

  if (kind === "model.delta" && context.options.streamXml && !context.options.livePreview) {
    logger.raw(String(data.text ?? ""));
    return false;
  }

  cacheActivitySideData(envelope, context);
  const printers: Record<string, () => void> = {
    "session.created": () => logger.event(envelope),
    "session.snapshot": () => logger.event(envelope),
    "session.closed": () => logger.event(envelope),
    "session.busy": () => logger.tree("session.busy", data, AgentConsoleTheme.warning),
    "session.not_found": () => logger.tree("session.not_found", data, AgentConsoleTheme.error),
    "run.started": () => logger.event(envelope),
    "prompt.summary": () => logger.event(envelope),
    "prompt.rendered": () => logger.event(envelope),
    "model.started": () => logger.event(envelope),
    "model.stream.opened": () => logger.event(envelope),
    "model.delta": () => undefined,
    "model.completed": () => undefined,
    "model.stream.aborted": () => printModelStreamAborted(envelope, context),
    "decision.xml.progress": () => printDecisionXmlPreview(envelope, context),
    "decision.xml.ready": () => logger.event(envelope),
    "decision.xml.limit_reached": () => logger.tree("decision.xml.limit_reached", data, AgentConsoleTheme.error),
    "decision.xml.summary": () => context.options.showXml ? printDecisionXmlSummary(envelope, context) : undefined,
    "decision.xml.detail": () => undefined,
    "decision.parsed": () => printParsedDecision(envelope, context),
    "decision.parsed.detail": () => printToolCallPreviews(envelope, context),
    "retry.planned": () => printRetryPlanned(envelope, context),
    "retry.detail": () => shouldRenderErrorDetails(context.options) || context.options.showXml ? printRetryDetail(envelope, context) : undefined,
    "tool.calls.planned": () => logger.event(envelope),
    "tool.call.started": () => logger.event(envelope),
    "tool.call.completed": () => logger.event(envelope),
    "tool.call.failed": () => logger.tree("tool.call.failed", previewStructuredRecord(data, context), AgentConsoleTheme.error),
    "tool.results": () => logger.event(envelope),
    "tool.results.detail": () => printToolResultPreviews(envelope, context),
    "final.answer": () => logger.block("final.answer", data.content ?? "", AgentConsoleTheme.success),
    "ask.user": () => logger.block("ask.user", data.question ?? "", AgentConsoleTheme.warning),
    "run.failed": () => logger.tree("run.failed", data, AgentConsoleTheme.error),
    "run.completed": () => logger.event(envelope),
    "request.invalid": () => logger.block("request.invalid", data, AgentConsoleTheme.error),
  };

  (printers[kind] ?? (() => logger.event(envelope)))();

  return isTerminalEvent(envelope)
    && (!state.pendingRequest || envelope.requestId === state.pendingRequest.requestId);
}

function cacheActivitySideData(
  envelope: AgentEventEnvelope<string, unknown>,
  context: CliEventPrinterContext,
): void {
  if (envelope.kind === "decision.xml.detail") {
    cacheDecisionXmlDetail(envelope, context);
    return;
  }

  if (envelope.kind === "decision.xml.summary") {
    cacheDecisionXmlSummary(envelope);
  }
}

function printDecisionXmlPreview(
  envelope: AgentEventEnvelope<string, unknown>,
  context: CliEventPrinterContext,
): void {
  if (!context.options.livePreview) return;

  const data = normalizeRecord(envelope.data);
  const preview = buildDecisionXmlPreview({
    step: envelope.step,
    xml: String(data.xml ?? ""),
    state: String(data.state ?? "collecting"),
    mode: context.options.previewMode,
  });
  return context.options.previewMode === "block"
    ? context.logger.replaceBlock("xml.preview", preview.block, previewColor(String(data.state ?? "collecting")))
    : context.logger.replaceLine("xml.preview", preview.line, previewColor(String(data.state ?? "collecting")));
}

function cacheDecisionXmlSummary(envelope: AgentEventEnvelope<string, unknown>): void {
  const step = Number(envelope.step);
  const data = normalizeRecord(envelope.data);
  const detailId = String(data.detailId ?? "");
  const cached = detailId.length > 0 ? decisionXmlByDetailId.get(detailId) : undefined;
  const xml = cached?.xml ?? "";
  if (Number.isFinite(step) && xml.length > 0) {
    decisionXmlByStep.set(step, xml);
  }
}

function cacheDecisionXmlDetail(
  envelope: AgentEventEnvelope<string, unknown>,
  context: CliEventPrinterContext,
): void {
  const data = normalizeRecord(envelope.data);
  const detailId = String(data.detailId ?? "");
  if (detailId.length === 0) return;

  decisionXmlByDetailId.set(detailId, {
    xml: String(data.xml ?? ""),
    rawXml: typeof data.rawXml === "string" ? data.rawXml : undefined,
    sanitized: Boolean(data.sanitized),
  });

  const pending = pendingDecisionXmlSummaryByDetailId.get(detailId);
  if (pending) {
    pendingDecisionXmlSummaryByDetailId.delete(detailId);
    printDecisionXmlSummary(pending, context);
  }
}

function printDecisionXmlSummary(
  envelope: AgentEventEnvelope<string, unknown>,
  context: CliEventPrinterContext,
): void {
  cacheDecisionXmlSummary(envelope);
  if (!context.options.showXml) return;

  const data = normalizeRecord(envelope.data);
  const detailId = String(data.detailId ?? "");
  const cached = decisionXmlByDetailId.get(detailId);
  if (!cached) {
    pendingDecisionXmlSummaryByDetailId.set(detailId, envelope);
    return;
  }

  context.logger.block(
    cached.sanitized ? "decision.xml.sanitized" : "decision.xml",
    cached.xml,
    AgentConsoleTheme.xml,
  );

  if (cached.sanitized && cached.rawXml) {
    context.logger.block("decision.xml.raw", cached.rawXml, AgentConsoleTheme.frame);
  }
}

function printParsedDecision(
  envelope: AgentEventEnvelope<string, unknown>,
  context: CliEventPrinterContext,
): void {
  const data = normalizeRecord(envelope.data);
  context.logger.tree(
    "decision.parsed",
    {
      step: envelope.step,
      decisionKind: data.decisionKind,
      root: data.root,
      detailId: data.detailId,
    },
    AgentConsoleTheme.action,
  );
}

function printRetryPlanned(
  envelope: AgentEventEnvelope<string, unknown>,
  context: CliEventPrinterContext,
): void {
  context.logger.event(envelope);
  context.logger.tree("retry.planned", previewStructuredRecord(envelope.data, context), AgentConsoleTheme.retry);
}

function printRetryDetail(
  envelope: AgentEventEnvelope<string, unknown>,
  context: CliEventPrinterContext,
): void {
  const data = normalizeRecord(envelope.data);
  const instruction = normalizeRecord(data.instruction);
  context.logger.tree(
    "retry.detail",
    previewStructuredRecord(pick(instruction, ["code", "message", "retryable", "details"]), context),
    AgentConsoleTheme.retry,
  );

  const diagnostics = instruction.diagnostics;
  if (Array.isArray(diagnostics) && diagnostics.length > 0) {
    context.logger.tree("retry.diagnostics", previewStructuredValue(diagnostics, context), AgentConsoleTheme.error);
  }

  const repairPrompt = instruction.repairPrompt;
  if (typeof repairPrompt === "string" && repairPrompt.length > 0) {
    context.logger.block("retry.repair_prompt", context.previewFormatter().previewText(repairPrompt), AgentConsoleTheme.retry);
  }

  const step = Number(envelope.step);
  const xml = decisionXmlByStep.get(step);
  if (xml) {
    context.logger.block("decision.xml 需要修复", xml, AgentConsoleTheme.xml);
  }
}

function printToolResultsSummary(
  envelope: AgentEventEnvelope<string, unknown>,
  context: CliEventPrinterContext,
): void {
  context.logger.event(envelope);
  context.logger.tree("tool.results", previewStructuredRecord(envelope.data, context), AgentConsoleTheme.tool);
}

function printToolResultsDetail(
  envelope: AgentEventEnvelope<string, unknown>,
  context: CliEventPrinterContext,
): void {
  const data = normalizeRecord(envelope.data);
  context.logger.tree("tool.results.detail", data.value, AgentConsoleTheme.tool);

  if (context.options.showXml) {
    context.logger.block("tool.results.xml", data.xml ?? "", AgentConsoleTheme.xml);
  }
}

export function printUserRequest(input: string, context: CliEventPrinterContext): void {
  context.logger.block(
    "user.request",
    context.previewFormatter().previewText(input),
    AgentConsoleTheme.brand,
  );
}

function printToolCallPreviews(
  envelope: AgentEventEnvelope<string, unknown>,
  context: CliEventPrinterContext,
): void {
  if (!shouldRenderToolDetails(context.options)) return;

  const payload = normalizeRecord(normalizeRecord(envelope.data).payload);
  const calls = Array.isArray(payload.tool_call) ? payload.tool_call : [];

  calls
    .map((entry) => normalizeRecord(entry))
    .forEach((call, index) => {
      context.logger.tree(
        "tool.call",
        buildToolCallTree({
          step: envelope.step,
          index: index + 1,
          name: call.name,
          arguments: call.arguments ?? {},
        }, context),
        AgentConsoleTheme.tool,
      );
    });
}

function printToolResultPreviews(
  envelope: AgentEventEnvelope<string, unknown>,
  context: CliEventPrinterContext,
): void {
  const data = normalizeRecord(envelope.data);
  const value = Array.isArray(data.value) ? data.value : [];

  if (shouldRenderToolDetails(context.options)) {
    value
      .map((entry) => normalizeRecord(entry))
      .forEach((entry, index) => {
        context.logger.tree(
          "tool.result",
          buildToolResultTree({
            step: envelope.step,
            index: index + 1,
            entry,
          }, context),
          AgentConsoleTheme.tool,
        );
      });
  }

  if (context.options.showXml) {
    context.logger.block("tool.results.xml", data.xml ?? "", AgentConsoleTheme.xml);
  }
}

function printModelStreamAborted(
  envelope: AgentEventEnvelope<string, unknown>,
  context: CliEventPrinterContext,
): void {
  const reason = String(normalizeRecord(envelope.data).reason ?? "");
  if (reason === "xml_root_closed") return;
  context.logger.event(envelope);
}

function buildToolCallTree(input: {
  step: number | undefined;
  index: number;
  name: unknown;
  arguments: unknown;
}, context: CliEventPrinterContext): Record<string, unknown> {
  return {
    step: input.step,
    index: input.index,
    name: input.name,
    arguments: context.previewFormatter().previewStructuredValue(input.arguments),
  };
}

function buildToolResultTree(input: {
  step: number | undefined;
  index: number;
  entry: Record<string, unknown>;
}, context: CliEventPrinterContext): Record<string, unknown> {
  const runtime = normalizeRecord(input.entry.runtime);
  const request = normalizeRecord(input.entry.request);
  const response = normalizeRecord(input.entry.response);

  return {
    step: input.step,
    index: input.index,
    call_id: context.previewFormatter().previewValue(input.entry.callId ?? runtime.call_id ?? ""),
    name: context.previewFormatter().previewValue(input.entry.name ?? ""),
    request: context.previewFormatter().previewStructuredValue(
      request.arguments ?? input.entry.arguments ?? {},
    ),
    response: context.previewFormatter().previewStructuredValue(
      response.result ?? input.entry.result ?? {},
    ),
  };
}

function normalizeRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function pick(source: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  return keys.reduce<Record<string, unknown>>((output, key) => (
    source[key] !== undefined
      ? { ...output, [key]: source[key] }
      : output
  ), {});
}

function shouldRenderToolDetails(options: ClientOptions): boolean {
  return options.detailMode === AgentCliDetailMode.Tools || options.detailMode === AgentCliDetailMode.All;
}

function shouldRenderErrorDetails(options: ClientOptions): boolean {
  return options.detailMode === AgentCliDetailMode.Errors || options.detailMode === AgentCliDetailMode.All;
}

function previewStructuredValue(value: unknown, context: CliEventPrinterContext): unknown {
  return context.previewFormatter().previewStructuredValue(value);
}

function previewStructuredRecord(value: unknown, context: CliEventPrinterContext): Record<string, unknown> {
  return normalizeRecord(previewStructuredValue(value, context));
}

function isTerminalEvent(event: AgentEventEnvelope<string, unknown>): boolean {
  return event.kind === "run.completed" || event.kind === "run.failed" || event.kind === "request.invalid";
}

function isEventEnvelope(value: unknown): value is AgentEventEnvelope<string, unknown> {
  return Boolean(
    value
    && typeof value === "object"
    && !Array.isArray(value)
    && (value as { channel?: unknown }).channel === AgentEventChannels.AgentEvent
    && typeof (value as { kind?: unknown }).kind === "string",
  );
}
