import { FrontendDefaultLocale, type FrontendLocale, type FrontendLocalizedText } from "./frontendLocaleModel";
import { getFrontendLocale } from "./frontendLocaleStore";

export type BackendMessageParam = string | number | boolean | null;

export interface BackendLocalizedMessage {
  key: string;
  params: Readonly<Record<string, BackendMessageParam>>;
  text: FrontendLocalizedText;
}

export interface BackendMessageData {
  message?: string;
  localizedMessage?: BackendLocalizedMessage;
}

export function resolveBackendMessage(data: unknown, locale: FrontendLocale = getFrontendLocale()): string | undefined {
  if (!data || typeof data !== "object") return undefined;
  const candidate = data as BackendMessageData;
  const compatibilityMessage = typeof candidate.message === "string" ? candidate.message : undefined;
  if (locale === FrontendDefaultLocale && compatibilityMessage) return compatibilityMessage;
  const localized = candidate.localizedMessage?.text;
  const selected = readLocalizedText(localized, locale) ?? readLocalizedText(localized, FrontendDefaultLocale);
  return selected ?? compatibilityMessage;
}

function readLocalizedText(text: unknown, locale: FrontendLocale): string | undefined {
  if (!text || typeof text !== "object") return undefined;
  const value = (text as Partial<Record<FrontendLocale, unknown>>)[locale];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
