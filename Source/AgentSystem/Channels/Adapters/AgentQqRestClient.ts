import {
  AgentChannelHttpError,
  AgentChannelFetchTransport,
  type AgentChannelHttpTransport,
} from "../AgentChannelHttpTransport.js";
import { createFloodError } from "../AgentChannelDelivery.js";
import type { AgentChannelAttachment, AgentChannelSource } from "../AgentChannelTypes.js";
import { retryAfterOf, stripTrailingSlash, type QqTokenResponse } from "./AgentQqProtocol.js";

export type QqRestMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

const QqUserAgent = "Senera-QQ-Channel/1.0";

export interface AgentQqRestClientOptions {
  readonly appId: string;
  readonly appSecret: string;
  readonly tokenApiBase: string;
  readonly apiBase: string;
  readonly transport?: AgentChannelHttpTransport;
  readonly tokenExpirySkewMs: number;
  readonly now: () => Date;
}

/**
 * Authenticated QQ REST boundary.
 *
 * Token refresh, 401 replay and QQ flood-control conversion belong here so
 * message rendering, uploads and the Gateway can share one consistent
 * request policy without growing the channel adapter.
 */
export class AgentQqRestClient {
  private readonly appId: string;
  private readonly appSecret: string;
  private readonly tokenApiBase: string;
  private readonly apiBase: string;
  private readonly transport: AgentChannelHttpTransport;
  private readonly tokenExpirySkewMs: number;
  private readonly now: () => Date;
  private accessToken?: string;
  private tokenExpiresAt = 0;
  private currentTokenRequest?: Promise<string>;
  private tokenGeneration = 0;

  constructor(options: AgentQqRestClientOptions) {
    this.appId = options.appId.trim();
    this.appSecret = options.appSecret.trim();
    if (!this.appId || !this.appSecret) throw new Error("QQ appId and appSecret are required.");
    this.tokenApiBase = stripTrailingSlash(options.tokenApiBase);
    this.apiBase = stripTrailingSlash(options.apiBase);
    this.transport = options.transport ?? new AgentChannelFetchTransport();
    this.tokenExpirySkewMs = options.tokenExpirySkewMs;
    this.now = options.now;
  }

  async request(
    path: string,
    method: QqRestMethod,
    body: Record<string, unknown> | undefined,
    timeoutMs: number,
  ): Promise<unknown> {
    const token = await this.getToken();
    try {
      return await this.requestWithToken(path, method, body, token, timeoutMs);
    } catch (error) {
      if (error instanceof AgentChannelHttpError && (error.status === 401 || error.status === 403)) {
        this.invalidate();
        return this.requestWithToken(path, method, body, await this.getToken(), timeoutMs);
      }
      if (error instanceof AgentChannelHttpError && error.status === 429) {
        throw createFloodError("QQ rate limited.", retryAfterOf(error.body));
      }
      throw error;
    }
  }

  async getToken(): Promise<string> {
    if (this.accessToken && this.now().getTime() < this.tokenExpiresAt) return this.accessToken;
    this.currentTokenRequest ??= this.fetchToken().finally(() => {
      this.currentTokenRequest = undefined;
    });
    return this.currentTokenRequest;
  }

  async fetchGatewayUrl(): Promise<{ url: string }> {
    const response = await this.request("/gateway", "GET", undefined, 15_000);
    const url =
      typeof (response as { url?: unknown })?.url === "string" ? (response as { url: string }).url.trim() : "";
    if (!url) throw new Error("QQ gateway discovery returned no URL.");
    return { url };
  }

  async getInboundAttachmentHeaders(
    attachment: AgentChannelAttachment,
    _source: AgentChannelSource,
  ): Promise<Readonly<Record<string, string>> | undefined> {
    if (!attachment.url) return undefined;
    return { Authorization: `QQBot ${await this.getToken()}` };
  }

  invalidate(): void {
    this.accessToken = undefined;
    this.tokenExpiresAt = 0;
  }

  clear(): void {
    // A token request may still be in flight when a channel disconnects. The
    // generation check in fetchToken prevents that stale response from
    // repopulating credentials after the next connection starts.
    this.tokenGeneration += 1;
    this.invalidate();
    this.currentTokenRequest = undefined;
  }

  private async requestWithToken(
    path: string,
    method: QqRestMethod,
    body: Record<string, unknown> | undefined,
    token: string,
    timeoutMs: number,
  ): Promise<unknown> {
    const response = await this.transport.request(`${this.apiBase}${path}`, {
      method,
      headers: {
        Accept: "application/json",
        Authorization: `QQBot ${token}`,
        "Content-Type": "application/json",
        "User-Agent": QqUserAgent,
      },
      body: body ? JSON.stringify(body) : undefined,
      timeoutMs,
    });
    return response.body;
  }

  private async fetchToken(): Promise<string> {
    const generation = this.tokenGeneration;
    const response = await this.transport.request(`${this.tokenApiBase}/app/getAppAccessToken`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": QqUserAgent,
      },
      body: JSON.stringify({ appId: this.appId, clientSecret: this.appSecret }),
      timeoutMs: 15_000,
    });
    const body = response.body as QqTokenResponse;
    const token = body?.access_token;
    if (!token) throw new Error(`QQ token endpoint returned no access_token (HTTP ${response.status}).`);
    if (generation !== this.tokenGeneration) throw new Error("QQ token request was invalidated by disconnect.");
    const expiresInMs = (body.expires_in ?? 7_200) * 1_000;
    this.accessToken = token;
    this.tokenExpiresAt = this.now().getTime() + Math.max(60_000, expiresInMs - this.tokenExpirySkewMs);
    return token;
  }
}
