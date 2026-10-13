import type { ProviderModelEndpointKind } from "../../../api/providerModelCommandTypes";

export function isProtectedProvider(providerId: string): boolean {
  return protectedProviderIds.has(providerId);
}

const protectedProviderIds = new Set(["openai", "deepseek", "anthropic", "gemini"]);

export interface ProviderPreset {
  id: string;
  label: string;
  icon: string;
  endpoint: ProviderModelEndpointKind;
  baseUrl: string;
  apiVersion?: string;
  headers?: Record<string, string>;
}

export const providerPresets: readonly ProviderPreset[] = [
  {
    id: "openai-chat-completions",
    label: "OpenAI Chat Completions",
    icon: "openai",
    endpoint: "ChatCompletions",
    baseUrl: "https://api.openai.com/v1",
  },
  {
    id: "openai-responses",
    label: "OpenAI Responses",
    icon: "openai",
    endpoint: "Responses",
    baseUrl: "https://api.openai.com/v1",
  },
  {
    id: "anthropic-messages",
    label: "Anthropic Claude Messages",
    icon: "anthropic",
    endpoint: "ClaudeMessages",
    baseUrl: "https://api.anthropic.com/v1",
    headers: { "anthropic-version": "2023-06-01" },
  },
  {
    id: "gemini-generate-content",
    label: "Google Gemini Generate Content",
    icon: "gemini",
    endpoint: "GoogleGenerateContent",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
  },
];
