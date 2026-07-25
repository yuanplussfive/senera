export interface SeneraRuntimeConfig {
  webSocketUrl?: string;
  httpBaseUrl?: string;
  modelLabel?: string;
  userName?: string;
  emptySuggestions?: string[];
}

export function readSeneraRuntimeConfig(): SeneraRuntimeConfig {
  return window.__SENERA_RUNTIME_CONFIG__ ?? {};
}

export function resolveRuntimeWebSocketUrl(buildTimeUrl: string): string {
  const runtime = readSeneraRuntimeConfig();
  if (Object.hasOwn(runtime, "webSocketUrl")) {
    return normalizeWebSocketUrl(runtime.webSocketUrl ?? "");
  }

  return normalizeWebSocketUrl(buildTimeUrl);
}

export function resolveRuntimeHttpBaseUrl(webSocketUrl: string): string {
  const runtime = readSeneraRuntimeConfig();
  if (Object.hasOwn(runtime, "httpBaseUrl")) {
    return normalizeHttpBaseUrl(runtime.httpBaseUrl ?? "");
  }

  return projectWebSocketUrlToHttpBaseUrl(webSocketUrl);
}

export function resolveRuntimeEmptySuggestions(buildTimeValue?: string): string[] | undefined {
  const runtimeSuggestions = readSeneraRuntimeConfig().emptySuggestions;
  if (runtimeSuggestions) {
    return runtimeSuggestions.map((suggestion) => suggestion.trim()).filter(Boolean);
  }

  return buildTimeValue
    ?.split("|")
    .map((suggestion) => suggestion.trim())
    .filter(Boolean);
}

function normalizeWebSocketUrl(value: string): string {
  const configured = value.trim();
  if (configured.length > 0) {
    return configured;
  }

  const url = new URL(window.location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url.toString();
}

function normalizeHttpBaseUrl(value: string): string {
  const configured = value.trim();
  const url = new URL(configured || window.location.href, window.location.href);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Senera HTTP base URL must use HTTP or HTTPS: ${url.protocol}`);
  }
  return url.origin;
}

function projectWebSocketUrlToHttpBaseUrl(webSocketUrl: string): string {
  const url = new URL(webSocketUrl, window.location.href);
  if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new Error(`Senera WebSocket URL must use WS or WSS: ${url.protocol}`);
  }
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  return url.origin;
}
