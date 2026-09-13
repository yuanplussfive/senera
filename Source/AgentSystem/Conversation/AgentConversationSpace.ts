import { sha256HexOfCanonicalJson } from "../Core/AgentHash.js";
import { createAgentPiLogicalCacheScope } from "../Pi/AgentPiPromptCache.js";
import {
  AgentChannelChatTypes,
  AgentChannelKinds,
  type AgentChannelChatType,
  type AgentChannelKind,
} from "../Channels/AgentChannelTypes.js";
import { z } from "zod";

export type AgentConversationSpaceSurface = "console" | "channel";
export type AgentConversationSpacePlatform = AgentChannelKind;
export type AgentConversationSpaceChatType = AgentChannelChatType;

const AgentConversationSpacePlatformSchema = z.enum(
  Object.values(AgentChannelKinds) as [AgentChannelKind, ...AgentChannelKind[]],
);
const AgentConversationSpaceChatTypeSchema = z.enum(
  Object.values(AgentChannelChatTypes) as [AgentChannelChatType, ...AgentChannelChatType[]],
);

/** Host-owned address used to route a conversation without exposing raw IDs to the model. */
export interface AgentConversationAddress {
  readonly surface: AgentConversationSpaceSurface;
  readonly platform?: AgentConversationSpacePlatform;
  readonly chatType?: AgentConversationSpaceChatType;
  readonly chatId?: string;
  readonly userId?: string;
  readonly threadId?: string;
}

export type AgentProfileRouteSelector = Partial<AgentConversationAddress>;

export interface AgentProfileRoute {
  readonly id: string;
  readonly priority?: number;
  readonly selector: AgentProfileRouteSelector;
  readonly profileId: string;
  readonly modelProviderId?: string;
}

const AgentConversationAddressSelectorSchema = z
  .object({
    surface: z.enum(["console", "channel"]),
    platform: AgentConversationSpacePlatformSchema,
    chatType: AgentConversationSpaceChatTypeSchema,
    chatId: z.string().trim().min(1).max(512),
    userId: z.string().trim().min(1).max(512),
    threadId: z.string().trim().min(1).max(512),
  })
  .partial()
  .strict();

/** Configuration contract for host-owned conversation profile routing. */
export const AgentProfileRouteSchema = z
  .object({
    id: z.string().trim().min(1).max(128),
    priority: z.number().int().min(-1_000_000).max(1_000_000).optional(),
    selector: AgentConversationAddressSelectorSchema,
    profileId: z.string().trim().min(1).max(128),
    modelProviderId: z.string().trim().min(1).max(256).optional(),
  })
  .strict();

export const AgentProfileRouteCollectionSchema = z.array(AgentProfileRouteSchema).max(512);

export interface AgentConversationSpace {
  readonly id: string;
  readonly sessionId: string;
  readonly logicalCacheScope: string;
  readonly profileId?: string;
  readonly routeId?: string;
  readonly modelProviderId?: string;
  readonly routeRevision: string;
}

export type AgentProfileRouteResolution =
  | { readonly status: "matched"; readonly route: AgentProfileRoute }
  | { readonly status: "unmatched" }
  | { readonly status: "ambiguous"; readonly candidates: readonly AgentProfileRoute[] };

export class AgentProfileRouteRegistry {
  private readonly routes: readonly AgentProfileRoute[];
  private readonly routeRevision: string;

  constructor(routes: readonly AgentProfileRoute[]) {
    this.routes = routes.map(normalizeRoute).sort((left, right) => left.id.localeCompare(right.id));
    assertUniqueRouteIds(this.routes);
    this.routeRevision = sha256HexOfCanonicalJson(this.routes);
  }

  revision(): string {
    return this.routeRevision;
  }

  list(): readonly AgentProfileRoute[] {
    return this.routes.map((route) => ({
      ...route,
      selector: { ...route.selector },
    }));
  }

  resolve(address: AgentConversationAddress): AgentProfileRouteResolution {
    const normalized = normalizeAddress(address);
    const matches = this.routes.filter((route) => matchesSelector(route.selector, normalized));
    if (matches.length === 0) return { status: "unmatched" };
    const ranked = [...matches].sort(compareRouteSpecificity);
    const winner = ranked[0]!;
    const tied = ranked.filter(
      (candidate) =>
        routePriority(candidate) === routePriority(winner) &&
        selectorSpecificity(candidate) === selectorSpecificity(winner),
    );
    return tied.length > 1 ? { status: "ambiguous", candidates: tied } : { status: "matched", route: winner };
  }
}

export function createAgentConversationSpace(input: {
  readonly sessionId: string;
  readonly address: AgentConversationAddress;
  readonly routes?: AgentProfileRouteRegistry;
  readonly cacheFamily?: string;
}): AgentConversationSpace {
  const sessionId = requireText(input.sessionId, "session ID");
  const address = normalizeAddress(input.address);
  const resolution = input.routes?.resolve(address);
  if (resolution?.status === "ambiguous") {
    throw new Error(
      `Conversation space matches multiple ProfileRoutes: ${resolution.candidates.map((route) => route.id).join(", ")}.`,
    );
  }
  const route = resolution?.status === "matched" ? resolution.route : undefined;
  const routeRevision = sha256HexOfCanonicalJson(route ?? null);
  const spaceIdentity = sha256HexOfCanonicalJson({
    namespace: "senera.conversation-space",
    sessionId,
    address,
    routeId: route?.id ?? null,
    profileId: route?.profileId ?? null,
    routeRevision,
  });
  return {
    id: spaceIdentity,
    sessionId,
    logicalCacheScope: createAgentPiLogicalCacheScope({
      identity: spaceIdentity,
      family: input.cacheFamily?.trim() || "conversation",
    }),
    ...(route?.profileId ? { profileId: route.profileId } : {}),
    ...(route?.id ? { routeId: route.id } : {}),
    ...(route?.modelProviderId ? { modelProviderId: route.modelProviderId } : {}),
    routeRevision,
  };
}

function normalizeRoute(route: AgentProfileRoute): AgentProfileRoute {
  const id = requireText(route.id, "ProfileRoute id");
  const profileId = requireText(route.profileId, "ProfileRoute profileId");
  const selector = normalizeSelector(route.selector);
  return {
    id,
    profileId,
    selector,
    priority: route.priority ?? 0,
    ...(route.modelProviderId?.trim() ? { modelProviderId: route.modelProviderId.trim() } : {}),
  };
}

function normalizeAddress(address: AgentConversationAddress | AgentProfileRouteSelector): AgentConversationAddress {
  const normalized = Object.fromEntries(
    Object.entries(address)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, requireText(String(value), key)]),
  ) as unknown as AgentConversationAddress;
  if (!normalized.surface) throw new Error("Conversation space surface is required.");
  if (normalized.surface === "channel" && !normalized.platform) {
    throw new Error("Channel conversation spaces require a platform.");
  }
  return normalized;
}

function normalizeSelector(selector: AgentProfileRouteSelector): AgentProfileRouteSelector {
  return Object.fromEntries(
    Object.entries(selector)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, requireText(String(value), key)]),
  ) as AgentProfileRouteSelector;
}

function matchesSelector(selector: AgentProfileRouteSelector, address: AgentConversationAddress): boolean {
  return Object.entries(selector).every(([key, value]) => address[key as keyof AgentConversationAddress] === value);
}

function compareRouteSpecificity(left: AgentProfileRoute, right: AgentProfileRoute): number {
  return (
    routePriority(right) - routePriority(left) ||
    selectorSpecificity(right) - selectorSpecificity(left) ||
    left.id.localeCompare(right.id)
  );
}

function selectorSpecificity(route: AgentProfileRoute): number {
  return Object.keys(route.selector).length;
}

function routePriority(route: AgentProfileRoute): number {
  return route.priority ?? 0;
}

function assertUniqueRouteIds(routes: readonly AgentProfileRoute[]): void {
  const seen = new Set<string>();
  for (const route of routes) {
    if (seen.has(route.id)) throw new Error(`ProfileRoute id is duplicated: ${route.id}`);
    seen.add(route.id);
  }
}

function requireText(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${name} must not be empty.`);
  return normalized;
}
