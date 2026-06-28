import { AgentConsoleTheme } from "../Source/AgentSystem/CliDisplay/AgentConsoleTheme.js";
import { fitTerminalLine, measureTerminalWidth } from "../Source/AgentSystem/Text/AgentTerminalText.js";
import { readXmlRootName } from "../Source/AgentSystem/Xml/AgentXmlRootReader.js";
import type { PreviewMode } from "./CliOptions.js";

export interface DecisionXmlPreviewInput {
  step: number | undefined;
  xml: string;
  state: string;
  mode: PreviewMode;
}

export interface DecisionXmlPreview {
  line: string;
  block: string;
}

const XmlPreviewWhitespacePattern = /\s+/g;
const InlineXmlPreviewWidthRatio = 0.55;
const InlineXmlPreviewMinWidth = 24;
const TailEllipsis = "...";

export function buildDecisionXmlPreview(input: DecisionXmlPreviewInput): DecisionXmlPreview {
  const lineCount = countLines(input.xml);
  const line = fitPreviewLine([
    `step=${Number.isFinite(input.step) ? input.step : "?"}`,
    `state=${input.state}`,
    `chars=${input.xml.length}`,
    `lines=${lineCount}`,
    rootSummary(input.xml),
    lineTailSummary(input.xml),
  ].filter((item) => item.length > 0).join("  "));
  const block = [
    fitPreviewLine([
      `step=${Number.isFinite(input.step) ? input.step : "?"}`,
      `state=${input.state}`,
      `chars=${input.xml.length}`,
      `lines=${lineCount}`,
      rootSummary(input.xml),
      tailSummary(input.xml),
    ].filter((item) => item.length > 0).join("  ")),
    ...previewXmlLines(input.xml, input.mode),
  ].join("\n");

  return { line, block };
}

export function previewColor(state: string): (value: string) => string {
  return ({
    collecting: AgentConsoleTheme.xml,
    root_closed: AgentConsoleTheme.success,
    invalid: AgentConsoleTheme.warning,
  })[state] ?? AgentConsoleTheme.xml;
}

function previewXmlLines(xml: string, mode: PreviewMode): string[] {
  const lines = xml.length > 0 ? xml.replace(/\r/g, "").split("\n") : ["(waiting for XML content)"];
  const visibleWindow = mode === "block" ? 4 : 1;
  const hiddenCount = Math.max(lines.length - visibleWindow, 0);
  const windowLines = lines.slice(-visibleWindow);
  const fittedLines = windowLines.map((line) => fitPreviewLine(line));
  const fillerCount = Math.max(visibleWindow - fittedLines.length, 0);

  return [
    hiddenCount > 0 ? fitPreviewLine(`... ${hiddenCount} earlier lines hidden ...`) : fitPreviewLine(""),
    ...Array.from({ length: fillerCount }, () => fitPreviewLine("")),
    ...fittedLines,
  ];
}

function fitPreviewLine(line: string): string {
  return fitTerminalLine(line, previewWidth());
}

function previewWidth(): number {
  return Math.max((process.stdout.columns ?? 120) - 8, 36);
}

function countLines(value: string): number {
  return value.length === 0 ? 0 : value.split(/\r?\n/).length;
}

function rootSummary(xml: string): string {
  const root = readXmlRootName(xml);
  return root ? `root=${root}` : "";
}

function tailSummary(xml: string): string {
  const compact = compactXmlForInlinePreview(xml);
  return compact.length > 0 ? `tail=${fitPreviewLine(compact)}` : "";
}

function lineTailSummary(xml: string): string {
  const compact = compactXmlForInlinePreview(xml);
  if (compact.length === 0) return "preview=(waiting for XML content)";

  const tailWindow = inlineXmlPreviewWidth();
  const tail = measureTerminalWidth(compact) <= tailWindow
    ? compact
    : takeTerminalTail(compact, tailWindow);

  return `preview=${tail}`;
}

function compactXmlForInlinePreview(xml: string): string {
  return xml.replace(XmlPreviewWhitespacePattern, " ").trim();
}

function inlineXmlPreviewWidth(): number {
  return Math.max(Math.floor(previewWidth() * InlineXmlPreviewWidthRatio), InlineXmlPreviewMinWidth);
}

function takeTerminalTail(value: string, width: number): string {
  const symbols = Array.from(value);
  let consumed = 0;
  let output = "";

  for (let index = symbols.length - 1; index >= 0; index -= 1) {
    const symbol = symbols[index];
    const symbolWidth = measureTerminalWidth(symbol);
    if (consumed + symbolWidth > Math.max(width - TailEllipsis.length, 0)) break;
    output = `${symbol}${output}`;
    consumed += symbolWidth;
  }

  return `${TailEllipsis}${output}`;
}
