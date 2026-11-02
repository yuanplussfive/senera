import { z } from "zod";
import type { AgentChannelCapabilities } from "../AgentChannelTypes.js";

export const AgentOneBot11Capabilities: AgentChannelCapabilities = Object.freeze({
  splitsLongMessages: true,
  maxMessageLength: 4_000,
  supportsEdit: false,
  supportsDraft: false,
  markdown: "plain",
  commandPrefix: "/",
  automaticDelivery: false,
  supportsMedia: true,
  supportsMentions: true,
  supportsQuotedReplies: true,
  inboundEvents: ["message", "mention", "reply", "poke", "recall", "membership"] as const,
});

export const AgentOneBot11ConnectionDefaults = Object.freeze({
  requestTimeoutMs: 30_000,
  reconnectDelayMs: 1_000,
  maxReconnectDelayMs: 30_000,
});

function endpoint(protocols: readonly string[]) {
  return z
    .string()
    .url()
    .refine((value) => {
      const url = new URL(value);
      return protocols.includes(url.protocol) && !url.username && !url.password && !url.hash;
    }, "Use a supported endpoint without embedded credentials or fragments.");
}

export const AgentOneBot11ConnectionSchema = z
  .object({
    enabled: z.boolean().default(true),
    wsUrl: endpoint(["ws:", "wss:"]),
    wsToken: z.string().optional(),
    httpUrl: endpoint(["http:", "https:"]).optional(),
    httpToken: z.string().optional(),
    actionTransport: z.enum(["websocket", "http"]).default("websocket"),
    expectedSelfId: z.string().regex(/^\d+$/u).optional(),
    ownerQq: z.string().regex(/^\d+$/u).optional(),
    allowAllUsers: z.boolean().default(false),
    allowedUsers: z.array(z.string().regex(/^\d+$/u)).default([]),
    groupAllowedUsers: z.array(z.string().regex(/^\d+$/u)).default([]),
    commandUsers: z.array(z.string().regex(/^\d+$/u)).default([]),
    requestTimeoutMs: z
      .number()
      .int()
      .positive()
      .max(2_147_483_647)
      .default(AgentOneBot11ConnectionDefaults.requestTimeoutMs),
    reconnectDelayMs: z
      .number()
      .int()
      .positive()
      .max(2_147_483_647)
      .default(AgentOneBot11ConnectionDefaults.reconnectDelayMs),
    maxReconnectDelayMs: z
      .number()
      .int()
      .positive()
      .max(2_147_483_647)
      .default(AgentOneBot11ConnectionDefaults.maxReconnectDelayMs),
    /** File segments and poke are extensions, not mandatory OB11 actions. */
    fileMessages: z.boolean().default(false),
    poke: z.boolean().default(false),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.actionTransport === "http" && !value.httpUrl)
      context.addIssue({ code: "custom", path: ["httpUrl"], message: "HTTP actions require httpUrl." });
    if (value.maxReconnectDelayMs < value.reconnectDelayMs)
      context.addIssue({
        code: "custom",
        path: ["maxReconnectDelayMs"],
        message: "Maximum reconnect delay must cover the initial delay.",
      });
  });

export type AgentOneBot11ConnectionConfig = z.infer<typeof AgentOneBot11ConnectionSchema>;

export function agentOneBot11Authority(selfId: string): string {
  return `onebot11:${selfId}`;
}

/** Never round native IDs at the protocol boundary. */
export function oneBot11Id(value: unknown): string {
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  if (typeof value === "string" && /^-?\d+$/u.test(value)) return value;
  throw new Error("OneBot identifiers must be exact integer strings or safe integers.");
}

/** Standard OB11 actions use numeric IDs; extensions may carry larger exact strings. */
export function oneBot11WireId(value: string): string | number {
  const id = oneBot11Id(value);
  const numeric = Number(id);
  return Number.isSafeInteger(numeric) ? numeric : id;
}
