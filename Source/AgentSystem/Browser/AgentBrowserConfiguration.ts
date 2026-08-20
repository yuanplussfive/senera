import { z } from "zod";
import type { ConfigFormDocument } from "../Config/AgentConfigFormDocument.js";
import type { AgentExtensionLocalizedText } from "../Extensions/AgentExtensionLocalization.js";

export const AgentBrowserScreenshotFormatValues = ["png", "jpeg"] as const;
export type AgentBrowserScreenshotFormat = (typeof AgentBrowserScreenshotFormatValues)[number];

export const AgentBrowserLoadStateValues = ["domcontentloaded", "load", "networkidle"] as const;
export type AgentBrowserLoadState = (typeof AgentBrowserLoadStateValues)[number];

export const AgentBrowserNetworkAccessModeValues = ["public", "allowlist"] as const;
export type AgentBrowserNetworkAccessMode = (typeof AgentBrowserNetworkAccessModeValues)[number];

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
    accessMode: "public" as const,
    allowedDomains: [] as string[],
    allowPrivateNetworks: false,
    allowSyntheticProxyAddresses: true,
  },
  capture: {
    defaultFormat: "png" as const,
    maxScreenshotBytes: 24 * 1024 * 1024,
  },
} as const;

const AgentBrowserDomainPattern = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .refine(isAgentBrowserDomainPattern, "Allowed domains must be a hostname or a *.hostname pattern.");

const AgentBrowserNetworkConfigurationSchema = z.preprocess(
  (value) => {
    if (
      !isRecord(value) ||
      "accessMode" in value ||
      !Array.isArray(value.allowedDomains) ||
      value.allowedDomains.length === 0
    ) {
      return value;
    }
    // Preserve restrictions configured before accessMode was introduced.
    return { ...value, accessMode: "allowlist" };
  },
  z
    .object({
      accessMode: z
        .enum(AgentBrowserNetworkAccessModeValues)
        .default(DefaultAgentBrowserConfiguration.network.accessMode),
      allowedDomains: z
        .array(AgentBrowserDomainPattern)
        .max(128)
        .default(DefaultAgentBrowserConfiguration.network.allowedDomains),
      allowPrivateNetworks: z.boolean().default(DefaultAgentBrowserConfiguration.network.allowPrivateNetworks),
      allowSyntheticProxyAddresses: z
        .boolean()
        .default(DefaultAgentBrowserConfiguration.network.allowSyntheticProxyAddresses),
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
          .max(65_536)
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
            max: 65_536,
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
          "zh-CN": "默认允许公开互联网访问。固定白名单模式可将浏览器限制在指定域名；私有网络始终需要单独开启。",
          "en-US":
            "Public internet access is allowed by default. Allowlist mode restricts the browser to configured domains; private networks always require a separate opt-in.",
        },
        fields: [
          {
            path: ["network", "accessMode"],
            label: { "zh-CN": "公开网络访问", "en-US": "Public network access" },
            type: "string",
            options: [...AgentBrowserNetworkAccessModeValues],
            optionLabels: {
              public: { "zh-CN": "允许所有公开站点", "en-US": "Allow all public sites" },
              allowlist: { "zh-CN": "仅允许固定白名单", "en-US": "Restrict to allowlist" },
            },
            required: true,
            essential: true,
          },
          {
            path: ["network", "allowedDomains"],
            label: { "zh-CN": "允许域名", "en-US": "Allowed domains" },
            description: {
              "zh-CN":
                "仅在“仅允许固定白名单”模式下生效。使用 example.com 或 *.example.com；列表为空时拒绝访问所有网站。",
              "en-US":
                "Only applies in allowlist mode. Use example.com or *.example.com; an empty list blocks all websites.",
            },
            type: "array",
            itemType: "string",
            required: false,
            essential: true,
          },
          {
            path: ["network", "allowPrivateNetworks"],
            label: { "zh-CN": "允许私有网络", "en-US": "Allow private networks" },
            description: {
              "zh-CN": "仅用于受信任的内网测试环境；默认阻止本机、局域网和保留地址。",
              "en-US":
                "Only for trusted internal test environments. Local, private, and reserved addresses are blocked by default.",
            },
            type: "boolean",
            required: true,
            essential: false,
          },
          {
            path: ["network", "allowSyntheticProxyAddresses"],
            label: { "zh-CN": "允许代理映射地址", "en-US": "Allow proxy-mapped addresses" },
            description: {
              "zh-CN":
                "允许经本机代理映射到 198.18.0.0/15 的公开域名；不允许直接访问该网段，也不放开本机或局域网地址。",
              "en-US":
                "Allows public hostnames mapped to 198.18.0.0/15 by a local proxy. Direct access to that range and local networks remain blocked.",
            },
            type: "boolean",
            required: true,
            essential: false,
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
        ],
      },
    ],
  },
} satisfies ConfigFormDocument<AgentExtensionLocalizedText>;

export function isAgentBrowserDomainPattern(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  const hostname = normalized.startsWith("*.") ? normalized.slice(2) : normalized;
  if (!hostname || hostname.includes("*")) return false;
  return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/iu.test(hostname);
}

export function matchesAgentBrowserDomain(hostname: string, pattern: string): boolean {
  const normalizedHost = hostname.trim().toLowerCase().replace(/\.$/u, "");
  const normalizedPattern = pattern.trim().toLowerCase().replace(/\.$/u, "");
  if (normalizedPattern.startsWith("*.")) {
    const suffix = normalizedPattern.slice(2);
    return normalizedHost.endsWith(`.${suffix}`) && normalizedHost !== suffix;
  }
  return normalizedHost === normalizedPattern;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
