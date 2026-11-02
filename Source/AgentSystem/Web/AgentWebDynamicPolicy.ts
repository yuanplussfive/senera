import { parseHTML } from "linkedom";
import { isAgentWebHtmlContentType } from "./AgentWebContentExtractor.js";

export const AgentWebRenderStrategyValues = ["http", "auto", "browser"] as const;
export type AgentWebRenderStrategy = (typeof AgentWebRenderStrategyValues)[number];

export const AgentWebRenderDecisionValues = [
  "not_requested",
  "static_sufficient",
  "dynamic_likely",
  "not_renderable",
  "browser_budget_exhausted",
  "browser_unavailable",
  "browser_failed",
  "rendered_with_content_change",
  "rendered_without_content_change",
] as const;
export type AgentWebRenderDecision = (typeof AgentWebRenderDecisionValues)[number];

export interface AgentWebDynamicDetectionConfiguration {
  readonly minimumUsefulTextChars: number;
  readonly minimumContentDensity: number;
  readonly minimumContentBlocks: number;
  readonly maximumScriptShare: number;
  readonly dynamicScoreThreshold: number;
  readonly reasonScoreThreshold: number;
  readonly weights: {
    readonly textDeficit: number;
    readonly densityDeficit: number;
    readonly scriptPressure: number;
    readonly structureDeficit: number;
  };
}

export interface AgentWebDocumentSignals {
  readonly htmlChars: number;
  readonly visibleTextChars: number;
  readonly markdownChars: number;
  readonly markdownBlockCount: number;
  readonly scriptCount: number;
  readonly scriptChars: number;
  readonly scriptShare: number;
  readonly contentDensity: number;
  readonly textDeficit: number;
  readonly densityDeficit: number;
  readonly scriptPressure: number;
  readonly structureDeficit: number;
  readonly dynamicScore: number;
}

export interface AgentWebDynamicAssessment {
  readonly decision: "static_sufficient" | "dynamic_likely";
  readonly signals: AgentWebDocumentSignals;
  readonly reasons: readonly string[];
}

export function assessAgentWebDocument(
  source: string,
  markdown: string,
  configuration: AgentWebDynamicDetectionConfiguration,
  contentType: string,
): AgentWebDynamicAssessment {
  const html = isAgentWebHtmlContentType(contentType);
  const signals = measureAgentWebDocument(source, markdown, configuration, html);
  const reasons =
    html && signals.dynamicScore >= configuration.dynamicScoreThreshold
      ? [
          [signals.textDeficit, "静态正文不足"],
          [signals.densityDeficit, "正文相对 HTML 密度偏低"],
          [signals.scriptPressure, "脚本负载占比偏高"],
          [signals.structureDeficit, "可提取语义结构不足"],
        ]
          .filter(([score]) => Number(score) >= configuration.reasonScoreThreshold)
          .sort(([left], [right]) => Number(right) - Number(left))
          .map(([, reason]) => String(reason))
      : [];

  return {
    decision:
      html && signals.dynamicScore >= configuration.dynamicScoreThreshold ? "dynamic_likely" : "static_sufficient",
    signals,
    reasons,
  };
}

function measureAgentWebDocument(
  source: string,
  markdown: string,
  configuration: AgentWebDynamicDetectionConfiguration,
  html: boolean,
): AgentWebDocumentSignals {
  const htmlChars = Array.from(source).length;
  const parsed = html ? parseHTML(source).document : undefined;
  const scripts = parsed ? Array.from(parsed.querySelectorAll("script")) : [];
  const scriptChars = scripts.reduce((total, element) => total + Array.from(element.toString()).length, 0);
  const visibleTextChars = parsed ? visibleTextLength(parsed) : normalizedTextLength(source);
  const markdownChars = Array.from(markdown).length;
  const markdownBlockCount = markdown
    .split(/\n{2,}/u)
    .map((block) => block.trim())
    .filter(Boolean).length;
  const scriptShare = ratio(scriptChars, Math.max(1, htmlChars));
  const contentDensity = ratio(visibleTextChars, Math.max(1, htmlChars));
  const textDeficit = deficit(visibleTextChars, configuration.minimumUsefulTextChars);
  const densityDeficit = deficit(contentDensity, configuration.minimumContentDensity);
  const scriptPressure = pressure(scriptShare, configuration.maximumScriptShare);
  const structureDeficit = deficit(markdownBlockCount, configuration.minimumContentBlocks);
  const weights = configuration.weights;
  const weightTotal = weights.textDeficit + weights.densityDeficit + weights.scriptPressure + weights.structureDeficit;
  const dynamicScore =
    weightTotal > 0
      ? clamp(
          (weights.textDeficit * textDeficit +
            weights.densityDeficit * densityDeficit +
            weights.scriptPressure * scriptPressure +
            weights.structureDeficit * structureDeficit) /
            weightTotal,
        )
      : 0;

  return {
    htmlChars,
    visibleTextChars,
    markdownChars,
    markdownBlockCount,
    scriptCount: scripts.length,
    scriptChars,
    scriptShare,
    contentDensity,
    textDeficit,
    densityDeficit,
    scriptPressure,
    structureDeficit,
    dynamicScore: html ? dynamicScore : 0,
  };
}

function visibleTextLength(document: ReturnType<typeof parseHTML>["document"]): number {
  for (const selector of ["script", "style", "noscript", "template", "svg", "canvas"]) {
    for (const element of Array.from(document.querySelectorAll(selector))) element.remove();
  }
  const root = document.documentElement;
  const text = root
    ? (document.body ?? root).textContent
    : Array.from(document.childNodes, (node) => node.textContent).join("");
  return normalizedTextLength(text ?? "");
}

function normalizedTextLength(text: string): number {
  return Array.from(text.replace(/\s+/gu, " ").trim()).length;
}

function ratio(numerator: number, denominator: number): number {
  return clamp(numerator / Math.max(1, denominator));
}

function deficit(value: number, target: number): number {
  if (target <= 0) return 0;
  return clamp(1 - value / target);
}

function pressure(value: number, ceiling: number): number {
  if (ceiling <= 0) return value > 0 ? 1 : 0;
  return clamp(value / ceiling);
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}
