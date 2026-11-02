import { AgentOneBot11ClientSocketPath, readAgentOneBot11ClientRoute } from "../AgentChannelClientRoutes.js";
import { installAgentQqClientDocumentContext } from "./AgentQqClientDocumentContext.js";
import {
  readAgentQqClientPreferencesKey,
  parseAgentQqClientPreferences,
  serializeAgentQqClientPreferences,
} from "./AgentQqClientPreferences.js";

// Runs before the QQ document mounts. The host authenticates the same-origin
// protocol socket using its session; no separate gateway credentials are needed.
const route = readAgentOneBot11ClientRoute(window.location.pathname);
if (!route) throw new Error("Senera QQ requires a workspace-scoped host entry.");
installAgentQqClientDocumentContext(document, route);
const endpoint = new URL(`${route.root}${AgentOneBot11ClientSocketPath}`, window.location.href);
endpoint.protocol = endpoint.protocol === "https:" ? "wss:" : "ws:";
const storageKey = readAgentQqClientPreferencesKey();
const options = parseAgentQqClientPreferences(localStorage.getItem(storageKey));
options.address = encodeURIComponent(endpoint.toString());
options.auto_connect ??= "true";
delete options.save_password;
delete options.connection_history;
localStorage.setItem(storageKey, serializeAgentQqClientPreferences(options));
