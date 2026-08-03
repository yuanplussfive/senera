import { z } from "zod";

export const AgentExtensionLocales = {
  ZhCn: "zh-CN",
  EnUs: "en-US",
} as const;

export type AgentExtensionLocale = (typeof AgentExtensionLocales)[keyof typeof AgentExtensionLocales];

export const AgentExtensionLocalizedTextSchema = z
  .object({
    [AgentExtensionLocales.ZhCn]: z.string().trim().min(1),
    [AgentExtensionLocales.EnUs]: z.string().trim().min(1),
  })
  .strict();

export type AgentExtensionLocalizedText = z.infer<typeof AgentExtensionLocalizedTextSchema>;

export function resolveAgentExtensionLocalizedText(
  text: AgentExtensionLocalizedText,
  locale: AgentExtensionLocale = AgentExtensionLocales.ZhCn,
): string {
  return text[locale] || text[AgentExtensionLocales.ZhCn];
}
