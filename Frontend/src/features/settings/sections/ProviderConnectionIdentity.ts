export function isProtectedProvider(providerId: string): boolean {
  return protectedProviderIds.has(providerId);
}

const protectedProviderIds = new Set(["openai", "deepseek", "anthropic", "gemini"]);

export interface ProviderPreset {
  id: string;
  label: string;
  icon: string;
  baseUrl: string;
  apiVersion?: string;
  headers?: Record<string, string>;
}

export const providerPresets: readonly ProviderPreset[] = [
  {
    id: "openai-compatible",
    label: "OpenAI Compatible",
    icon: "openai",
    baseUrl: "https://api.example.com/v1",
  },
  {
    id: "openai",
    label: "OpenAI",
    icon: "openai",
    baseUrl: "https://api.openai.com/v1",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    icon: "deepseek",
    baseUrl: "https://api.deepseek.com/v1",
  },
  {
    id: "anthropic",
    label: "Anthropic Compatible",
    icon: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    headers: { "anthropic-version": "2023-06-01" },
  },
  {
    id: "gemini",
    label: "Gemini Compatible",
    icon: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
  },
];
