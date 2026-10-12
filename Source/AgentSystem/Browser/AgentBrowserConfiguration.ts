import net from "node:net";
import { z } from "zod";
import type { ConfigFormDocument } from "../Config/AgentConfigFormDocument.js";
import type { AgentExtensionLocalizedText } from "../Extensions/AgentExtensionLocalization.js";

export const AgentBrowserScreenshotFormatValues = ["png", "jpeg"] as const;
export type AgentBrowserScreenshotFormat = (typeof AgentBrowserScreenshotFormatValues)[number];

export const AgentBrowserLoadStateValues = ["domcontentloaded", "load", "networkidle"] as const;
export type AgentBrowserLoadState = (typeof AgentBrowserLoadStateValues)[number];
export const AgentBrowserMaximumUrlLength = 65_536;

export const DefaultAgentBrowserConfiguration = {
  runtime: {
    headed: false,
    requestTimeoutMs: 180_000,
    maxOperationTimeoutMs: 900_000,
    idleTimeoutMs: 900_000,
    outputMaxChars: 96_000,
    maxUrlLength: 8_192,
    maxSelectorLength: 4_096,
    maxTextChars: 120_000,
    maxWaitMs: 900_000,
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
        headed: z.boolean().default(DefaultAgentBrowserConfiguration.runtime.headed),
        executablePath: z.string().trim().min(1).max(32_768).optional(),
        requestTimeoutMs: z
          .number()
          .int()
          .min(5_000)
          .max(60 * 60 * 1_000)
          .default(DefaultAgentBrowserConfiguration.runtime.requestTimeoutMs),
        maxOperationTimeoutMs: z
          .number()
          .int()
          .min(5_000)
          .max(60 * 60 * 1_000)
          .default(DefaultAgentBrowserConfiguration.runtime.maxOperationTimeoutMs),
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
        maxWaitMs: z
          .number()
          .int()
          .min(1)
          .max(60 * 60 * 1_000)
          .default(DefaultAgentBrowserConfiguration.runtime.maxWaitMs),
      })
      .strict()
      .superRefine((runtime, context) => {
        if (runtime.maxOperationTimeoutMs < runtime.requestTimeoutMs) {
          context.addIssue({
            code: "custom",
            path: ["maxOperationTimeoutMs"],
            message: "Maximum operation timeout must not be lower than the default operation timeout.",
          });
        }
      })
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
          "zh-CN": "Senera 启动独立的受控浏览器会话；模型不能读取或修改浏览器启动参数、用户资料或认证状态。",
          "en-US":
            "Senera launches isolated controlled browser sessions. Models cannot read or change browser launch arguments, profiles, or authentication state.",
        },
        fields: [
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
              "zh-CN": "留空时自动查找 Chrome、Edge 或 Chromium；仅在自动发现失败或需要固定版本时填写。",
              "en-US":
                "Leave empty to discover Chrome, Edge, or Chromium automatically. Set only when discovery fails or a fixed browser is required.",
            },
            type: "string",
            required: false,
            essential: false,
          },
          {
            path: ["runtime", "requestTimeoutMs"],
            label: { "zh-CN": "默认操作超时（毫秒）", "en-US": "Default operation timeout (ms)" },
            description: {
              "zh-CN": "模型未提供 timeoutMs 时使用。",
              "en-US": "Used when the model does not provide timeoutMs.",
            },
            type: "number",
            min: 5_000,
            max: 3_600_000,
            step: 1_000,
            required: true,
            essential: true,
          },
          {
            path: ["runtime", "maxOperationTimeoutMs"],
            label: { "zh-CN": "模型操作超时上限（毫秒）", "en-US": "Model operation timeout limit (ms)" },
            description: {
              "zh-CN": "模型可在单次浏览器调用中使用 timeoutMs，但不能超过此值。",
              "en-US": "The model may set timeoutMs per browser call, up to this value.",
            },
            type: "number",
            min: 5_000,
            max: 3_600_000,
            step: 1_000,
            required: true,
            essential: true,
          },
          {
            path: ["runtime", "idleTimeoutMs"],
            label: { "zh-CN": "空闲会话回收（毫秒）", "en-US": "Idle session cleanup (ms)" },
            type: "number",
            min: 10_000,
            max: 86_400_000,
            step: 10_000,
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
            essential: true,
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
          {
            path: ["runtime", "maxWaitMs"],
            label: { "zh-CN": "模型等待上限（毫秒）", "en-US": "Model wait limit (ms)" },
            type: "number",
            min: 1,
            max: 3_600_000,
            step: 1_000,
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
