import fs from "node:fs/promises";
import path from "node:path";
import { errorMessage } from "../Core/AgentErrors.js";
import { parseJsonText } from "../Core/AgentJsonParsing.js";
import { sha256HexOfCanonicalJson } from "../Core/AgentHash.js";

/** Public source used for model facts and provider-specific limits/pricing. */
export const AgentModelsDevCatalogDefaults = {
  sourceUrl: "https://models.dev/catalog.json",
  cacheRelativePath: ".senera/cache/models-dev-catalog.json",
  ttlMs: 60 * 60_000,
  refreshIntervalMs: 15 * 60_000,
  requestTimeoutMs: 12_000,
  maximumResponseBytes: 16 * 1024 * 1024,
} as const;

export type AgentModelsDevCatalogState = "ready" | "stale" | "unavailable";

export interface AgentModelsDevPricing {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
}

export interface AgentModelsDevLink {
  label: string;
  url: string;
  type?: string;
}

/** A deliberately compact projection of one models.dev model record. */
export interface AgentModelsDevModelMetadata {
  id: string;
  sourceModelId: string;
  providerId?: string;
  name?: string;
  description?: string;
  family?: string;
  knowledge?: string;
  releaseDate?: string;
  lastUpdated?: string;
  attachment?: boolean;
  reasoning?: boolean;
  toolCall?: boolean;
  structuredOutput?: boolean;
  temperature?: boolean;
  contextLimit?: number;
  inputLimit?: number;
  outputLimit?: number;
  inputModalities: string[];
  outputModalities: string[];
  openWeights?: boolean;
  license?: string;
  pricing?: AgentModelsDevPricing;
  links?: AgentModelsDevLink[];
}

export interface AgentModelsDevCatalogStatus {
  source: "models.dev";
  state: AgentModelsDevCatalogState;
  sourceKind: "cache" | "network";
  fetchedAt?: string;
  checkedAt?: string;
  modelCount: number;
  providerCount: number;
  error?: string;
}

export interface AgentModelsDevCatalogOptions {
  readonly workspaceRoot: string;
  readonly fetchImpl?: typeof fetch;
  readonly sourceUrl?: string;
  readonly cachePath?: string;
  readonly ttlMs?: number;
  readonly refreshIntervalMs?: number;
  readonly requestTimeoutMs?: number;
  readonly maximumResponseBytes?: number;
  readonly now?: () => number;
  readonly onUpdated?: (status: AgentModelsDevCatalogStatus) => void | Promise<void>;
  readonly onError?: (error: unknown) => void;
}

interface CatalogIndex {
  readonly entries: AgentModelsDevModelMetadata[];
  readonly byKey: ReadonlyMap<string, AgentModelsDevModelMetadata>;
  readonly providerByKey: ReadonlyMap<string, ReadonlyMap<string, AgentModelsDevModelMetadata>>;
  readonly bareByKey: ReadonlyMap<string, readonly AgentModelsDevModelMetadata[]>;
  readonly providerCount: number;
  readonly digest: string;
}

interface StoredCatalog {
  version: 1;
  sourceUrl: string;
  etag?: string;
  lastModified?: string;
  fetchedAt: string;
  checkedAt: string;
  providerCount: number;
  entries: AgentModelsDevModelMetadata[];
}

interface RuntimeCatalog {
  index: CatalogIndex;
  etag?: string;
  lastModified?: string;
  fetchedAt: string;
  checkedAt: string;
  sourceKind: "cache" | "network";
  error?: string;
}

/**
 * Server-owned models.dev catalog.
 *
 * It is intentionally separate from provider `/models` discovery: provider
 * discovery remains authoritative for what an endpoint exposes, while this
 * service only annotates matching models with public metadata. The on-disk
 * snapshot and conditional requests make this useful in desktop, container,
 * and offline deployments without putting the remote catalog in the UI.
 */
export class AgentModelsDevCatalog {
  private readonly fetchImpl: typeof fetch;
  private readonly sourceUrl: string;
  private readonly cachePath: string;
  private readonly ttlMs: number;
  private readonly refreshIntervalMs: number;
  private readonly requestTimeoutMs: number;
  private readonly maximumResponseBytes: number;
  private readonly now: () => number;
  private readonly onUpdated?: AgentModelsDevCatalogOptions["onUpdated"];
  private readonly onError?: AgentModelsDevCatalogOptions["onError"];
  private runtime?: RuntimeCatalog;
  private loaded = false;
  private refreshOperation?: Promise<AgentModelsDevCatalogStatus>;
  private timer?: NodeJS.Timeout;

  constructor(options: AgentModelsDevCatalogOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sourceUrl = options.sourceUrl ?? AgentModelsDevCatalogDefaults.sourceUrl;
    this.cachePath = path.resolve(
      options.workspaceRoot,
      options.cachePath ?? AgentModelsDevCatalogDefaults.cacheRelativePath,
    );
    this.ttlMs = options.ttlMs ?? AgentModelsDevCatalogDefaults.ttlMs;
    this.refreshIntervalMs = options.refreshIntervalMs ?? AgentModelsDevCatalogDefaults.refreshIntervalMs;
    this.requestTimeoutMs = options.requestTimeoutMs ?? AgentModelsDevCatalogDefaults.requestTimeoutMs;
    this.maximumResponseBytes = options.maximumResponseBytes ?? AgentModelsDevCatalogDefaults.maximumResponseBytes;
    this.now = options.now ?? Date.now;
    this.onUpdated = options.onUpdated;
    this.onError = options.onError;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.refresh().catch((error) => this.onError?.(error));
    }, this.refreshIntervalMs);
    this.timer.unref();
    void this.refresh().catch((error) => this.onError?.(error));
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  async snapshot(): Promise<AgentModelsDevCatalogStatus> {
    await this.ensureLoaded();
    const current = this.runtime;
    if (current && this.now() - Date.parse(current.checkedAt) < this.ttlMs) {
      return this.status(current);
    }
    return this.refresh();
  }

  async refresh(force = false): Promise<AgentModelsDevCatalogStatus> {
    if (this.refreshOperation) return this.refreshOperation;
    this.refreshOperation = this.refreshInternal(force).finally(() => {
      this.refreshOperation = undefined;
    });
    return this.refreshOperation;
  }

  resolve(providerId: string | undefined, modelId: string): AgentModelsDevModelMetadata | undefined {
    const index = this.runtime?.index;
    if (!index) return undefined;
    const normalizedModelId = normalizeKey(modelId);
    if (!normalizedModelId) return undefined;

    const normalizedProviderId = normalizeKey(providerId ?? "");
    const providerModels = normalizedProviderId ? index.providerByKey.get(normalizedProviderId) : undefined;
    const providerMatch = providerModels?.get(normalizedModelId);
    if (providerMatch) return cloneMetadata(providerMatch);

    const namespacedMatch = normalizedProviderId
      ? index.byKey.get(`${normalizedProviderId}/${normalizedModelId}`)
      : undefined;
    if (namespacedMatch) return cloneMetadata(namespacedMatch);

    const directMatch = index.byKey.get(normalizedModelId);
    if (directMatch) return cloneMetadata(directMatch);

    const bareMatches = index.bareByKey.get(stripProviderPrefix(normalizedModelId));
    if (bareMatches?.length === 1) return cloneMetadata(bareMatches[0]);
    return undefined;
  }

  private async refreshInternal(force: boolean): Promise<AgentModelsDevCatalogStatus> {
    await this.ensureLoaded();
    const current = this.runtime;
    if (!force && current && this.now() - Date.parse(current.checkedAt) < this.ttlMs) {
      return this.status(current);
    }

    const headers = new Headers({ accept: "application/json" });
    if (current?.etag) headers.set("if-none-match", current.etag);
    if (current?.lastModified) headers.set("if-modified-since", current.lastModified);

    try {
      const response = await this.fetchImpl(this.sourceUrl, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      });
      if (response.status === 304 && current) {
        const checkedAt = new Date(this.now()).toISOString();
        const updated: RuntimeCatalog = { ...current, checkedAt, sourceKind: "cache", error: undefined };
        this.runtime = updated;
        await this.persist(updated);
        return this.status(updated);
      }
      if (!response.ok) {
        throw new Error(`models.dev catalog request failed: ${response.status} ${response.statusText}`);
      }

      const payload = parseJsonText(await readResponseText(response, this.maximumResponseBytes), "models.dev catalog");
      const index = parseCatalog(payload);
      const fetchedAt = new Date(this.now()).toISOString();
      const updated: RuntimeCatalog = {
        index,
        etag: response.headers.get("etag") ?? current?.etag,
        lastModified: response.headers.get("last-modified") ?? current?.lastModified,
        fetchedAt,
        checkedAt: fetchedAt,
        sourceKind: "network",
      };
      const changed = !current || current.index.digest !== index.digest;
      this.runtime = updated;
      await this.persist(updated);
      if (changed) await this.onUpdated?.(this.status(updated));
      return this.status(updated);
    } catch (error) {
      const message = errorMessage(error);
      if (current) {
        const stale: RuntimeCatalog = { ...current, checkedAt: new Date(this.now()).toISOString(), error: message };
        this.runtime = stale;
        return this.status(stale);
      }
      const unavailable: RuntimeCatalog = {
        index: emptyCatalogIndex(),
        fetchedAt: "",
        checkedAt: new Date(this.now()).toISOString(),
        sourceKind: "cache",
        error: message,
      };
      this.runtime = unavailable;
      return this.status(unavailable);
    }
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const text = await fs.readFile(this.cachePath, "utf8");
      const stored = parseStoredCatalog(parseJsonText(text, "models.dev catalog cache"), this.sourceUrl);
      if (stored) {
        this.runtime = {
          index: createCatalogIndex(stored.entries, stored.providerCount),
          etag: stored.etag,
          lastModified: stored.lastModified,
          fetchedAt: stored.fetchedAt,
          checkedAt: stored.checkedAt,
          sourceKind: "cache",
        };
      }
    } catch (error) {
      if (isMissingFileError(error)) return;
      this.onError?.(error);
    }
  }

  private status(runtime: RuntimeCatalog): AgentModelsDevCatalogStatus {
    return {
      source: "models.dev",
      state: runtime.error ? (runtime.index.entries.length > 0 ? "stale" : "unavailable") : "ready",
      sourceKind: runtime.sourceKind,
      ...(runtime.fetchedAt ? { fetchedAt: runtime.fetchedAt } : {}),
      checkedAt: runtime.checkedAt,
      modelCount: runtime.index.entries.length,
      providerCount: runtime.index.providerCount,
      ...(runtime.error ? { error: runtime.error } : {}),
    };
  }

  private async persist(runtime: RuntimeCatalog): Promise<void> {
    if (runtime.index.entries.length === 0) return;
    const stored: StoredCatalog = {
      version: 1,
      sourceUrl: this.sourceUrl,
      ...(runtime.etag ? { etag: runtime.etag } : {}),
      ...(runtime.lastModified ? { lastModified: runtime.lastModified } : {}),
      fetchedAt: runtime.fetchedAt,
      checkedAt: runtime.checkedAt,
      providerCount: runtime.index.providerCount,
      entries: runtime.index.entries.map(cloneMetadata),
    };
    await fs.mkdir(path.dirname(this.cachePath), { recursive: true });
    const temporaryPath = `${this.cachePath}.${process.pid}.tmp`;
    try {
      await fs.writeFile(temporaryPath, `${JSON.stringify(stored)}\n`, "utf8");
      await fs.rename(temporaryPath, this.cachePath);
    } catch (error) {
      await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }
}

function parseCatalog(value: unknown): CatalogIndex {
  const record = readRecord(value);
  const entries: AgentModelsDevModelMetadata[] = [];
  const globalModels = readRecord(record?.models);
  for (const [key, model] of Object.entries(globalModels ?? {})) {
    const parsed = parseModel(model, key);
    if (parsed) entries.push(parsed);
  }

  const providerByKey = new Map<string, Map<string, AgentModelsDevModelMetadata>>();
  const providers = readRecord(record?.providers);
  for (const [providerKey, providerValue] of Object.entries(providers ?? {})) {
    const providerModels = readRecord(readRecord(providerValue)?.models);
    if (!providerModels) continue;
    const providerId = normalizeKey(providerKey);
    const map = new Map<string, AgentModelsDevModelMetadata>();
    for (const [key, model] of Object.entries(providerModels)) {
      const parsed = parseModel(model, key, providerId);
      if (!parsed) continue;
      map.set(normalizeKey(key), parsed);
      entries.push(parsed);
    }
    if (map.size > 0) providerByKey.set(providerId, map);
  }
  return createCatalogIndex(entries, providerByKey.size, providerByKey);
}

function createCatalogIndex(
  inputEntries: readonly AgentModelsDevModelMetadata[],
  providerCount: number,
  inputProviderByKey?: ReadonlyMap<string, ReadonlyMap<string, AgentModelsDevModelMetadata>>,
): CatalogIndex {
  const entries = deduplicateEntries(inputEntries);
  const byKey = new Map<string, AgentModelsDevModelMetadata>();
  const providerByKey = new Map<string, ReadonlyMap<string, AgentModelsDevModelMetadata>>();
  const bareByKey = new Map<string, AgentModelsDevModelMetadata[]>();
  for (const entry of entries) {
    const key = normalizeKey(entry.sourceModelId);
    if (key && !byKey.has(key)) byKey.set(key, entry);
    const bareKey = stripProviderPrefix(key);
    if (bareKey) {
      const bucket = bareByKey.get(bareKey) ?? [];
      bucket.push(entry);
      bareByKey.set(bareKey, bucket);
    }
  }
  for (const [providerId, models] of inputProviderByKey ?? []) {
    providerByKey.set(providerId, new Map(models));
  }
  if (!inputProviderByKey) {
    for (const entry of entries) {
      if (!entry.providerId) continue;
      const existing = new Map(providerByKey.get(entry.providerId) ?? []);
      existing.set(normalizeKey(entry.sourceModelId), entry);
      providerByKey.set(entry.providerId, existing);
    }
  }
  return {
    entries,
    byKey,
    providerByKey,
    bareByKey,
    providerCount,
    digest: sha256HexOfCanonicalJson(entries),
  };
}

function parseModel(value: unknown, sourceModelId: string, providerId?: string): AgentModelsDevModelMetadata | null {
  const record = readRecord(value);
  const sourceId = readString(record?.id) ?? sourceModelId.trim();
  if (!sourceId) return null;
  const limit = readRecord(record?.limit);
  const modalities = readRecord(record?.modalities);
  const cost = readRecord(record?.cost);
  const links = readLinks(record?.links);
  const metadata: AgentModelsDevModelMetadata = {
    id: sourceId,
    sourceModelId,
    ...(providerId ? { providerId } : {}),
    ...optionalString("name", readString(record?.name)),
    ...optionalString("description", readString(record?.description)),
    ...optionalString("family", readString(record?.family)),
    ...optionalString("knowledge", readString(record?.knowledge)),
    ...optionalString("releaseDate", readString(record?.release_date)),
    ...optionalString("lastUpdated", readString(record?.last_updated)),
    ...optionalBoolean("attachment", readBoolean(record?.attachment)),
    ...optionalBoolean("reasoning", readBoolean(record?.reasoning)),
    ...optionalBoolean("toolCall", readBoolean(record?.tool_call)),
    ...optionalBoolean("structuredOutput", readBoolean(record?.structured_output)),
    ...optionalBoolean("temperature", readBoolean(record?.temperature)),
    ...optionalNumber("contextLimit", readNumber(limit?.context)),
    ...optionalNumber("inputLimit", readNumber(limit?.input)),
    ...optionalNumber("outputLimit", readNumber(limit?.output)),
    inputModalities: readStringArray(modalities?.input),
    outputModalities: readStringArray(modalities?.output),
    ...optionalBoolean("openWeights", readBoolean(record?.open_weights)),
    ...optionalString("license", readLicense(record?.license)),
    ...optionalPricing(cost),
    ...(links.length > 0 ? { links } : {}),
  };
  return metadata;
}

function parseStoredCatalog(value: unknown, sourceUrl: string): StoredCatalog | undefined {
  const record = readRecord(value);
  if (record?.version !== 1 || record.sourceUrl !== sourceUrl) return undefined;
  const fetchedAt = readString(record.fetchedAt);
  const checkedAt = readString(record.checkedAt);
  const entries = Array.isArray(record.entries)
    ? record.entries
        .map((entry) => parseStoredMetadata(entry))
        .filter((entry): entry is AgentModelsDevModelMetadata => Boolean(entry))
    : [];
  if (!fetchedAt || !checkedAt || entries.length === 0) return undefined;
  return {
    version: 1,
    sourceUrl,
    etag: readString(record.etag),
    lastModified: readString(record.lastModified),
    fetchedAt,
    checkedAt,
    providerCount: readNumber(record.providerCount) ?? 0,
    entries,
  };
}

function parseStoredMetadata(value: unknown): AgentModelsDevModelMetadata | undefined {
  const record = readRecord(value);
  if (!record) return undefined;
  const sourceModelId = readString(record.sourceModelId);
  if (!sourceModelId) return undefined;
  const inputModalities = readStringArray(record.inputModalities);
  const outputModalities = readStringArray(record.outputModalities);
  const metadata: AgentModelsDevModelMetadata = {
    id: readString(record.id) ?? sourceModelId,
    sourceModelId,
    ...optionalString("providerId", readString(record.providerId)),
    ...optionalString("name", readString(record.name)),
    ...optionalString("description", readString(record.description)),
    ...optionalString("family", readString(record.family)),
    ...optionalString("knowledge", readString(record.knowledge)),
    ...optionalString("releaseDate", readString(record.releaseDate)),
    ...optionalString("lastUpdated", readString(record.lastUpdated)),
    ...optionalBoolean("attachment", readBoolean(record.attachment)),
    ...optionalBoolean("reasoning", readBoolean(record.reasoning)),
    ...optionalBoolean("toolCall", readBoolean(record.toolCall)),
    ...optionalBoolean("structuredOutput", readBoolean(record.structuredOutput)),
    ...optionalBoolean("temperature", readBoolean(record.temperature)),
    ...optionalNumber("contextLimit", readNumber(record.contextLimit)),
    ...optionalNumber("inputLimit", readNumber(record.inputLimit)),
    ...optionalNumber("outputLimit", readNumber(record.outputLimit)),
    inputModalities,
    outputModalities,
    ...optionalBoolean("openWeights", readBoolean(record.openWeights)),
    ...optionalString("license", readString(record.license)),
    ...optionalPricing(readRecord(record.pricing)),
    ...(readLinks(record.links).length > 0 ? { links: readLinks(record.links) } : {}),
  };
  return metadata;
}

function deduplicateEntries(entries: readonly AgentModelsDevModelMetadata[]): AgentModelsDevModelMetadata[] {
  const seen = new Set<string>();
  return entries
    .filter((entry) => {
      const key = `${normalizeKey(entry.providerId ?? "")}:${normalizeKey(entry.sourceModelId)}:${entry.pricing ? "priced" : "base"}`;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) =>
      `${left.providerId ?? ""}/${left.sourceModelId}`.localeCompare(
        `${right.providerId ?? ""}/${right.sourceModelId}`,
      ),
    );
}

function emptyCatalogIndex(): CatalogIndex {
  return createCatalogIndex([], 0);
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase();
}

function stripProviderPrefix(value: string): string {
  const slash = value.indexOf("/");
  return slash >= 0 ? value.slice(slash + 1) : value;
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function readStringArray(value: unknown): string[] {
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  return Array.isArray(value) ? value.map(readString).filter((item): item is string => Boolean(item)) : [];
}

function readLicense(value: unknown): string | undefined {
  if (typeof value === "string") return readString(value);
  const record = readRecord(value);
  return readString(record?.name) ?? readString(record?.id);
}

function readLinks(value: unknown): AgentModelsDevLink[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      const record = readRecord(entry);
      const url = readString(record?.url);
      const label = readString(record?.label);
      if (!url || !label) return undefined;
      return { label, url, ...optionalString("type", readString(record?.type)) };
    })
    .filter((entry): entry is AgentModelsDevLink => Boolean(entry));
}

function optionalString(key: string, value: string | undefined): Record<string, string> {
  return value === undefined ? {} : { [key]: value };
}

function optionalBoolean(key: string, value: boolean | undefined): Record<string, boolean> {
  return value === undefined ? {} : { [key]: value };
}

function optionalNumber(key: string, value: number | undefined): Record<string, number> {
  return value === undefined ? {} : { [key]: value };
}

function optionalPricing(value: Record<string, unknown> | undefined): Record<string, AgentModelsDevPricing> {
  if (!value) return {};
  const pricing: AgentModelsDevPricing = {
    ...optionalNumber("input", readNumber(value.input)),
    ...optionalNumber("output", readNumber(value.output)),
    ...optionalNumber("cacheRead", readNumber(value.cache_read)),
    ...optionalNumber("cacheWrite", readNumber(value.cache_write)),
  };
  return Object.keys(pricing).length > 0 ? { pricing } : {};
}

function cloneMetadata(value: AgentModelsDevModelMetadata): AgentModelsDevModelMetadata {
  return {
    ...value,
    inputModalities: [...value.inputModalities],
    outputModalities: [...value.outputModalities],
    ...(value.pricing ? { pricing: { ...value.pricing } } : {}),
    ...(value.links ? { links: value.links.map((link) => ({ ...link })) } : {}),
  };
}

async function readResponseText(response: Response, maximumBytes: number): Promise<string> {
  const length = response.headers.get("content-length");
  if (length && Number(length) > maximumBytes) {
    throw new Error(`models.dev catalog exceeds ${maximumBytes} bytes`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maximumBytes) throw new Error(`models.dev catalog exceeds ${maximumBytes} bytes`);
  return new TextDecoder().decode(bytes);
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(
    error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "ENOENT",
  );
}
