import { AgentModelTextPreviewer } from "../AgentTextBudget.js";

export interface AgentCliPreviewFormatterOptions {
  model: string;
  tokenLimit: number;
}

export class AgentCliPreviewFormatter {
  private readonly previewer: AgentModelTextPreviewer;

  constructor(options: AgentCliPreviewFormatterOptions) {
    this.previewer = new AgentModelTextPreviewer(options);
  }

  previewText(value: string): string {
    return this.previewer.preview(value).text;
  }

  previewValue(value: unknown): string {
    return this.previewText(this.serialize(value));
  }

  previewStructuredValue(value: unknown): unknown {
    return this.previewBranch(value, new WeakSet<object>());
  }

  private serialize(value: unknown): string {
    return typeof value === "string"
      ? value
      : typeof value === "number" || typeof value === "boolean" || typeof value === "bigint"
        ? String(value)
        : value === null
          ? "null"
          : value === undefined
            ? "undefined"
            : this.stringify(value);
  }

  private stringify(value: unknown): string {
    try {
      return JSON.stringify(value);
    } catch {
      return "[unserializable]";
    }
  }

  private previewBranch(value: unknown, visited: WeakSet<object>): unknown {
    if (!this.isBranch(value)) {
      return this.previewValue(value);
    }

    if (visited.has(value)) {
      return "[circular]";
    }

    visited.add(value);
    return Array.isArray(value)
      ? value.map((entry) => this.previewBranch(entry, visited))
      : Object.fromEntries(
          Object.entries(value)
            .filter(([, entryValue]) => entryValue !== undefined)
            .map(([key, entryValue]) => [key, this.previewBranch(entryValue, visited)]),
        );
  }

  private isBranch(value: unknown): value is Record<string, unknown> | unknown[] {
    return Array.isArray(value) || this.isRecord(value);
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }
}
