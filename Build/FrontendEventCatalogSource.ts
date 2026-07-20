import { AgentEventKinds, AgentEventLayers, AgentEventPhases } from "../Source/AgentSystem/Events/AgentEventCatalog.js";

export const FrontendEventCatalogPath = "Frontend/src/api/generatedEventCatalog.ts";

export function renderFrontendEventCatalogSource(): string {
  return [
    "// Generated from Source/AgentSystem/Events/AgentEventCatalog.ts.",
    "// Run `npm run generate.frontend-events` after editing the backend event catalog.",
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
  ].join("\n");
}

function renderConstObject(name: string, values: Readonly<Record<string, string>>): string {
  const entries = Object.entries(values).map(([key, value]) => `  ${key}: ${JSON.stringify(value)},`);
  return [`export const ${name} = {`, ...entries, "} as const;"].join("\n");
}
