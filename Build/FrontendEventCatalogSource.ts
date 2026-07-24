import { AgentEventKinds, AgentEventLayers, AgentEventPhases } from "../Source/AgentSystem/Events/AgentEventCatalog.js";
import { AgentAuthenticationSessionStates } from "../Source/AgentSystem/Auth/AgentAuthenticationProtocol.js";
import {
  AgentWebSocketCloseCodes,
  AgentWebSocketCloseReasons,
} from "../Source/AgentSystem/WebSocket/AgentWebSocketCloseContract.js";

export const FrontendEventCatalogPath = "Frontend/src/api/generatedEventCatalog.ts";

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
    renderConstObject("AuthenticationSessionStates", AgentAuthenticationSessionStates),
    "export type AuthenticationSessionState = (typeof AuthenticationSessionStates)[keyof typeof AuthenticationSessionStates];",
    "",
    renderConstObject("WebSocketCloseCodes", AgentWebSocketCloseCodes),
    "export type WebSocketCloseCode = (typeof WebSocketCloseCodes)[keyof typeof WebSocketCloseCodes];",
    "",
    renderConstObject("WebSocketCloseReasons", AgentWebSocketCloseReasons),
    "",
  ].join("\n");
}

function renderConstObject(name: string, values: Readonly<Record<string, string | number>>): string {
  const entries = Object.entries(values).map(([key, value]) => `  ${key}: ${JSON.stringify(value)},`);
  return [`export const ${name} = {`, ...entries, "} as const;"].join("\n");
}
