import "@testing-library/jest-dom/vitest";

declare global {
  var __SENERA_DEFAULT_WS_URL__: string | undefined;
  var __SENERA_DEFAULT_MODEL_LABEL__: string | undefined;
  var __SENERA_DEFAULT_USER_NAME__: string | undefined;
  var __SENERA_EMPTY_SUGGESTIONS__: string | undefined;

  interface Window {
    __SENERA_RUNTIME_CONFIG__?: {
      webSocketUrl?: string;
      modelLabel?: string;
      userName?: string;
      emptySuggestions?: string[];
    };
  }
}

globalThis.__SENERA_DEFAULT_WS_URL__ ??= "ws://127.0.0.1:8787";
globalThis.__SENERA_DEFAULT_MODEL_LABEL__ ??= "Senera Test Model";
globalThis.__SENERA_DEFAULT_USER_NAME__ ??= "Senera";
globalThis.__SENERA_EMPTY_SUGGESTIONS__ ??= "整理日志|检查项目";

if (typeof window !== "undefined") {
  window.__SENERA_RUNTIME_CONFIG__ ??= {};
}
