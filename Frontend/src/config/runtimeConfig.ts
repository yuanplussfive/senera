export interface SeneraRuntimeConfig {
  webSocketUrl?: string;
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
