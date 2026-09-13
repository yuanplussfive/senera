/**
 * Human-facing metadata for the `senera` command vocabulary. The executable
 * input contract lives in `AgentSelfCommandSchema`; this registry owns usage,
 * descriptions, aliases, and governance metadata for CLI/help projections.
 * Build-time contract checks reject command or argument-field drift between
 * the two surfaces, so this is not a second validation implementation.
 */
import type { AgentPluginCommandHandler } from "../Plugins/AgentPluginContext.js";

export interface AgentSelfCommandArgSpec {
  /** Runtime field written to the structured command object. */
  readonly key: string;
  readonly name: string;
  readonly kind: "string" | "number" | "json" | "nullable-string" | "optional-string" | "optional-number";
  readonly description: string;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly choices?: readonly string[];
  readonly missingMessage?: string;
  readonly invalidMessage?: string;
  /** Declarative positional applicability, evaluated against earlier parsed
   * values. This keeps conditional command shapes in the registry rather than
   * scattering operation-specific branches through the CLI parser. */
  readonly appliesWhen?: readonly { readonly key: string; readonly value: string }[];
}

export interface AgentSelfCommandSpec {
  readonly command: string;
  readonly action?: string;
  /** Example invocation for the help text, e.g. `senera config get [PATH]`. */
  readonly usage: string;
  readonly description: string;
  readonly args: readonly AgentSelfCommandArgSpec[];
  /** Commands that can open an approval flow (config and Skill mutations). */
  readonly sensitive?: boolean;
  /** Human-facing aliases for the CLI action, e.g. `preset reset`. */
  readonly actionAliases?: readonly string[];
}

export interface AgentSelfCommandCapability {
  readonly id: string;
  readonly usage: string;
  readonly description: string;
  readonly args: readonly AgentSelfCommandArgumentCapability[];
  readonly actionAliases?: readonly string[];
  readonly sensitive: boolean;
  readonly source: "builtin" | "plugin";
  readonly ownerId?: string;
}

export type AgentSelfCommandArgumentCapability = Pick<
  AgentSelfCommandArgSpec,
  "key" | "name" | "kind" | "description" | "minimum" | "maximum" | "choices" | "appliesWhen"
>;

const CliValueArgSpecs = ["--workspace", "--state-root", "--data-root", "--upgrade"] as const;

export const AgentSelfCommandRegistry: readonly AgentSelfCommandSpec[] = [
  {
    command: "config",
    action: "get",
    usage: "senera config get [PATH]",
    description: "读取配置路径的值（省略 PATH 时返回整个配置）。",
    args: [{ key: "path", name: "PATH", kind: "optional-string", description: "点号分隔的配置路径" }],
  },
  {
    command: "config",
    action: "models",
    usage: "senera config models",
    description: "列出模型提供方及其模型。",
    args: [],
  },
  {
    command: "config",
    action: "endpoints",
    usage: "senera config endpoints",
    description: "列出模型端点配置。",
    args: [],
  },
  {
    command: "config",
    action: "history",
    usage: "senera config history",
    description: "列出配置修订历史。",
    args: [],
  },
  {
    command: "config",
    action: "env-path",
    usage: "senera config env-path",
    description: "显示配置路径与状态目录。",
    args: [],
  },
  {
    command: "config",
    action: "check",
    usage: "senera config check",
    description: "校验配置有效性并返回诊断。",
    args: [],
  },
  {
    command: "config",
    action: "rollback",
    usage: "senera config rollback REVISION",
    description: "回滚到指定修订（生成新修订，不覆盖历史）。",
    args: [
      {
        key: "revision",
        name: "REVISION",
        kind: "number",
        description: "目标修订号",
        minimum: 1,
        invalidMessage: "Invalid config revision",
        missingMessage: "senera config rollback requires a revision number.",
      },
    ],
    sensitive: true,
  },
  {
    command: "config",
    action: "update",
    usage: "senera config update PATH VALUE",
    description: "更新配置路径的值；敏感路径需要审批。",
    args: [
      {
        key: "path",
        name: "PATH",
        kind: "string",
        description: "点号分隔的配置路径",
        missingMessage: "senera config update requires a path.",
      },
      {
        key: "value",
        name: "VALUE",
        kind: "json",
        description: "JSON 值（非 JSON 视为字符串）",
        missingMessage: "senera config update requires a value.",
      },
    ],
    sensitive: true,
  },
  {
    command: "preset",
    action: "list",
    usage: "senera preset list",
    description: "列出预设。",
    args: [],
  },
  {
    command: "preset",
    action: "show",
    usage: "senera preset show NAME",
    description: "显示预设内容。",
    args: [{ key: "name", name: "NAME", kind: "string", description: "预设名" }],
  },
  {
    command: "preset",
    action: "use",
    usage: "senera preset use [NAME]",
    description: "激活预设；无 NAME 时重置为无预设。",
    args: [{ key: "name", name: "NAME", kind: "nullable-string", description: "预设名或省略以重置" }],
    actionAliases: ["reset"],
  },
  {
    command: "preset",
    action: "create",
    usage: "senera preset create NAME CONTENT_JSON",
    description: "创建或更新预设。",
    args: [
      { key: "name", name: "NAME", kind: "string", description: "预设名" },
      {
        key: "content",
        name: "CONTENT_JSON",
        kind: "json",
        description: "预设内容",
        missingMessage: "senera preset create requires a name and JSON content.",
      },
    ],
  },
  {
    command: "workspace",
    action: "info",
    usage: "senera workspace info",
    description: "显示工作区布局信息。",
    args: [],
  },
  {
    command: "sessions",
    action: "list",
    usage: "senera sessions list",
    description: "列出最近的会话。",
    args: [],
  },
  {
    command: "session",
    action: "model",
    usage: "senera session model get SESSION_ID | set MODEL SESSION_ID",
    description: "读取或设置一个会话下一轮使用的模型；设置不会改变正在运行的轮次。模型工具会自动绑定当前会话。",
    args: [
      {
        key: "operation",
        name: "GET|SET",
        kind: "string",
        description: "读取或设置",
        choices: ["get", "set"],
        missingMessage: "senera session model requires get or set.",
      },
      {
        key: "modelProviderId",
        name: "MODEL",
        kind: "string",
        description: "模型提供方 ID（set 必填）",
        appliesWhen: [{ key: "operation", value: "set" }],
        missingMessage: "senera session model set requires a model provider id.",
      },
      {
        key: "sessionId",
        name: "SESSION_ID",
        kind: "optional-string",
        description: "会话 ID；模型工具自动绑定当前会话",
      },
    ],
  },
  {
    command: "logs",
    action: "list",
    usage: "senera logs list",
    description: "列出日志文件。",
    args: [],
  },
  {
    command: "logs",
    action: "tail",
    usage: "senera logs tail NAME [LINES]",
    description: "读取日志文件尾部。",
    args: [
      {
        key: "name",
        name: "NAME",
        kind: "string",
        description: "日志文件名",
        missingMessage: "senera logs tail requires a log name.",
      },
      {
        key: "lines",
        name: "LINES",
        kind: "optional-number",
        description: "行数（默认 200）",
        minimum: 1,
        maximum: 2000,
        invalidMessage: "Invalid log line count",
      },
    ],
  },
  {
    command: "status",
    usage: "senera status",
    description: "显示服务状态与配置摘要。",
    args: [],
  },
  {
    command: "doctor",
    action: "status",
    usage: "senera doctor status",
    description: "运行本地诊断。",
    args: [],
  },
  {
    command: "approval",
    action: "resolve",
    usage: "senera approval resolve ID approve|deny",
    description: "对挂起的敏感配置操作给出审批决议。",
    args: [
      { key: "approvalId", name: "ID", kind: "string", description: "审批请求 ID" },
      {
        key: "decision",
        name: "DECISION",
        kind: "string",
        description: "approve 或 deny",
        choices: ["approve", "deny"],
      },
    ],
  },
  {
    command: "plugins",
    action: "list",
    usage: "senera plugins list",
    description: "列出已发现插件及其启用状态。",
    args: [],
  },
  {
    command: "skills",
    action: "list",
    usage: "senera skills list",
    description: "列出系统与工作区 Skill、来源、修订和校验状态。",
    args: [],
  },
  {
    command: "skills",
    action: "search",
    usage: "senera skills search QUERY [LIMIT]",
    description: "按任务描述检索受控 Skill 元数据；只返回候选，不读取完整 Skill 正文。",
    args: [
      { key: "query", name: "QUERY", kind: "string", description: "任务或能力描述" },
      {
        key: "limit",
        name: "LIMIT",
        kind: "optional-number",
        description: "最多返回的候选数量（默认 8，最大 12）",
        minimum: 1,
        maximum: 12,
      },
    ],
  },
  {
    command: "skills",
    action: "inspect",
    usage: "senera skills inspect NAME",
    description: "读取一个唯一 Skill 的说明正文、资源清单和元数据。",
    args: [{ key: "name", name: "NAME", kind: "string", description: "Skill 名称" }],
  },
  {
    command: "skills",
    action: "resources",
    usage: "senera skills resources NAME",
    description: "列出一个 Skill 包的受控资源、类型、大小和摘要。",
    args: [{ key: "name", name: "NAME", kind: "string", description: "Skill 名称" }],
  },
  {
    command: "skills",
    action: "read",
    usage: "senera skills read NAME PATH [REVISION]",
    description: "按相对路径读取一个 Skill 包资源，可用 revision 防止内容漂移。",
    args: [
      { key: "name", name: "NAME", kind: "string", description: "Skill 名称" },
      { key: "path", name: "PATH", kind: "string", description: "Skill 包内相对路径" },
      { key: "revision", name: "REVISION", kind: "optional-string", description: "可选的期望 Skill revision" },
    ],
  },
  {
    command: "skills",
    action: "diff",
    usage: "senera skills diff NAME REVISION",
    description: "比较当前 Skill 包与历史 revision 的结构化资源差异。",
    args: [
      { key: "name", name: "NAME", kind: "string", description: "Skill 名称" },
      { key: "revision", name: "REVISION", kind: "string", description: "要比较的历史 revision" },
    ],
  },
  {
    command: "skills",
    action: "check",
    usage: "senera skills check [NAME]",
    description: "验证全部 Skill，或验证指定 Skill。",
    args: [{ key: "name", name: "NAME", kind: "optional-string", description: "可选 Skill 名称" }],
  },
  {
    command: "skills",
    action: "history",
    usage: "senera skills history NAME",
    description: "列出工作区 Skill 的可恢复修订。",
    args: [{ key: "name", name: "NAME", kind: "string", description: "Skill 名称" }],
  },
  {
    command: "skills",
    action: "create",
    usage: "senera skills create NAME CONTENT",
    description: "创建工作区 Skill；CONTENT 必须是完整的 SKILL.md。",
    args: [
      { key: "name", name: "NAME", kind: "string", description: "Skill 名称" },
      {
        key: "content",
        name: "CONTENT",
        kind: "string",
        description: "完整 SKILL.md 文本",
        missingMessage: "senera skills create requires a complete SKILL.md document.",
      },
    ],
    sensitive: true,
  },
  {
    command: "skills",
    action: "update",
    usage: "senera skills update NAME CONTENT EXPECTED_REVISION",
    description: "按 revision 乐观并发更新工作区 Skill。",
    args: [
      { key: "name", name: "NAME", kind: "string", description: "Skill 名称" },
      {
        key: "content",
        name: "CONTENT",
        kind: "string",
        description: "完整 SKILL.md 文本",
        missingMessage: "senera skills update requires a complete SKILL.md document.",
      },
      {
        key: "expectedRevision",
        name: "EXPECTED_REVISION",
        kind: "string",
        description: "当前 revision（防止覆盖并发修改）",
      },
    ],
    sensitive: true,
  },
  {
    command: "skills",
    action: "archive",
    usage: "senera skills archive NAME EXPECTED_REVISION",
    description: "归档工作区 Skill，保留可恢复修订。",
    args: [
      { key: "name", name: "NAME", kind: "string", description: "Skill 名称" },
      {
        key: "expectedRevision",
        name: "EXPECTED_REVISION",
        kind: "string",
        description: "当前 revision（防止归档并发修改）",
      },
    ],
    sensitive: true,
  },
  {
    command: "skills",
    action: "restore",
    usage: "senera skills restore NAME REVISION",
    description: "从明确的历史 revision 恢复工作区 Skill。",
    args: [
      { key: "name", name: "NAME", kind: "string", description: "Skill 名称" },
      { key: "revision", name: "REVISION", kind: "string", description: "历史 revision" },
    ],
    sensitive: true,
  },
  {
    command: "capabilities",
    usage: "senera capabilities",
    description: "返回当前实际可用的自服务命令、参数和治理规则。",
    args: [],
  },
];

export { CliValueArgSpecs };

export function agentSelfCommandId(command: string, action?: string): string {
  return action ? `${command}.${action}` : command;
}

/** Returns the built-in and currently registered plugin command definitions.
 * Consumers should use this projection instead of maintaining an action list. */
export function listAgentSelfCommandSpecs(): readonly AgentSelfCommandSpec[] {
  return [...AgentSelfCommandRegistry, ...listAgentSelfPluginCommands().map((entry) => entry.spec)];
}

/** Returns only the shipped command definitions. Plugin dispatch uses this
 * boundary to distinguish a real built-in collision from the plugin command
 * currently being resolved. */
export function listAgentSelfBuiltinCommandSpecs(): readonly AgentSelfCommandSpec[] {
  return AgentSelfCommandRegistry;
}

export function projectAgentSelfCommandCapabilities(): readonly AgentSelfCommandCapability[] {
  return listAgentSelfCommandSpecs().map((spec) => {
    const plugin = findAgentSelfPluginCommand(spec.command, spec.action);
    return {
      id: agentSelfCommandId(spec.command, spec.action),
      usage: spec.usage,
      description: spec.description,
      args: spec.args.map((argument) => ({
        key: argument.key,
        name: argument.name,
        kind: argument.kind,
        description: argument.description,
        ...(argument.minimum !== undefined ? { minimum: argument.minimum } : {}),
        ...(argument.maximum !== undefined ? { maximum: argument.maximum } : {}),
        ...(argument.choices ? { choices: argument.choices } : {}),
        ...(argument.appliesWhen ? { appliesWhen: argument.appliesWhen } : {}),
      })),
      ...(spec.actionAliases ? { actionAliases: spec.actionAliases } : {}),
      sensitive: spec.sensitive === true,
      source: plugin ? "plugin" : "builtin",
      ...(plugin?.ownerId ? { ownerId: plugin.ownerId } : {}),
    };
  });
}

export function renderAgentSelfCliHelp(): string {
  const families = groupAgentSelfCommandSpecs();
  const lines: string[] = ["Usage: senera <command> [args] [options]", ""];
  for (const [family, specs] of families) {
    lines.push(family);
    for (const spec of specs) {
      const sensitive = spec.sensitive ? "  (敏感路径: 需审批)" : "";
      lines.push(`  ${spec.usage.padEnd(42)}${spec.description}${sensitive}`);
    }
    lines.push("");
  }
  lines.push(
    "Options:",
    "  --workspace PATH   工作区根目录",
    "  --json             结构化 JSON 输出",
    "  --yes / --no       非交互式审批决议",
    "",
    "敏感配置路径（访问控制、端点、凭证、监听地址）的修改需要审批：",
    "交互终端以 [Y/n] 提示，或用 --json --yes/--no 显式决议。",
    "",
    "自服务命令通过 .senera/runtime.json 发现运行中的服务，经 HTTP 调用。",
    "请先启动 Senera；离线时命令以明确错误退出，不触碰任何文件。",
  );
  return lines.join("\n");
}

export function renderAgentSelfCommandLine(spec: AgentSelfCommandSpec): string {
  return spec.usage;
}

export function findAgentSelfCommandSpec(
  command: string,
  action: string | undefined,
): AgentSelfCommandSpec | undefined {
  const staticSpec = AgentSelfCommandRegistry.find(
    (spec) => spec.command === command && (spec.action ?? undefined) === (action ?? undefined),
  );
  if (staticSpec) return staticSpec;
  const staticAlias = AgentSelfCommandRegistry.find(
    (spec) => spec.command === command && spec.actionAliases?.includes(action ?? "") === true,
  );
  if (staticAlias) return staticAlias;
  return findAgentSelfPluginCommand(command, action)?.spec;
}

export interface AgentSelfPluginCommandEntry {
  readonly spec: AgentSelfCommandSpec;
  readonly handler: AgentPluginCommandHandler;
  readonly ownerId?: string;
}

const pluginCommands = new Map<string, AgentSelfPluginCommandEntry>();

/** Registers a plugin-contributed `senera` command. The command root/action
 * becomes a CLI- and tool-dispatchable envelope; raw trailing arguments are
 * handed to the plugin handler. */
export function registerAgentSelfCommand(
  spec: AgentSelfCommandSpec,
  handler: AgentPluginCommandHandler,
  ownerId?: string,
): () => void {
  const key = agentSelfPluginCommandKey(spec.command, spec.action);
  if (pluginCommands.has(key)) {
    throw new Error(`Plugin command is already registered: ${key}`);
  }
  const entry = { spec, handler, ...(ownerId ? { ownerId } : {}) };
  pluginCommands.set(key, entry);
  return () => {
    if (pluginCommands.get(key) === entry) pluginCommands.delete(key);
  };
}

export function findAgentSelfPluginCommand(
  command: string,
  action: string | undefined,
): AgentSelfPluginCommandEntry | undefined {
  return pluginCommands.get(agentSelfPluginCommandKey(command, action));
}

export function listAgentSelfPluginCommands(): readonly AgentSelfPluginCommandEntry[] {
  return [...pluginCommands.values()];
}

function agentSelfPluginCommandKey(command: string, action: string | undefined): string {
  return `${command} ${action ?? ""}`.trim();
}

function groupAgentSelfCommandSpecs(): ReadonlyMap<string, readonly AgentSelfCommandSpec[]> {
  const groups = new Map<string, AgentSelfCommandSpec[]>();
  for (const spec of listAgentSelfCommandSpecs()) {
    const family = `senera ${spec.command}`;
    const list = groups.get(family);
    if (list) list.push(spec);
    else groups.set(family, [spec]);
  }
  return groups;
}
