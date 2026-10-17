import type { IncomingMessage, ServerResponse } from "node:http";
import semver from "semver";
import {
  AgentRuntimeUpdateFailureCodes,
  AgentRuntimeUpdateRoute,
  AgentRuntimeUpdateSchemaVersion,
  AgentRuntimeUpdateStatuses,
  type AgentRuntimeUpdateDeployment,
  type AgentRuntimeUpdateFailureCode,
  type AgentRuntimeUpdateManifest,
  type AgentRuntimeUpdateStatusResponse,
} from "./AgentRuntimeUpdateContract.js";
import type { AgentRuntimeUpdateOrigin } from "./AgentRuntimeUpdateOrigin.js";

const ManifestCacheTtlMs = 5 * 60 * 1_000;
const ManifestMaxBytes = 512 * 1_024;
const MaximumRedirects = 4;

export interface AgentRuntimeUpdateHttpApiOptions {
  readonly currentVersion: string;
  readonly deployment: AgentRuntimeUpdateDeployment;
  /** A deployment-specific manifest override. */
  readonly manifestUrl?: string;
  /** The product's GitHub release origin. */
  readonly updateOrigin?: AgentRuntimeUpdateOrigin;
  readonly now?: () => Date;
  readonly fetch?: typeof fetch;
}

interface ManifestRequestContext {
  readonly cacheKey: string;
  readonly manifestUrl: string;
  readonly trustedRedirectHosts: readonly string[];
}

interface CachedManifest {
  readonly checkedAt: number;
  readonly manifest?: AgentRuntimeUpdateManifest;
}

export class AgentRuntimeUpdateHttpApi {
  private readonly currentVersion: string;
  private readonly deployment: AgentRuntimeUpdateDeployment;
  private readonly manifestUrl?: string;
  private readonly updateOrigin?: AgentRuntimeUpdateOrigin;
  private readonly now: () => Date;
  private readonly fetch: typeof fetch;
  private readonly cached = new Map<string, CachedManifest>();
  private readonly checkPromises = new Map<string, Promise<AgentRuntimeUpdateManifest>>();

  constructor(options: AgentRuntimeUpdateHttpApiOptions) {
    this.currentVersion = options.currentVersion;
    this.deployment = options.deployment;
    this.manifestUrl = normalizeManifestUrl(options.manifestUrl);
    this.updateOrigin = options.updateOrigin;
    this.now = options.now ?? (() => new Date());
    this.fetch = options.fetch ?? fetch;
  }

  canHandle(request: IncomingMessage): boolean {
    return new URL(request.url ?? "/", "http://senera.local").pathname === AgentRuntimeUpdateRoute;
  }

  async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.method !== "GET" && request.method !== "HEAD") {
      this.write(response, 405, { ok: false, error: { code: "method_not_allowed" } }, request.method);
      return;
    }

    const refresh = new URL(request.url ?? "/", "http://senera.local").searchParams.get("refresh") === "1";
    const checkedAt = this.now().toISOString();
    const context = this.resolveRequestContext();
    if (!context) {
      this.write(response, 200, this.response(AgentRuntimeUpdateStatuses.NotConfigured, checkedAt), request.method);
      return;
    }

    try {
      const manifest = await this.readManifest(context, refresh);
      const status = semver.gt(manifest.version, this.currentVersion)
        ? AgentRuntimeUpdateStatuses.Available
        : AgentRuntimeUpdateStatuses.UpToDate;
      this.write(response, 200, this.response(status, checkedAt, manifest), request.method);
    } catch (error) {
      this.write(
        response,
        200,
        this.response(AgentRuntimeUpdateStatuses.Unavailable, checkedAt, undefined, failureCode(error)),
        request.method,
      );
    }
  }

  private resolveRequestContext(): ManifestRequestContext | undefined {
    if (this.manifestUrl) {
      const url = new URL(this.manifestUrl);
      return {
        cacheKey: this.manifestUrl,
        manifestUrl: this.manifestUrl,
        trustedRedirectHosts: [url.hostname.toLowerCase()],
      };
    }
    if (!this.updateOrigin) return undefined;
    return {
      cacheKey: this.updateOrigin.manifestUrl,
      manifestUrl: this.updateOrigin.manifestUrl,
      trustedRedirectHosts: this.updateOrigin.trustedRedirectHosts,
    };
  }

  private async readManifest(
    context: ManifestRequestContext,
    forceRefresh: boolean,
  ): Promise<AgentRuntimeUpdateManifest> {
    const now = this.now().getTime();
    const cached = this.cached.get(context.cacheKey);
    if (!forceRefresh && cached && now - cached.checkedAt < ManifestCacheTtlMs) {
      if (cached.manifest) return cached.manifest;
      throw new AgentRuntimeUpdateFailure(AgentRuntimeUpdateFailureCodes.RequestFailed);
    }

    const pending = this.checkPromises.get(context.cacheKey);
    if (pending) return pending;

    const checkPromise = fetchManifest(context.manifestUrl, context.trustedRedirectHosts, this.fetch);
    this.checkPromises.set(context.cacheKey, checkPromise);
    try {
      const manifest = await checkPromise;
      this.cached.set(context.cacheKey, { checkedAt: this.now().getTime(), manifest });
      return manifest;
    } catch (error) {
      this.cached.set(context.cacheKey, { checkedAt: this.now().getTime() });
      throw error;
    } finally {
      this.checkPromises.delete(context.cacheKey);
    }
  }

  private response(
    status: AgentRuntimeUpdateStatusResponse["status"],
    checkedAt: string,
    manifest?: AgentRuntimeUpdateManifest,
    diagnosticCode?: AgentRuntimeUpdateFailureCode,
  ): AgentRuntimeUpdateStatusResponse {
    return {
      schemaVersion: AgentRuntimeUpdateSchemaVersion,
      currentVersion: this.currentVersion,
      deployment: this.deployment,
      status,
      ...(manifest
        ? {
            latest: {
              version: manifest.version,
              tag: manifest.tag,
              releaseName: manifest.releaseName,
              releaseUrl: manifest.releaseUrl,
              publishedAt: manifest.publishedAt,
            },
          }
        : {}),
      action: status === AgentRuntimeUpdateStatuses.Available ? "operator" : "none",
      ...(diagnosticCode ? { diagnostic: { code: diagnosticCode } } : {}),
      checkedAt,
    };
  }

  private write(response: ServerResponse, status: number, payload: unknown, method?: string): void {
    response.writeHead(status, {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
    });
    response.end(method === "HEAD" ? undefined : JSON.stringify(payload));
  }
}

async function fetchManifest(
  url: string,
  trustedRedirectHosts: readonly string[],
  fetcher: typeof fetch,
): Promise<AgentRuntimeUpdateManifest> {
  const response = await fetchWithTrustedRedirects(url, trustedRedirectHosts, fetcher);
  if (!response.ok) {
    throw new AgentRuntimeUpdateFailure(
      response.status === 404
        ? AgentRuntimeUpdateFailureCodes.NotPublished
        : AgentRuntimeUpdateFailureCodes.RequestFailed,
    );
  }
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > ManifestMaxBytes) {
    throw new AgentRuntimeUpdateFailure(AgentRuntimeUpdateFailureCodes.InvalidManifest);
  }
  const body = await response.text();
  if (Buffer.byteLength(body, "utf8") > ManifestMaxBytes) {
    throw new AgentRuntimeUpdateFailure(AgentRuntimeUpdateFailureCodes.InvalidManifest);
  }
  try {
    return parseManifest(JSON.parse(body) as unknown);
  } catch (error) {
    if (error instanceof AgentRuntimeUpdateFailure) throw error;
    throw new AgentRuntimeUpdateFailure(AgentRuntimeUpdateFailureCodes.InvalidManifest);
  }
}

async function fetchWithTrustedRedirects(
  initialUrl: string,
  trustedRedirectHosts: readonly string[],
  fetcher: typeof fetch,
): Promise<Response> {
  let nextUrl = new URL(initialUrl);
  const trustedHosts = new Set(trustedRedirectHosts.map((host) => host.toLowerCase()));
  for (let redirects = 0; redirects <= MaximumRedirects; redirects += 1) {
    let response: Response;
    try {
      response = await fetcher(nextUrl, {
        signal: AbortSignal.timeout(8_000),
        redirect: "manual",
      });
    } catch {
      throw new AgentRuntimeUpdateFailure(AgentRuntimeUpdateFailureCodes.RequestFailed);
    }
    if (!isRedirect(response.status)) return response;
    if (redirects === MaximumRedirects) {
      throw new AgentRuntimeUpdateFailure(AgentRuntimeUpdateFailureCodes.RedirectRejected);
    }
    const location = response.headers.get("location");
    if (!location) throw new AgentRuntimeUpdateFailure(AgentRuntimeUpdateFailureCodes.RedirectRejected);
    let target: URL;
    try {
      target = new URL(location, nextUrl);
    } catch {
      throw new AgentRuntimeUpdateFailure(AgentRuntimeUpdateFailureCodes.RedirectRejected);
    }
    if (target.protocol !== "https:" || !trustedHosts.has(target.hostname.toLowerCase())) {
      throw new AgentRuntimeUpdateFailure(AgentRuntimeUpdateFailureCodes.RedirectRejected);
    }
    nextUrl = target;
  }
  throw new AgentRuntimeUpdateFailure(AgentRuntimeUpdateFailureCodes.RedirectRejected);
}

function parseManifest(value: unknown): AgentRuntimeUpdateManifest {
  if (!isRecord(value)) throw new AgentRuntimeUpdateFailure(AgentRuntimeUpdateFailureCodes.InvalidManifest);
  const schemaVersion = value.schemaVersion;
  const product = value.product;
  const version = text(value.version);
  const tag = text(value.tag);
  const releaseName = text(value.releaseName);
  const releaseUrl = safeUrl(value.releaseUrl);
  if (
    schemaVersion !== AgentRuntimeUpdateSchemaVersion ||
    product !== "senera" ||
    !version ||
    !semver.valid(version) ||
    tag !== `v${version}` ||
    !releaseName ||
    !releaseUrl
  ) {
    throw new AgentRuntimeUpdateFailure(AgentRuntimeUpdateFailureCodes.InvalidManifest);
  }
  const desktop = parseDesktop(value.desktop);
  const container = parseContainer(value.container);
  return {
    schemaVersion: AgentRuntimeUpdateSchemaVersion,
    product: "senera",
    version,
    tag,
    releaseName,
    releaseUrl,
    ...(text(value.publishedAt) ? { publishedAt: text(value.publishedAt) } : {}),
    ...(text(value.sourceSha) ? { sourceSha: text(value.sourceSha) } : {}),
    ...(desktop ? { desktop } : {}),
    ...(container ? { container } : {}),
  };
}

function parseDesktop(value: unknown): AgentRuntimeUpdateManifest["desktop"] | undefined {
  if (!isRecord(value)) return undefined;
  const installerUrl = safeUrl(value.installerUrl);
  const metadataUrl = safeUrl(value.metadataUrl);
  const blockmapUrl = safeUrl(value.blockmapUrl);
  const installerSha256 = text(value.installerSha256);
  const installerSize = Number(value.installerSize);
  if (
    !installerUrl ||
    !metadataUrl ||
    !blockmapUrl ||
    !installerSha256 ||
    !/^[a-f\d]{64}$/iu.test(installerSha256) ||
    !Number.isSafeInteger(installerSize) ||
    installerSize < 1
  ) {
    return undefined;
  }
  return { installerUrl, installerSha256, installerSize, metadataUrl, blockmapUrl };
}

function parseContainer(value: unknown): AgentRuntimeUpdateManifest["container"] | undefined {
  if (!isRecord(value)) return undefined;
  const image = text(value.image);
  const versionTag = text(value.versionTag);
  const latestTag = text(value.latestTag);
  return image && versionTag && latestTag ? { image, versionTag, latestTag } : undefined;
}

function normalizeManifestUrl(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  const url = safeUrl(normalized);
  if (!url) throw new Error(`Update manifest URL must be an absolute HTTP(S) URL: ${normalized}`);
  return url;
}

function safeUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    const url = new URL(value);
    if (url.username || url.password || !["http:", "https:"].includes(url.protocol)) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function failureCode(error: unknown): AgentRuntimeUpdateFailureCode {
  return error instanceof AgentRuntimeUpdateFailure ? error.code : AgentRuntimeUpdateFailureCodes.RequestFailed;
}

class AgentRuntimeUpdateFailure extends Error {
  constructor(readonly code: AgentRuntimeUpdateFailureCode) {
    super(code);
    this.name = "AgentRuntimeUpdateFailure";
  }
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
