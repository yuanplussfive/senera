import * as readline from "node:readline";
import { AgentConsoleTheme, colorByEventType } from "../TerminalDisplay/AgentConsoleTheme.js";
import {
  AgentConsoleTreeFormatter,
  type AgentConsoleTreeFormatterOptions,
} from "../TerminalDisplay/AgentConsoleTreeFormatter.js";
import type { AgentEventEnvelope } from "../Events/AgentEvent.js";
import { renderAgentEventDisplay, type AgentEventDisplayMode } from "../TerminalDisplay/AgentEventDisplayCatalog.js";
import { measureTerminalWidth } from "../Text/AgentTerminalText.js";

export interface AgentLoggerOptions {
  verbose?: boolean;
  eventDisplayMode?: AgentEventDisplayMode;
  output?: NodeJS.WriteStream;
}

export class AgentLogger {
  private readonly treeFormatter: AgentConsoleTreeFormatter;
  private readonly eventDisplayMode: AgentEventDisplayMode;
  private readonly output: NodeJS.WriteStream;
  private transientRowCount = 0;

  constructor(private readonly options: AgentLoggerOptions = {}) {
    this.treeFormatter = new AgentConsoleTreeFormatter({
      maxDepth: options.verbose ? 16 : 8,
      maxArrayItems: options.verbose ? 80 : 20,
      maxStringLength: options.verbose ? 2400 : 600,
    });
    this.eventDisplayMode = options.eventDisplayMode ?? "compact";
    this.output = options.output ?? process.stdout;
  }

  banner(title: string, details: Record<string, unknown> = {}): void {
    this.clearTransient();
    this.writeLines(this.renderBannerLines(title, details));
  }

  info(message: string, details: Record<string, unknown> = {}): void {
    this.clearTransient();
    this.line("info", AgentConsoleTheme.brand, message, details);
  }

  success(message: string, details: Record<string, unknown> = {}): void {
    this.clearTransient();
    this.line("ok", AgentConsoleTheme.success, message, details);
  }

  warn(message: string, details: Record<string, unknown> = {}): void {
    this.clearTransient();
    this.line("warn", AgentConsoleTheme.warning, message, details);
  }

  error(message: string, details: Record<string, unknown> = {}): void {
    this.clearTransient();
    this.line("error", AgentConsoleTheme.error, message, details);
  }

  raw(text: string): void {
    this.output.write(AgentConsoleTheme.xml(text));
  }

  event(event: AgentEventEnvelope<string, unknown>): void {
    this.clearTransient();
    const color = colorByEventType(event.kind);
    const rendered = renderAgentEventDisplay(event, this.eventDisplayMode);
    this.line(rendered.label, color, rendered.message, rendered.details, rendered.tokens);
  }

  block(title: string, content: unknown, color: (value: string) => string = AgentConsoleTheme.frame): void {
    this.clearTransient();
    this.writeLines(this.renderBlockLines(title, content, color));
  }

  tree(title: string, content: unknown, color: (value: string) => string = AgentConsoleTheme.frame): void {
    this.block(title, content, color);
  }

  fullTree(title: string, content: unknown, color: (value: string) => string = AgentConsoleTheme.frame): void {
    this.clearTransient();
    this.writeLines(
      this.renderBlockLines(title, content, color, {
        maxDepth: Number.MAX_SAFE_INTEGER,
        maxArrayItems: Number.MAX_SAFE_INTEGER,
        maxStringLength: Number.MAX_SAFE_INTEGER,
      }),
    );
  }

  replaceBlock(title: string, content: unknown, color: (value: string) => string = AgentConsoleTheme.frame): void {
    if (!this.output.isTTY) {
      return;
    }

    this.rewriteTransient(this.renderBlockLines(title, content, color));
  }

  replaceLine(label: string, content: string, color: (value: string) => string = AgentConsoleTheme.frame): void {
    if (!this.output.isTTY) {
      return;
    }

    this.rewriteTransient([`${color(label.padEnd(16))} ${AgentConsoleTheme.value(content)}`]);
  }

  replaceView(lines: string[]): void {
    if (!this.output.isTTY) {
      this.writeLines(lines);
      return;
    }

    this.rewriteTransient(lines);
  }

  clearTransient(): void {
    if (!this.output.isTTY || this.transientRowCount === 0) {
      return;
    }

    this.rewriteTransient([]);
  }

  private line(
    label: string,
    color: (value: string) => string,
    message: string,
    details: Record<string, unknown>,
    tokens: string[] = [],
  ): void {
    const prefix = color(this.padLabel(label, 20));
    const suffix = this.inlineDetails(details, tokens);
    this.writeLine(`${prefix} ${AgentConsoleTheme.value(message)}${suffix}`);
  }

  private inlineDetails(details: Record<string, unknown>, tokens: string[] = []): string {
    const segments = [
      ...tokens,
      ...Object.entries(details)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => `${key}=${this.inlineValue(value)}`),
    ];
    if (segments.length === 0) {
      return "";
    }

    return AgentConsoleTheme.dim(`  ${segments.join("  ")}`);
  }

  private padLabel(value: string, width: number): string {
    const currentWidth = measureTerminalWidth(value);
    return currentWidth >= width ? value : `${value}${" ".repeat(width - currentWidth)}`;
  }

  private key(value: string): string {
    return AgentConsoleTheme.muted(`${value}:`);
  }

  private value(value: unknown): string {
    return AgentConsoleTheme.value(this.inlineValue(value));
  }

  private blockLines(value: unknown, options?: AgentConsoleTreeFormatterOptions): string[] {
    if (typeof value === "string") {
      return value.split(/\r?\n/);
    }

    return options ? new AgentConsoleTreeFormatter(options).format(value) : this.treeFormatter.format(value);
  }

  private renderBannerLines(title: string, details: Record<string, unknown>): string[] {
    return [
      "",
      `${AgentConsoleTheme.brand("╭─")} ${AgentConsoleTheme.label(title)}`,
      ...Object.entries(details).map(
        ([key, value]) => `${AgentConsoleTheme.brand("│")} ${this.key(key)} ${this.value(value)}`,
      ),
      AgentConsoleTheme.brand("╰─"),
    ];
  }

  private renderBlockLines(
    title: string,
    content: unknown,
    color: (value: string) => string,
    options?: AgentConsoleTreeFormatterOptions,
  ): string[] {
    return [
      `${color("╭─")} ${AgentConsoleTheme.label(title)}`,
      ...this.blockLines(content, options).map((line) => `${color("│")} ${line}`),
      color("╰─"),
    ];
  }

  private writeLines(lines: string[]): void {
    for (const line of lines) {
      this.writeLine(line);
    }
  }

  private writeLine(line: string): void {
    this.output.write(`${line}\n`);
  }

  private rewriteTransient(lines: string[]): void {
    this.eraseTransient();

    if (lines.length > 0) {
      this.output.write(`${lines.join("\n")}\n`);
    }

    this.transientRowCount = this.measureRenderedRows(lines);
  }

  private eraseTransient(): void {
    if (this.transientRowCount === 0) {
      return;
    }

    readline.moveCursor(this.output, 0, -this.transientRowCount);
    for (let index = 0; index < this.transientRowCount; index += 1) {
      readline.clearLine(this.output, 0);
      readline.cursorTo(this.output, 0);
      if (index < this.transientRowCount - 1) {
        readline.moveCursor(this.output, 0, 1);
      }
    }

    if (this.transientRowCount > 1) {
      readline.moveCursor(this.output, 0, -(this.transientRowCount - 1));
    }
  }

  private measureRenderedRows(lines: string[]): number {
    const columns = Math.max(this.output.columns ?? 120, 1);
    return lines.reduce((count, line) => count + Math.max(1, Math.ceil(this.measureVisibleWidth(line) / columns)), 0);
  }

  private measureVisibleWidth(line: string): number {
    return measureTerminalWidth(line);
  }

  private inlineValue(value: unknown): string {
    if (typeof value === "string") {
      return value;
    }

    if (typeof value === "number" || typeof value === "bigint" || typeof value === "boolean") {
      return String(value);
    }

    if (value === null) {
      return "null";
    }

    if (Array.isArray(value)) {
      return `${value.length} 项`;
    }

    if (value && typeof value === "object") {
      return "结构";
    }

    return "未定义";
  }
}
