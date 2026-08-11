import { format, resolveConfig } from "prettier";
import {
  AgentEventChannels,
  AgentEventKinds,
  AgentEventLayers,
  AgentEventPhases,
  AgentEventSpecTable,
} from "../Source/AgentSystem/Events/AgentEventCatalog.js";
import { AgentEventObservationSpecTable } from "../Source/AgentSystem/Events/AgentEventObservationCatalog.js";
import {
  AgentRunActivities,
  AgentRunActivityCategories,
  AgentRunActivitySpecTable,
  AgentRunActivityStates,
} from "../Source/AgentSystem/Events/AgentRunEventTypes.js";
import { AgentAuthenticationSessionStates } from "../Source/AgentSystem/Auth/AgentAuthenticationProtocol.js";
import { AgentConfigSecretContract } from "../Source/AgentSystem/Config/AgentConfigSecretContract.js";
import {
  AgentWebSocketCloseCodes,
  AgentWebSocketCloseReasons,
} from "../Source/AgentSystem/WebSocket/AgentWebSocketCloseContract.js";

export const FrontendEventCatalogPath = "Frontend/src/api/generatedEventCatalog.ts";
export const FrontendEventSpecsPath = "Frontend/src/api/generatedEventSpecs.ts";
export const FrontendRuntimeDiagnosticCatalogPath = "Frontend/src/api/generatedRuntimeDiagnosticCatalog.ts";

export async function formatFrontendGeneratedSource(source: string, filePath: string): Promise<string> {
  const prettierConfig = await resolveConfig(filePath);
  return format(source, {
    ...prettierConfig,
    filepath: filePath,
  });
}

export function renderFrontendEventCatalogSource(): string {
  return [
    "// Generated from backend event and transport protocol contracts.",
    "// Run `npm run generate.frontend-events` after editing those contracts.",
    "",
    renderConstObject("EventLayers", AgentEventLayers),
    "export type EventLayer = (typeof EventLayers)[keyof typeof EventLayers];",
    "",
    renderConstObject("EventPhases", AgentEventPhases),
    "export type EventPhase = (typeof EventPhases)[keyof typeof EventPhases];",
    "",
    renderConstObject("EventKinds", AgentEventKinds),
    "export type EventKind = (typeof EventKinds)[keyof typeof EventKinds];",
    "",
    renderConstObject("EventChannels", AgentEventChannels),
    "export type EventChannel = (typeof EventChannels)[keyof typeof EventChannels];",
    "",
    renderEventTransportSpecs(),
    "",
    'export { EventSpecs } from "./generatedEventSpecs";',
    "",
    renderConstObject("RunActivities", AgentRunActivities),
    "export type RunActivity = (typeof RunActivities)[keyof typeof RunActivities];",
    "",
    renderConstObject("RunActivityCategories", AgentRunActivityCategories),
    "export type RunActivityCategory = (typeof RunActivityCategories)[keyof typeof RunActivityCategories];",
    "",
    renderConstObject("RunActivityStates", AgentRunActivityStates),
    "export type RunActivityState = (typeof RunActivityStates)[keyof typeof RunActivityStates];",
    "",
    renderRunActivitySpecs(),
    "",
    renderConstObject("AuthenticationSessionStates", AgentAuthenticationSessionStates),
    "export type AuthenticationSessionState = (typeof AuthenticationSessionStates)[keyof typeof AuthenticationSessionStates];",
    "",
    renderConstObject("ConfigSecretContract", AgentConfigSecretContract),
    "",
    renderConstObject("WebSocketCloseCodes", AgentWebSocketCloseCodes),
    "export type WebSocketCloseCode = (typeof WebSocketCloseCodes)[keyof typeof WebSocketCloseCodes];",
    "",
    renderConstObject("WebSocketCloseReasons", AgentWebSocketCloseReasons),
    "",
  ].join("\n");
}

export function renderFrontendEventSpecsSource(): string {
  return [
    "// Generated from backend event observation contracts.",
    "// Run `npm run generate.frontend-events` after editing those contracts.",
    "",
    'import type { EventKind, EventLayer, EventPhase } from "./generatedEventCatalog";',
    "",
    renderEventSpecs(),
    "",
  ].join("\n");
}

function renderEventTransportSpecs(): string {
  const entries = Object.entries(AgentEventSpecTable).flatMap(([kind, spec]) => [
    `  ${JSON.stringify(kind)}: { layer: ${JSON.stringify(spec.layer)}, phase: ${JSON.stringify(spec.phase)} },`,
  ]);
  return [
    "export const EventTransportSpecs = {",
    ...entries,
    "} as const satisfies Record<EventKind, { readonly layer: EventLayer; readonly phase: EventPhase }> ;",
  ].join("\n");
}

function renderEventSpecs(): string {
  const entries = Object.entries(AgentEventSpecTable).flatMap(([kind, spec]) => {
    const observation = AgentEventObservationSpecTable[kind as keyof typeof AgentEventObservationSpecTable];
    return [
      `  ${JSON.stringify(kind)}: {`,
      `    layer: ${JSON.stringify(spec.layer)},`,
      `    phase: ${JSON.stringify(spec.phase)},`,
      "    observation: {",
      `      retention: ${JSON.stringify(observation.retention)},`,
      "      projectionPointers: [",
      ...observation.projectionPointers.map((pointer) => `        ${JSON.stringify(pointer)},`),
      "      ],",
      ...(observation.resourceIdPointer
        ? [`      resourceIdPointer: ${JSON.stringify(observation.resourceIdPointer)},`]
        : []),
      "    },",
      "  },",
    ];
  });
  return [
    "export const EventSpecs = {",
    ...entries,
    '} as const satisfies Record<EventKind, { readonly layer: EventLayer; readonly phase: EventPhase; readonly observation: { readonly retention: "metadata" | "projection"; readonly projectionPointers: readonly string[]; readonly resourceIdPointer?: string } }>;',
  ].join("\n");
}

export function renderFrontendRuntimeDiagnosticCatalogSource(): string {
  const entries = Object.entries(AgentEventObservationSpecTable).flatMap(([kind, observation]) => {
    const diagnostic = observation.diagnostic;
    if (!diagnostic) return [];
    return [
      `  ${JSON.stringify(kind)}: {`,
      `    source: ${JSON.stringify(diagnostic.source)},`,
      `    idPointer: ${JSON.stringify(diagnostic.idPointer)},`,
      `    labelPointer: ${JSON.stringify(diagnostic.labelPointer)},`,
      ...(diagnostic.statePointer ? [`    statePointer: ${JSON.stringify(diagnostic.statePointer)},`] : []),
      ...(diagnostic.fixedState ? [`    fixedState: ${JSON.stringify(diagnostic.fixedState)},`] : []),
      `    startedAtPointer: ${JSON.stringify(diagnostic.startedAtPointer)},`,
      `    durationMsPointer: ${JSON.stringify(diagnostic.durationMsPointer)},`,
      "  },",
    ];
  });
  return [
    "// Generated from backend event observation contracts.",
    "// Run `npm run generate.frontend-events` after editing those contracts.",
    "",
    'import type { EventKind } from "./generatedEventCatalog";',
    "",
    "interface EventDiagnosticSpecBase {",
    '  readonly source: "activity" | "tool";',
    "  readonly idPointer: string;",
    "  readonly labelPointer: string;",
    "  readonly startedAtPointer: string;",
    "  readonly durationMsPointer: string;",
    "}",
    "",
    "export type EventDiagnosticSpec =",
    "  | (EventDiagnosticSpecBase & {",
    "      readonly statePointer: string;",
    "      readonly fixedState?: never;",
    "    })",
    "  | (EventDiagnosticSpecBase & {",
    "      readonly statePointer?: never;",
    '      readonly fixedState: "started" | "completed" | "failed";',
    "    });",
    "",
    "export const RuntimeDiagnosticSpecs = {",
    ...entries,
    "} as const satisfies Partial<Record<EventKind, EventDiagnosticSpec>>;",
    "",
  ].join("\n");
}

function renderRunActivitySpecs(): string {
  const entries = Object.entries(AgentRunActivitySpecTable).flatMap(([activity, spec]) => [
    `  ${JSON.stringify(activity)}: {`,
    `    category: ${JSON.stringify(spec.category)},`,
    "  },",
  ]);
  return [
    "export const RunActivitySpecs = {",
    ...entries,
    "} as const satisfies Record<RunActivity, { readonly category: RunActivityCategory }>;",
  ].join("\n");
}

function renderConstObject(name: string, values: Readonly<Record<string, string | number>>): string {
  const entries = Object.entries(values).map(([key, value]) => `  ${key}: ${JSON.stringify(value)},`);
  return [`export const ${name} = {`, ...entries, "} as const;"].join("\n");
}
