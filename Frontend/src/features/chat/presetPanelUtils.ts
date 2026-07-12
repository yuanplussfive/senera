import { useEffect, useRef, useState } from "react";
import type { FileRejection } from "react-dropzone";
import type { PresetFormat } from "../../api/eventTypes";
import { FrontendDefaultLocale, frontendMessage } from "../../i18n/frontendMessageCatalog";
import type { CodeTextEditorLanguage } from "../../shared/code/CodeTextEditor";

export type PresetImportEntry = {
  name: string;
  format: PresetFormat;
  content: string;
};

export type PresetEditorStats = {
  lines: number;
  characters: number;
  bytes: number;
};

export type PresetTokenState = {
  status: "idle" | "loading" | "ready" | "error";
  count: number | null;
};

type TokenCounter = (content: string) => number;

const PresetTokenCountDelayMs = 120;
const numberFormatter = new Intl.NumberFormat(FrontendDefaultLocale);
let tokenCounterPromise: Promise<TokenCounter> | null = null;

export const PresetFormatOptions: Array<{
  value: PresetFormat;
  label: string;
  extensions: string[];
}> = [
  { value: "markdown", label: ".md", extensions: [".md"] },
  { value: "text", label: ".txt", extensions: [".txt"] },
  { value: "json", label: ".json", extensions: [".json"] },
];

export const PresetEditorLanguages: Record<PresetFormat, CodeTextEditorLanguage> = {
  json: "json",
  markdown: "markdown",
  text: "text",
};

export async function readPresetImportEntries(files: readonly File[]): Promise<{
  entries: PresetImportEntry[];
  rejected: string[];
}> {
  const entries: PresetImportEntry[] = [];
  const rejected: string[] = [];

  for (const file of files) {
    const format = readPresetFileFormat(file);
    if (!format) {
      rejected.push(file.name);
      continue;
    }

    entries.push({
      name: file.name.trim(),
      format,
      content: await file.text(),
    });
  }

  return { entries, rejected };
}

export function validateDraft(format: PresetFormat, content: string): string | null {
  if (format !== "json") {
    return null;
  }

  try {
    JSON.parse(content);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

export function describeRejectedImports(rejections: readonly FileRejection[]): string[] {
  return rejections.map((rejection) =>
    frontendMessage("preset.ui.unsupportedFile", {
      name: rejection.file.name,
    }),
  );
}

export function usePresetTokenCount(content: string, enabled: boolean): PresetTokenState {
  const requestId = useRef(0);
  const [state, setState] = useState<PresetTokenState>({
    status: enabled ? "loading" : "idle",
    count: null,
  });

  useEffect(() => {
    if (!enabled) {
      setState({ status: "idle", count: null });
      return;
    }

    const currentRequestId = requestId.current + 1;
    requestId.current = currentRequestId;
    const timer = window.setTimeout(() => {
      setState((previous) => ({
        status: "loading",
        count: previous.count,
      }));

      void loadTokenCounter()
        .then((countTokens) => {
          if (requestId.current !== currentRequestId) return;
          setState({
            status: "ready",
            count: countTokens(content),
          });
        })
        .catch(() => {
          if (requestId.current !== currentRequestId) return;
          setState({ status: "error", count: null });
        });
    }, PresetTokenCountDelayMs);

    return () => {
      window.clearTimeout(timer);
    };
  }, [content, enabled]);

  return state;
}

export function readEditorStats(content: string): PresetEditorStats {
  return {
    lines: content.length === 0 ? 1 : content.split(/\r\n|\r|\n/).length,
    characters: content.length,
    bytes: new TextEncoder().encode(content).length,
  };
}

export function readPresetStatusLabel({
  active,
  dirty,
  jsonIssue,
}: {
  active: boolean;
  dirty: boolean;
  jsonIssue: string | null;
}): string {
  if (jsonIssue) return frontendMessage("preset.ui.jsonInvalid");
  if (dirty) return frontendMessage("preset.ui.unsaved");
  return frontendMessage(active ? "preset.ui.enabled" : "preset.ui.disabled");
}

export function formatInteger(value: number): string {
  return numberFormatter.format(value);
}

export function formatTokenState(state: PresetTokenState): string {
  if (state.status === "ready" && state.count !== null) {
    return frontendMessage("preset.ui.tokenCount", { count: formatInteger(state.count) });
  }
  if (state.status === "error") {
    return frontendMessage("preset.ui.tokenFailed");
  }
  return state.count !== null
    ? frontendMessage("preset.ui.tokenCount", { count: formatInteger(state.count) })
    : frontendMessage("preset.ui.calculating");
}

export function readPresetDisplayName(name: string): string {
  return removePresetExtension(name.trim());
}

export function withPresetFormatExtension(name: string, format: PresetFormat): string {
  const baseName = removePresetExtension(name.trim());
  if (!baseName) {
    return "";
  }

  return `${baseName}${readPresetFormatExtension(format)}`;
}

export function formatPresetTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(FrontendDefaultLocale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function readPresetFileFormat(file: File): PresetFormat | null {
  const name = file.name.toLowerCase();
  const option = PresetFormatOptions.find((item) => item.extensions.some((extension) => name.endsWith(extension)));
  return option?.value ?? null;
}

function loadTokenCounter(): Promise<TokenCounter> {
  tokenCounterPromise ??= import("gpt-tokenizer").then((module) => module.countTokens);
  return tokenCounterPromise;
}

function removePresetExtension(name: string): string {
  const lowerName = name.toLocaleLowerCase();
  const extension = PresetFormatOptions.flatMap((option) => option.extensions).find((candidate) =>
    lowerName.endsWith(candidate),
  );
  return extension ? name.slice(0, -extension.length) : name;
}

function readPresetFormatExtension(format: PresetFormat): string {
  return PresetFormatOptions.find((option) => option.value === format)?.extensions[0] ?? "";
}
