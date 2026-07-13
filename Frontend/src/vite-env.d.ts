/// <reference types="vite/client" />

declare const __SENERA_DEFAULT_WS_URL__: string;
declare const __SENERA_DEFAULT_MODEL_LABEL__: string;
declare const __SENERA_DEFAULT_USER_NAME__: string;
declare const __SENERA_EMPTY_SUGGESTIONS__: string;
declare const __SENERA_APP_VERSION__: string;
declare const __SENERA_FRONTEND_VERSION__: string;

interface Window {
  __SENERA_RUNTIME_CONFIG__?: {
    webSocketUrl?: string;
    modelLabel?: string;
    userName?: string;
    emptySuggestions?: string[];
  };
}

declare module "gpt-tokenizer" {
  export function countTokens(text: string): number;
}
