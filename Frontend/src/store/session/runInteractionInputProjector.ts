import {
  EventKinds,
  type InteractionInputRequestedData,
  type InteractionInputResolvedData,
} from "../../api/eventTypes";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { readCurrentRun, type RunEventHandlerMap } from "./runEventProjectionTypes";
import { syncRunActiveFlags, touchRun } from "./sessionRunProjection";
import { upsertStep } from "./sessionProjectorCore";
import type { InteractionInputRunRecord, RunRecord } from "./types";

export const runInteractionInputEventHandlers = {
  [EventKinds.InteractionInputRequested]: (state, env) => {
    const run = readCurrentRun(state, env);
    if (!run) return;
    const data = normalizeInteractionData(env.data as InteractionInputRequestedData);
    upsertInteraction(run, { ...data });
    upsertStep(run, {
      id: interactionStepId(data.interactionId),
      kind: "tool",
      title: frontendMessage("interaction.input.pending"),
      description: `${data.toolName} · ${data.message}`,
      status: "pending",
      startedAt: data.createdAt,
      toolName: data.toolName,
      callId: data.toolCallId,
      detailJson: interactionDetail(data),
    });
  },
  [EventKinds.InteractionInputResolved]: (state, env) => {
    const run = readCurrentRun(state, env);
    if (!run) return;
    const data = normalizeInteractionData(env.data as InteractionInputResolvedData);
    upsertInteraction(run, {
      ...data,
      resolutionPending: false,
      pendingAction: undefined,
    });
    upsertStep(run, {
      id: interactionStepId(data.interactionId),
      kind: "tool",
      title: frontendMessage(
        data.status === "external_pending"
          ? "interaction.input.externalPending"
          : interactionResolutionMessage[data.action],
      ),
      description: `${data.toolName} · ${data.resolutionMessage || data.message}`,
      status: data.status === "external_pending" ? "running" : data.action === "accept" ? "done" : "failed",
      startedAt: data.createdAt,
      endedAt: data.status === "external_pending" ? undefined : data.resolvedAt,
      toolName: data.toolName,
      callId: data.toolCallId,
      detailJson: data.content ?? interactionDetail(data),
    });
  },
} satisfies RunEventHandlerMap;

const interactionResolutionMessage = {
  accept: "interaction.input.accept",
  decline: "interaction.input.decline",
  cancel: "interaction.input.cancel",
} as const;

function interactionStepId(interactionId: string): string {
  return `interaction-input-${interactionId}`;
}

function normalizeInteractionData<T extends InteractionInputRequestedData | InteractionInputResolvedData>(data: T): T {
  if (data.mode) return data;
  return { ...data, mode: "form" } as T;
}

function interactionDetail(data: InteractionInputRequestedData | InteractionInputResolvedData): unknown {
  return data.mode === "form" ? data.schema : { externalId: data.externalId, url: data.url, hostname: data.hostname };
}

function upsertInteraction(run: RunRecord, interaction: InteractionInputRunRecord): void {
  const entries = run.interactionInputs ?? [];
  const index = entries.findIndex((entry) => entry.interactionId === interaction.interactionId);
  if (index >= 0) entries[index] = { ...entries[index], ...interaction };
  else entries.push(interaction);
  run.interactionInputs = entries;
  syncRunActiveFlags(run);
  touchRun(run);
}
