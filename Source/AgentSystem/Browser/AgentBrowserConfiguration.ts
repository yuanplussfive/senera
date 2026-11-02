import net from "node:net";
import { z } from "zod";
import type { ConfigFormDocument } from "../Config/AgentConfigFormDocument.js";
import type { AgentExtensionLocalizedText } from "../Extensions/AgentExtensionLocalization.js";

export const AgentBrowserScreenshotFormatValues = ["png", "jpeg"] as const;
export type AgentBrowserScreenshotFormat = (typeof AgentBrowserScreenshotFormatValues)[number];

export const AgentBrowserContextValues = ["persistent", "temporary"] as const;
export type AgentBrowserContext = (typeof AgentBrowserContextValues)[number];

export const AgentBrowserSelectionValues = ["auto", "bundled", "chrome", "edge", "brave", "chromium"] as const;
export type AgentBrowserSelection = (typeof AgentBrowserSelectionValues)[number];

export const AgentBrowserLoadStateValues = ["domcontentloaded", "load", "networkidle"] as const;
export type AgentBrowserLoadState = (typeof AgentBrowserLoadStateValues)[number];
export const AgentBrowserMaximumUrlLength = 65_536;

export const DefaultAgentBrowserConfiguration = {
  runtime: {
    context: "persistent" as const,
    browser: "auto" as const,
    headed: false,
    requestTimeoutMs: 180_000,
    idleTimeoutMs: 900_000,
    outputMaxChars: 96_000,
    maxUrlLength: 8_192,
    maxSelectorLength: 4_096,
    maxTextChars: 120_000,
  },
  network: {
    blockedDomains: [] as string[],
  },
  capture: {
    defaultFormat: "png" as const,
    maxScreenshotBytes: 24 * 1024 * 1024,
    maxDownloadBytes: 64 * 1024 * 1024,
  },
} as const;

const AgentBrowserBlockedDomainPattern = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .refine(isAgentBrowserDomainPattern, "Blocked domains must be a hostname, IP address, wildcard hostname, or *.");

const AgentBrowserNetworkConfigurationSchema = z.preprocess(
  migrateLegacyBrowserNetworkConfiguration,
  z
    .object({
      blockedDomains: z
        .array(AgentBrowserBlockedDomainPattern)
        .max(128)
        .default(DefaultAgentBrowserConfiguration.network.blockedDomains),
    })
    .strict(),
);

export const AgentBrowserConfigurationSchema = z
  .object({
    runtime: z
      .object({
        context: z.enum(AgentBrowserContextValues).default(DefaultAgentBrowserConfiguration.runtime.context),
        browser: z.enum(AgentBrowserSelectionValues).default(DefaultAgentBrowserConfiguration.runtime.browser),
        headed: z.boolean().default(DefaultAgentBrowserConfiguration.runtime.headed),
        executablePath: z.string().trim().min(1).max(32_768).optional(),
        controllerPath: z.string().trim().min(1).max(32_768).optional(),
        requestTimeoutMs: z
          .number()
          .int()
          .min(5_000)
          .max(60 * 60 * 1_000)
          .default(DefaultAgentBrowserConfiguration.runtime.requestTimeoutMs),
        idleTimeoutMs: z
          .number()
          .int()
          .min(10_000)
          .max(24 * 60 * 60 * 1_000)
          .default(DefaultAgentBrowserConfiguration.runtime.idleTimeoutMs),
        outputMaxChars: z
          .number()
          .int()
          .min(1_024)
          .max(2_000_000)
          .default(DefaultAgentBrowserConfiguration.runtime.outputMaxChars),
        maxUrlLength: z
          .number()
          .int()
          .min(256)
          .max(AgentBrowserMaximumUrlLength)
          .default(DefaultAgentBrowserConfiguration.runtime.maxUrlLength),
        maxSelectorLength: z
          .number()
          .int()
          .min(64)
          .max(32_768)
          .default(DefaultAgentBrowserConfiguration.runtime.maxSelectorLength),
        maxTextChars: z
          .number()
          .int()
          .min(1_024)
          .max(2_000_000)
          .default(DefaultAgentBrowserConfiguration.runtime.maxTextChars),
      })
      .strict()
      .default(DefaultAgentBrowserConfiguration.runtime),
    network: AgentBrowserNetworkConfigurationSchema.default(DefaultAgentBrowserConfiguration.network),
    capture: z
      .object({
        defaultFormat: z
          .enum(AgentBrowserScreenshotFormatValues)
          .default(DefaultAgentBrowserConfiguration.capture.defaultFormat),
        maxScreenshotBytes: z
          .number()
          .int()
          .min(128 * 1024)
          .max(128 * 1024 * 1024)
          .default(DefaultAgentBrowserConfiguration.capture.maxScreenshotBytes),
        maxDownloadBytes: z
          .number()
          .int()
          .min(128 * 1024)
          .max(512 * 1024 * 1024)
          .default(DefaultAgentBrowserConfiguration.capture.maxDownloadBytes),
      })
      .strict()
      .default(DefaultAgentBrowserConfiguration.capture),
  })
  .strict();

export type AgentBrowserConfiguration = z.output<typeof AgentBrowserConfigurationSchema>;

export const AgentBrowserConfigurationUi = {
  form: {
    version: 1,
    sections: [
      {
        id: "runtime",
        label: { "zh-CN": "浏览器运行时", "en-US": "Browser runtime" },
        description: {
          "zh-CN": "Senera 管理受控浏览器会话；模型不能读取或修改浏览器启动参数、用户资料或认证状态。",
          "en-US":
            "Senera manages controlled browser sessions. Models cannot read or change browser launch arguments, profiles, or authentication state.",
        },
        fields: [
          {
            path: ["runtime", "context"],
            label: { "zh-CN": "浏览器状态", "en-US": "Browser state" },
            description: {
              "zh-CN": "记住登录会使用 Senera 专属浏览器保存网站登录与站点数据；临时浏览器会在会话结束后清除这些状态。",
              "en-US":
                "Remember sign-ins uses a Senera-only browser that keeps website sign-ins and site data. A temporary browser clears that state when the session ends.",
            },
            type: "string",
            options: [...AgentBrowserContextValues],
            optionLabels: {
              persistent: { "zh-CN": "记住登录（推荐）", "en-US": "Remember sign-ins (recommended)" },
              temporary: { "zh-CN": "临时浏览器", "en-US": "Temporary browser" },
            },
            required: true,
            essential: true,
          },
          {
            path: ["runtime", "browser"],
            label: { "zh-CN": "浏览器", "en-US": "Browser" },
            description: {
              "zh-CN":
                "自动检测本机安装的 Chrome、Edge、Brave 或 Chromium，并使用 Senera 专属资料目录启动。未检测到时使用 Senera 自带浏览器；填写浏览器可执行文件路径时始终以该路径为准。",
              "en-US":
                "Detects installed Chrome, Edge, Brave, or Chromium and launches it with the Senera-only profile. Falls back to the Senera-managed browser when none is found. A configured executable path always takes precedence.",
            },
            type: "string",
            options: [...AgentBrowserSelectionValues],
            optionLabels: {
              auto: { "zh-CN": "自动检测（推荐）", "en-US": "Auto-detect (recommended)" },
              bundled: { "zh-CN": "Senera 自带浏览器", "en-US": "Senera-managed browser" },
              chrome: { "zh-CN": "Google Chrome", "en-US": "Google Chrome" },
              edge: { "zh-CN": "Microsoft Edge", "en-US": "Microsoft Edge" },
              brave: { "zh-CN": "Brave", "en-US": "Brave" },
              chromium: { "zh-CN": "Chromium", "en-US": "Chromium" },
            },
            required: true,
            essential: true,
          },
          {
            path: ["runtime", "headed"],
            label: { "zh-CN": "显示浏览器窗口", "en-US": "Show browser window" },
            type: "boolean",
            required: true,
            essential: true,
          },
          {
            path: ["runtime", "executablePath"],
            label: { "zh-CN": "浏览器可执行文件", "en-US": "Browser executable" },
            description: {
              "zh-CN": "留空时使用上面的浏览器选择；需要固定某个安装路径时填写。",
              "en-US":
                "Leave empty to use the browser selection above. Set only when a fixed executable path is required.",
            },
            type: "string",
            required: false,
            essential: false,
          },
          {
            path: ["runtime", "controllerPath"],
            label: { "zh-CN": "agent-browser 控制器", "en-US": "agent-browser controller" },
            description: {
              "zh-CN": "留空时从已安装的 agent-browser 包和打包资源中按平台自动解析。",
              "en-US":
                "Leave empty to resolve the native agent-browser controller from the installed package and packaged resources.",
            },
            type: "string",
            required: false,
            essential: false,
          },
          {
            path: ["runtime", "requestTimeoutMs"],
            label: { "zh-CN": "浏览器操作超时", "en-US": "Browser operation timeout" },
            description: {
              "zh-CN": "单次操作的总时间，包含启动浏览器、执行和读取结果。修改后在新会话中生效。",
              "en-US": "Total time for startup, execution and result reads. Changes apply to new sessions.",
            },
            type: "number",
            min: 5_000,
            max: 3_600_000,
            step: 1_000,
            durationUnit: "milliseconds",
            required: true,
            essential: false,
          },
          {
            path: ["runtime", "idleTimeoutMs"],
            label: { "zh-CN": "空闲会话回收", "en-US": "Idle session cleanup" },
            type: "number",
            min: 10_000,
            max: 86_400_000,
            step: 10_000,
            durationUnit: "milliseconds",
            required: true,
            essential: false,
          },
          {
            path: ["runtime", "outputMaxChars"],
            label: { "zh-CN": "页面输出字符上限", "en-US": "Page output character limit" },
            type: "number",
            min: 1_024,
            max: 2_000_000,
            step: 1_024,
            required: true,
            essential: false,
          },
          {
            path: ["runtime", "maxUrlLength"],
            label: { "zh-CN": "URL 长度上限", "en-US": "URL length limit" },
            type: "number",
            min: 256,
            max: AgentBrowserMaximumUrlLength,
            step: 1,
            required: true,
            essential: false,
          },
          {
            path: ["runtime", "maxSelectorLength"],
            label: { "zh-CN": "元素定位符长度上限", "en-US": "Selector length limit" },
            type: "number",
            min: 64,
            max: 32_768,
            step: 1,
            required: true,
            essential: false,
          },
          {
            path: ["runtime", "maxTextChars"],
            label: { "zh-CN": "单次文本输入上限", "en-US": "Text input character limit" },
            type: "number",
            min: 1_024,
            max: 2_000_000,
            step: 1_024,
            required: true,
            essential: false,
          },
        ],
      },
      {
        id: "network",
        label: { "zh-CN": "网络边界", "en-US": "Network boundary" },
        description: {
          "zh-CN":
            "默认可访问网络地址；这里配置的域名始终拒绝访问。本地文件和私有网络地址在完全权限模式下开放，其他模式需要审批。",
          "en-US":
            "Network addresses are allowed by default; listed domains are always blocked. Local files and private networks require approval outside Full Access mode.",
        },
        fields: [
          {
            path: ["network", "blockedDomains"],
            label: { "zh-CN": "拒绝访问的域名", "en-US": "Blocked domains" },
            description: {
              "zh-CN": "使用 example.com 拒绝该域名，使用 *.example.com 拒绝其子域名；* 拒绝所有带主机名的地址。",
              "en-US":
                "Use example.com to block one host, *.example.com to block its subdomains, or * to block all hostnames.",
            },
            type: "array",
            itemType: "string",
            required: false,
            essential: true,
          },
        ],
      },
      {
        id: "capture",
        label: { "zh-CN": "截图", "en-US": "Screenshots" },
        fields: [
          {
            path: ["capture", "defaultFormat"],
            label: { "zh-CN": "默认格式", "en-US": "Default format" },
            type: "string",
            options: [...AgentBrowserScreenshotFormatValues],
            required: true,
            essential: false,
          },
          {
            path: ["capture", "maxScreenshotBytes"],
            label: { "zh-CN": "截图字节上限", "en-US": "Screenshot byte limit" },
            type: "number",
            min: 128 * 1024,
            max: 128 * 1024 * 1024,
            step: 1_024,
            required: true,
            essential: false,
          },
          {
            path: ["capture", "maxDownloadBytes"],
            label: { "zh-CN": "下载文件大小上限", "en-US": "Download file size limit" },
            description: {
              "zh-CN": "浏览器下载会作为 Artifact 保存，超过此大小的文件会被拒绝。",
              "en-US": "Browser downloads are stored as Artifacts; files above this size are rejected.",
            },
            type: "number",
            min: 128 * 1024,
            max: 512 * 1024 * 1024,
            step: 1_048_576,
            required: true,
            essential: false,
          },
        ],
      },
    ],
  },
} satisfies ConfigFormDocument<AgentExtensionLocalizedText>;

export function isAgentBrowserDomainPattern(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (normalized === "*") return true;
  const hostname = normalized.startsWith("*.") ? normalized.slice(2) : normalized;
  if (!hostname || hostname.includes("*")) return false;
  if (net.isIP(hostname.replace(/^\[|\]$/gu, ""))) return true;
  return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/iu.test(hostname);
}

export function matchesAgentBrowserDomain(hostname: string, pattern: string): boolean {
  const normalizedHost = normalizeAgentBrowserHostname(hostname);
  const normalizedPattern = pattern.trim().toLowerCase().replace(/\.$/u, "");
  if (normalizedPattern === "*") return normalizedHost.length > 0;
  if (normalizedPattern.startsWith("*.")) {
    const suffix = normalizedPattern.slice(2);
    return normalizedHost.endsWith(`.${suffix}`) && normalizedHost !== suffix;
  }
  return normalizedHost === normalizeAgentBrowserHostname(normalizedPattern);
}

function migrateLegacyBrowserNetworkConfiguration(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const hasLegacyConfiguration =
    "accessMode" in value ||
    "allowedDomains" in value ||
    "allowPrivateNetworks" in value ||
    "allowSyntheticProxyAddresses" in value;
  if (!hasLegacyConfiguration) return value;

  const accessMode = value.accessMode;
  if (accessMode !== undefined && accessMode !== "public" && accessMode !== "allowlist") return value;
  if (value.allowedDomains !== undefined && !Array.isArray(value.allowedDomains)) return value;

  const {
    accessMode: _accessMode,
    allowedDomains,
    allowPrivateNetworks: _allowPrivateNetworks,
    allowSyntheticProxyAddresses: _allowSyntheticProxyAddresses,
    ...current
  } = value;
  const hadAllowlist =
    accessMode === "allowlist" ||
    (accessMode === undefined && Array.isArray(allowedDomains) && allowedDomains.length > 0);
  return {
    ...current,
    blockedDomains: current.blockedDomains ?? (hadAllowlist ? ["*"] : []),
  };
}

function normalizeAgentBrowserHostname(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/gu, "")
    .replace(/\.$/u, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
