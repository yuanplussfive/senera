import { useEffect, useRef, useState } from "react";
import type { FileRejection } from "react-dropzone";
import type { PresetFormat } from "../../api/eventTypes";
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
const zhNumberFormatter = new Intl.NumberFormat("zh-CN");
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
  return rejections.map((rejection) => `${rejection.file.name}: 只支持 .json、.md、.txt`);
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
  if (jsonIssue) return "JSON 异常";
  if (dirty) return "未保存";
  return active ? "已启用" : "未启用";
}

export function formatInteger(value: number): string {
  return zhNumberFormatter.format(value);
}

export function formatTokenState(state: PresetTokenState): string {
  if (state.status === "ready" && state.count !== null) {
    return `${formatInteger(state.count)} token`;
  }
  if (state.status === "error") {
    return "token 读取失败";
  }
  return state.count !== null ? `${formatInteger(state.count)} token` : "计算中";
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

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function readPresetFileFormat(file: File): PresetFormat | null {
  const name = file.name.toLowerCase();
  const option = PresetFormatOptions.find((item) =>
    item.extensions.some((extension) => name.endsWith(extension))
  );
  return option?.value ?? null;
}

function loadTokenCounter(): Promise<TokenCounter> {
  tokenCounterPromise ??= import("gpt-tokenizer").then((module) => module.countTokens);
  return tokenCounterPromise;
}

function removePresetExtension(name: string): string {
  const lowerName = name.toLocaleLowerCase();
  const extension = PresetFormatOptions
    .flatMap((option) => option.extensions)
    .find((candidate) => lowerName.endsWith(candidate));
  return extension ? name.slice(0, -extension.length) : name;
}

function readPresetFormatExtension(format: PresetFormat): string {
  return PresetFormatOptions.find((option) => option.value === format)?.extensions[0] ?? "";
}
