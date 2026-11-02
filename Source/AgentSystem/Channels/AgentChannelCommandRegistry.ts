import { agentErrorMessage, type AgentErrorMessageKey, type AgentLocale } from "../I18n/AgentMessageCatalog.js";
import { AgentChannelCommands, type AgentChannelCommand } from "./AgentChannelTypes.js";

export interface AgentChannelCommandDescriptor {
  readonly command: AgentChannelCommand;
  readonly aliases: readonly string[];
  readonly usage: string;
  readonly descriptionKey: AgentErrorMessageKey;
  readonly access: "read" | "control";
}

/** One command catalog drives parsing, help output, and service dispatch. */
export const AgentChannelCommandRegistry: readonly AgentChannelCommandDescriptor[] = Object.freeze([
  {
    command: AgentChannelCommands.New,
    access: "control",
    aliases: ["new", "newchat", "new-session", "reset"],
    usage: "/new",
    descriptionKey: "channels.command.new",
  },
  {
    command: AgentChannelCommands.Stop,
    access: "control",
    aliases: ["stop", "cancel"],
    usage: "/stop",
    descriptionKey: "channels.command.stop",
  },
  {
    command: AgentChannelCommands.Status,
    access: "read",
    aliases: ["status"],
    usage: "/status",
    descriptionKey: "channels.command.status",
  },
  {
    command: AgentChannelCommands.Queue,
    access: "read",
    aliases: ["queue"],
    usage: "/queue",
    descriptionKey: "channels.command.queue",
  },
  {
    command: AgentChannelCommands.Steer,
    access: "control",
    aliases: ["steer"],
    usage: "/steer 指令",
    descriptionKey: "channels.command.steer",
  },
  {
    command: AgentChannelCommands.Help,
    access: "read",
    aliases: ["help", "commands"],
    usage: "/help",
    descriptionKey: "channels.command.help",
  },
]);

const commandByAlias = new Map(
  AgentChannelCommandRegistry.flatMap((descriptor) =>
    descriptor.aliases.map((alias) => [alias, descriptor.command] as const),
  ),
);

export function resolveAgentChannelCommand(name: string): AgentChannelCommand | undefined {
  return commandByAlias.get(name.trim().toLocaleLowerCase());
}

export function renderAgentChannelCommandHelp(prefix: string, locale: AgentLocale = "zh-CN"): string[] {
  return AgentChannelCommandRegistry.map(
    (descriptor) =>
      `• ${descriptor.usage.replace(/^\//u, prefix)} ${agentErrorMessage(descriptor.descriptionKey, {}, locale)}`,
  );
}
