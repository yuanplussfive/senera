import { AgentConsoleTheme } from "./AgentConsoleTheme.js";

export interface AgentConsoleTreeFormatterOptions {
  maxDepth?: number;
  maxArrayItems?: number;
  maxStringLength?: number;
}

type TreePath = Array<string | number>;

export class AgentConsoleTreeFormatter {
  private readonly maxDepth: number;
  private readonly maxArrayItems: number;
  private readonly maxStringLength: number;

  constructor(options: AgentConsoleTreeFormatterOptions = {}) {
    this.maxDepth = options.maxDepth ?? 8;
    this.maxArrayItems = options.maxArrayItems ?? 20;
    this.maxStringLength = options.maxStringLength ?? 600;
  }

  format(value: unknown): string[] {
    if (this.isBranch(value)) {
      return this.formatTopLevelBranch(value, []);
    }

    return this.formatScalarLines(value);
  }

  private formatTopLevelBranch(value: unknown, path: TreePath): string[] {
    if (Array.isArray(value)) {
      return this.formatChildren(this.arrayEntries(value), "", path);
    }

    if (this.isRecord(value)) {
      return this.formatObjectTopLevel(value, path);
    }

    return this.formatScalarLines(value);
  }

  private formatObjectTopLevel(value: Record<string, unknown>, path: TreePath): string[] {
    const entries = Object.entries(value).filter(([, item]) => item !== undefined);
    if (entries.length === 0) {
      return [AgentConsoleTheme.muted("空对象")];
    }

    const lines: string[] = [];
    for (const [key, item] of entries) {
      if (this.isBranch(item)) {
        lines.push(this.key(key));
        lines.push(...this.formatNestedBranch(item, "", [...path, key]));
      } else {
        const scalarLines = this.formatScalarLines(item);
        lines.push(`${this.key(key)}: ${scalarLines[0] ?? ""}`);
        for (const extraLine of scalarLines.slice(1)) {
          lines.push(`  ${extraLine}`);
        }
      }
    }

    return lines;
  }

  private formatNestedBranch(value: unknown, prefix: string, path: TreePath): string[] {
    if (path.length >= this.maxDepth) {
      return [`${prefix}${AgentConsoleTheme.dim("└─")} ${AgentConsoleTheme.muted("层级已折叠")}`];
    }

    if (Array.isArray(value)) {
      return this.formatChildren(this.arrayEntries(value), prefix, path);
    }

    if (this.isRecord(value)) {
      return this.formatChildren(Object.entries(value), prefix, path);
    }

    return this.formatScalarLines(value).map((line) => `${prefix}${line}`);
  }

  private formatChildren(entries: Array<[string, unknown]>, prefix: string, path: TreePath): string[] {
    const definedEntries = entries.filter(([, value]) => value !== undefined);
    const visibleEntries = definedEntries.slice(0, this.maxArrayItems);

    if (visibleEntries.length === 0) {
      return [`${prefix}${AgentConsoleTheme.dim("└─")} ${AgentConsoleTheme.muted("空")}`];
    }

    const lines: string[] = [];
    visibleEntries.forEach(([key, value], index) => {
      const isLast = index === visibleEntries.length - 1;
      const connector = isLast ? "└─" : "├─";
      const childPrefix = `${prefix}${isLast ? "   " : "│  "}`;

      if (this.isBranch(value)) {
        lines.push(`${prefix}${AgentConsoleTheme.dim(connector)} ${this.key(key)}`);
        lines.push(...this.formatNestedBranch(value, childPrefix, [...path, key]));
        return;
      }

      const scalarLines = this.formatScalarLines(value);
      lines.push(`${prefix}${AgentConsoleTheme.dim(connector)} ${this.key(key)}: ${scalarLines[0] ?? ""}`);
      for (const extraLine of scalarLines.slice(1)) {
        lines.push(`${childPrefix}${extraLine}`);
      }
    });

    const hiddenCount = definedEntries.length - visibleEntries.length;
    if (hiddenCount > 0) {
      lines.push(`${prefix}${AgentConsoleTheme.dim("└─")} ${AgentConsoleTheme.muted(`还有 ${hiddenCount} 项未显示`)}`);
    }

    return lines;
  }

  private arrayEntries(value: unknown[]): Array<[string, unknown]> {
    return value.map((item, index) => [String(index), item]);
  }

  private formatScalarLines(value: unknown): string[] {
    if (typeof value === "string") {
      return this.trimString(value)
        .split(/\r?\n/)
        .map((line) => AgentConsoleTheme.value(line));
    }

    return [this.scalar(value)];
  }

  private scalar(value: unknown): string {
    if (typeof value === "string") {
      return AgentConsoleTheme.value(this.trimString(value));
    }

    if (typeof value === "number" || typeof value === "bigint") {
      return AgentConsoleTheme.code(String(value));
    }

    if (typeof value === "boolean") {
      return value ? AgentConsoleTheme.success("true") : AgentConsoleTheme.warning("false");
    }

    if (value === null) {
      return AgentConsoleTheme.muted("null");
    }

    if (value === undefined) {
      return AgentConsoleTheme.muted("未定义");
    }

    return AgentConsoleTheme.value(String(value));
  }

  private trimString(value: string): string {
    if (value.length <= this.maxStringLength) {
      return value;
    }

    return `${value.slice(0, this.maxStringLength)}${AgentConsoleTheme.muted(`... 已截断 ${value.length - this.maxStringLength} 字符`)}`;
  }

  private key(value: string): string {
    return AgentConsoleTheme.muted(value);
  }

  private isBranch(value: unknown): value is Record<string, unknown> | unknown[] {
    return Array.isArray(value) || this.isRecord(value);
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }
}
