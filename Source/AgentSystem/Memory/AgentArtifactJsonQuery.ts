import readline from "node:readline";
import type { Readable } from "node:stream";
import { parser } from "stream-json/parser.js";
import { pick } from "stream-json/filters/pick.js";
import { streamArray } from "stream-json/streamers/stream-array.js";
import { z } from "zod";
import { defineSeneraProtocol } from "../Core/AgentProtocolIdentity.js";
import {
  AgentArtifactJsonStructureRecordSchema,
  type AgentArtifactJsonStructureField,
  type AgentArtifactJsonStructureSummary,
  type AgentArtifactJsonValueType,
} from "../Artifacts/AgentArtifactJsonStructure.js";
import { stringifyAgentCanonicalJson } from "../Core/AgentCanonicalJson.js";
import { parseJsonText } from "../Core/AgentJsonParsing.js";
import { throwIfAborted } from "../Core/AgentCancellation.js";
import { sha256HexOfCanonicalJson } from "../Core/AgentHash.js";
import { AgentTokenProjector } from "../Text/AgentTokenProjection.js";
import type {
  ArtifactJsonIndexViewRequest,
  ArtifactJsonQuery,
  ReadableArtifactRef,
} from "./AgentArtifactMemoryTypes.js";

export const ArtifactJsonIndexCursorVersion = 2;
export const ArtifactJsonQueryCursorVersion = 2;
export const ArtifactJsonIndexPageProtocol = defineSeneraProtocol("artifact_json_index", 2);
export const ArtifactJsonViewPageProtocol = defineSeneraProtocol("artifact_json_view", 2);

const ArtifactSha256Schema = z.string().length(64);

export type AgentArtifactJsonIndexIdentity =
  | { readonly kind: "published_sidecar"; readonly contentSha256: string }
  | { readonly kind: "derived_path"; readonly identitySha256: string };

export function artifactJsonIndexIdentityToken(identity: AgentArtifactJsonIndexIdentity): string {
  return identity.kind === "published_sidecar"
    ? `sidecar:${identity.contentSha256}`
    : `path:${identity.identitySha256}`;
}

const ArtifactJsonIndexCursorSchema = z
  .object({
    version: z.literal(ArtifactJsonIndexCursorVersion),
    kind: z.literal("index"),
    ref: z.string().min(1),
    sourceSha256: ArtifactSha256Schema,
    index: z.string().min(1),
    projectionHash: ArtifactSha256Schema,
    sourcePath: z.array(z.string()).optional(),
    nextByteOffset: z.number().int().nonnegative(),
    nextFieldIndex: z.number().int().nonnegative(),
    nextStructureFieldIndex: z.number().int().nonnegative(),
    totalFieldCount: z.number().int().nonnegative(),
  })
  .strict();

const ArtifactJsonQueryCursorSchema = z
  .object({
    version: z.literal(ArtifactJsonQueryCursorVersion),
    kind: z.literal("query"),
    ref: z.string().min(1),
    queryHash: ArtifactSha256Schema,
    sourceSha256: ArtifactSha256Schema,
    projectionHash: ArtifactSha256Schema,
    nextIndex: z.number().int().nonnegative(),
  })
  .strict();

type ArtifactJsonIndexCursor = z.infer<typeof ArtifactJsonIndexCursorSchema>;
type ArtifactJsonQueryCursor = z.infer<typeof ArtifactJsonQueryCursorSchema>;
type ArtifactJsonPredicate = NonNullable<ArtifactJsonQuery["where"]>[number];
type PredicateOperator = ArtifactJsonPredicate["operator"];

export interface AgentArtifactJsonQueryOptions {
  readonly source: Readable;
  readonly ref: ReadableArtifactRef;
  readonly query: ArtifactJsonQuery;
  readonly sourceSha256: string;
  readonly projectionHash: string;
  readonly tokenProjector: AgentTokenProjector;
  readonly tokenLimit: number;
  readonly projectValue?: (value: unknown) => unknown;
  readonly signal?: AbortSignal;
}

export interface AgentArtifactJsonQueryResult {
  readonly value: unknown;
  readonly content: string;
  readonly contentBytes: number;
  readonly sourcePath: string[];
  readonly selectedFields?: string[];
  readonly scanned: number;
  readonly returned: number;
  readonly complete: boolean;
  readonly nextCursor?: string;
  readonly blockedAtIndex?: number;
}

export interface AgentArtifactJsonIndexOptions {
  readonly openSource: (startByte: number) => Readable;
  readonly ref: ReadableArtifactRef;
  readonly request: ArtifactJsonIndexViewRequest;
  readonly sourceSha256: string;
  readonly indexIdentity: AgentArtifactJsonIndexIdentity;
  readonly projectionHash: string;
  readonly tokenProjector: AgentTokenProjector;
  readonly tokenLimit: number;
  readonly includeTopLevelField?: (field: string) => boolean;
  readonly signal?: AbortSignal;
}

export interface AgentArtifactJsonIndexResult {
  readonly value: ArtifactJsonIndexPage;
  readonly content: string;
  readonly contentBytes: number;
  readonly rootType: AgentArtifactJsonValueType;
  readonly rootItemCount?: number;
  readonly startFieldIndex: number;
  readonly returnedFieldCount: number;
  readonly totalFieldCount: number;
  readonly remainingFieldCount: number;
  readonly complete: boolean;
  readonly nextCursor?: string;
  readonly blockedAtFieldIndex?: number;
}

interface ArtifactJsonIndexField {
  name: string;
  type: AgentArtifactJsonValueType;
  itemCount?: number;
}

interface ArtifactJsonIndexPage {
  type: typeof ArtifactJsonIndexPageProtocol.type;
  source: {
    ref: ReadableArtifactRef;
    sha256: string;
    index: string;
    sourcePath?: string[];
  };
  root: {
    type: AgentArtifactJsonValueType | "unknown";
    itemCount?: number;
  };
  page: {
    startFieldIndex: number;
    returnedFieldCount: number;
    totalFieldCount: number;
    remainingFieldCount: number;
    complete: boolean;
    nextCursor?: string;
    blockedAtFieldIndex?: number;
  };
  fields: ArtifactJsonIndexField[];
}

interface ArtifactJsonPage {
  type: typeof ArtifactJsonViewPageProtocol.type;
  source: {
    ref: ReadableArtifactRef;
    sha256: string;
  };
  query: {
    sourcePath: string[];
    select?: string[];
  };
  page: {
    scanned: number;
    returned: number;
    complete: boolean;
    nextCursor?: string;
    blockedAtIndex?: number;
  };
  items: unknown[];
}

interface IndexedStructureField {
  readonly value: ArtifactJsonIndexField;
  readonly byteOffset: number;
  readonly structureFieldIndex: number;
}

const PredicateOperators: Record<PredicateOperator, (actual: unknown, predicate: ArtifactJsonPredicate) => boolean> = {
  eq: (actual, predicate) => comparableJson(actual) === comparableJson(readPredicateValue(predicate)),
  ne: (actual, predicate) => comparableJson(actual) !== comparableJson(readPredicateValue(predicate)),
  gt: (actual, predicate) => compareOrdered(actual, readPredicateValue(predicate), (order) => order > 0),
  gte: (actual, predicate) => compareOrdered(actual, readPredicateValue(predicate), (order) => order >= 0),
  lt: (actual, predicate) => compareOrdered(actual, readPredicateValue(predicate), (order) => order < 0),
  lte: (actual, predicate) => compareOrdered(actual, readPredicateValue(predicate), (order) => order <= 0),
  contains: (actual, predicate) => containsValue(actual, readPredicateValue(predicate)),
  exists: (actual) => actual !== undefined,
  not_exists: (actual) => actual === undefined,
};

export async function queryArtifactJsonStream(
  options: AgentArtifactJsonQueryOptions,
): Promise<AgentArtifactJsonQueryResult> {
  throwIfAborted(options.signal);
  const queryIdentity = projectQueryIdentity(options.query);
  const queryHash = sha256HexOfCanonicalJson(queryIdentity);
  const cursor = decodeQueryCursor(options.query.cursor);
  assertQueryCursor(cursor, options, queryHash);
  const startIndex = cursor?.nextIndex ?? 0;
  const page = createQueryPage(options.ref, queryIdentity, options.sourceSha256);
  page.page.nextCursor = encodeCursor(createQueryCursor(options, queryHash, startIndex));
  if (!options.tokenProjector.fitsJson(page, options.tokenLimit)) {
    throw new Error("The active model token budget cannot encode the Artifact JSON query envelope.");
  }
  const streams = createArrayPipeline(options.source, queryIdentity.sourcePath);
  const abort = (): void => {
    streams.output.destroy(options.signal?.reason);
  };
  options.signal?.addEventListener("abort", abort, { once: true });

  let stoppedForBudget = false;
  let nextIndex = startIndex;
  try {
    for await (const item of streams.output as AsyncIterable<{ key: number; value: unknown }>) {
      throwIfAborted(options.signal);
      nextIndex = item.key + 1;
      if (item.key < startIndex) continue;
      page.page.scanned += 1;
      if (!matchesPredicates(item.value, options.query.where)) continue;

      const selected = selectFields(item.value, options.query.select);
      const projected = options.projectValue ? options.projectValue(selected) : selected;
      page.items.push(projected);
      page.page.returned = page.items.length;
      page.page.nextCursor = encodeCursor(createQueryCursor(options, queryHash, nextIndex));
      if (options.tokenProjector.fitsJson(page, options.tokenLimit)) continue;

      page.items.pop();
      page.page.returned = page.items.length;
      page.page.nextCursor = encodeCursor(createQueryCursor(options, queryHash, item.key));
      page.page.blockedAtIndex = page.items.length === 0 ? item.key : undefined;
      stoppedForBudget = true;
      break;
    }
  } finally {
    options.signal?.removeEventListener("abort", abort);
    if (stoppedForBudget) streams.output.destroy();
    streams.dispose();
  }

  page.page.complete = !stoppedForBudget;
  if (page.page.complete) {
    delete page.page.nextCursor;
    delete page.page.blockedAtIndex;
  } else if (!page.page.nextCursor) {
    page.page.nextCursor = encodeCursor(createQueryCursor(options, queryHash, nextIndex));
  }

  const content = JSON.stringify(page);
  return {
    value: page,
    content,
    contentBytes: Buffer.byteLength(content, "utf8"),
    sourcePath: queryIdentity.sourcePath,
    ...(queryIdentity.select ? { selectedFields: queryIdentity.select } : {}),
    scanned: page.page.scanned,
    returned: page.page.returned,
    complete: page.page.complete,
    ...(page.page.nextCursor ? { nextCursor: page.page.nextCursor } : {}),
    ...(page.page.blockedAtIndex === undefined ? {} : { blockedAtIndex: page.page.blockedAtIndex }),
  };
}

export async function indexArtifactJsonStructure(
  options: AgentArtifactJsonIndexOptions,
): Promise<AgentArtifactJsonIndexResult> {
  throwIfAborted(options.signal);
  const cursor = decodeIndexCursor(options.request.cursor);
  assertIndexCursor(cursor, options);
  const sourcePath = indexSourcePath(options.request);
  const startFieldIndex = cursor?.nextFieldIndex ?? 0;
  const page = createIndexPage(options, startFieldIndex, sourcePath);
  const retained: IndexedStructureField[] = [];
  let nextField: IndexedStructureField | undefined;
  let summary: AgentArtifactJsonStructureSummary | undefined;
  let visibleFieldsAfterStart = 0;
  let expectedStructureFieldIndex = cursor?.nextStructureFieldIndex ?? 0;
  const source = options.openSource(cursor?.nextByteOffset ?? 0);

  try {
    for await (const entry of readStructureRecords(source, cursor?.nextByteOffset ?? 0, options.signal)) {
      if (summary) throw new Error("Artifact JSON structure contains records after its summary.");
      if (entry.record.kind === "summary") {
        summary = entry.record;
        continue;
      }
      if (entry.record.index !== expectedStructureFieldIndex) {
        throw new Error("Artifact JSON structure field sequence is invalid.");
      }
      expectedStructureFieldIndex += 1;
      if (options.includeTopLevelField?.(entry.record.name) === false) continue;
      visibleFieldsAfterStart += 1;
      if (nextField) continue;

      const candidate = indexedStructureField(entry.record, entry.byteOffset);
      page.fields.push(candidate.value);
      page.page.returnedFieldCount = page.fields.length;
      if (options.tokenProjector.fitsJson(page, options.tokenLimit)) {
        retained.push(candidate);
        continue;
      }
      page.fields.pop();
      page.page.returnedFieldCount = page.fields.length;
      nextField = candidate;
    }
  } finally {
    source.destroy();
  }

  const completeSummary = requireStructureSummary(summary, expectedStructureFieldIndex);
  const totalFieldCount = resolveVisibleFieldCount(cursor, startFieldIndex, visibleFieldsAfterStart);
  page.root = {
    type: completeSummary.rootType,
    ...(completeSummary.rootItemCount === undefined ? {} : { itemCount: completeSummary.rootItemCount }),
  };
  finalizeIndexPage(page, retained, nextField, totalFieldCount, options);

  const content = JSON.stringify(page);
  return {
    value: page,
    content,
    contentBytes: Buffer.byteLength(content, "utf8"),
    rootType: completeSummary.rootType,
    ...(completeSummary.rootItemCount === undefined ? {} : { rootItemCount: completeSummary.rootItemCount }),
    startFieldIndex,
    returnedFieldCount: page.page.returnedFieldCount,
    totalFieldCount,
    remainingFieldCount: page.page.remainingFieldCount,
    complete: page.page.complete,
    ...(page.page.nextCursor ? { nextCursor: page.page.nextCursor } : {}),
    ...(page.page.blockedAtFieldIndex === undefined ? {} : { blockedAtFieldIndex: page.page.blockedAtFieldIndex }),
  };
}

function finalizeIndexPage(
  page: ArtifactJsonIndexPage,
  retained: IndexedStructureField[],
  firstOmitted: IndexedStructureField | undefined,
  totalFieldCount: number,
  options: AgentArtifactJsonIndexOptions,
): void {
  let nextField = firstOmitted;
  while (true) {
    const returned = page.fields.length;
    const nextFieldIndex = page.page.startFieldIndex + returned;
    const remaining = totalFieldCount - nextFieldIndex;
    page.page.returnedFieldCount = returned;
    page.page.totalFieldCount = totalFieldCount;
    page.page.remainingFieldCount = remaining;
    page.page.complete = remaining === 0;
    page.page.nextCursor =
      remaining > 0 && nextField
        ? encodeCursor(createIndexCursor(options, nextField, nextFieldIndex, totalFieldCount))
        : undefined;
    page.page.blockedAtFieldIndex = remaining > 0 && returned === 0 ? nextFieldIndex : undefined;
    if (options.tokenProjector.fitsJson(page, options.tokenLimit)) return;

    const omitted = retained.pop();
    if (!omitted) {
      throw new Error("The active model token budget cannot encode the Artifact JSON index envelope.");
    }
    page.fields.pop();
    nextField = omitted;
  }
}

async function* readStructureRecords(
  source: Readable,
  startByte: number,
  signal?: AbortSignal,
): AsyncGenerator<{ record: z.infer<typeof AgentArtifactJsonStructureRecordSchema>; byteOffset: number }> {
  const lines = readline.createInterface({ input: source, crlfDelay: Infinity });
  let byteOffset = startByte;
  try {
    for await (const line of lines) {
      throwIfAborted(signal);
      const currentOffset = byteOffset;
      byteOffset += Buffer.byteLength(line, "utf8") + 1;
      const record = AgentArtifactJsonStructureRecordSchema.parse(
        parseJsonText(line, "Artifact JSON structure record") as unknown,
      );
      yield { record, byteOffset: currentOffset };
    }
  } finally {
    lines.close();
  }
}

function indexedStructureField(record: AgentArtifactJsonStructureField, byteOffset: number): IndexedStructureField {
  return {
    value: {
      name: record.name,
      type: record.valueType,
      ...(record.itemCount === undefined ? {} : { itemCount: record.itemCount }),
    },
    byteOffset,
    structureFieldIndex: record.index,
  };
}

function requireStructureSummary(
  summary: AgentArtifactJsonStructureSummary | undefined,
  expectedStructureFieldIndex: number,
): AgentArtifactJsonStructureSummary {
  if (!summary) throw new Error("Artifact JSON structure summary is missing.");
  if (summary.fieldCount !== expectedStructureFieldIndex) {
    throw new Error("Artifact JSON structure summary does not match its field records.");
  }
  return summary;
}

function resolveVisibleFieldCount(
  cursor: ArtifactJsonIndexCursor | undefined,
  startFieldIndex: number,
  visibleFieldsAfterStart: number,
): number {
  const observedTotal = startFieldIndex + visibleFieldsAfterStart;
  if (cursor && cursor.totalFieldCount !== observedTotal) {
    throw new Error("Artifact JSON index cursor does not match the visible field sequence.");
  }
  return cursor?.totalFieldCount ?? observedTotal;
}

function createIndexPage(
  options: AgentArtifactJsonIndexOptions,
  startFieldIndex: number,
  sourcePath: readonly string[],
): ArtifactJsonIndexPage {
  return {
    type: ArtifactJsonIndexPageProtocol.type,
    source: {
      ref: options.ref,
      sha256: options.sourceSha256,
      index: artifactJsonIndexIdentityToken(options.indexIdentity),
      ...(sourcePath.length > 0 ? { sourcePath: [...sourcePath] } : {}),
    },
    root: { type: "unknown" },
    page: {
      startFieldIndex,
      returnedFieldCount: 0,
      totalFieldCount: 0,
      remainingFieldCount: 0,
      complete: false,
    },
    fields: [],
  };
}

function createQueryPage(
  ref: ReadableArtifactRef,
  query: ReturnType<typeof projectQueryIdentity>,
  sourceSha256: string,
): ArtifactJsonPage {
  return {
    type: ArtifactJsonViewPageProtocol.type,
    source: { ref, sha256: sourceSha256 },
    query: {
      sourcePath: query.sourcePath,
      ...(query.select ? { select: query.select } : {}),
    },
    page: { scanned: 0, returned: 0, complete: false },
    items: [],
  };
}

function createIndexCursor(
  options: AgentArtifactJsonIndexOptions,
  nextField: IndexedStructureField,
  nextFieldIndex: number,
  totalFieldCount: number,
): ArtifactJsonIndexCursor {
  const sourcePath = indexSourcePath(options.request);
  return {
    version: ArtifactJsonIndexCursorVersion,
    kind: "index",
    ref: options.ref,
    sourceSha256: options.sourceSha256,
    index: artifactJsonIndexIdentityToken(options.indexIdentity),
    projectionHash: options.projectionHash,
    ...(sourcePath.length > 0 ? { sourcePath } : {}),
    nextByteOffset: nextField.byteOffset,
    nextFieldIndex,
    nextStructureFieldIndex: nextField.structureFieldIndex,
    totalFieldCount,
  };
}

function createQueryCursor(
  options: AgentArtifactJsonQueryOptions,
  queryHash: string,
  nextIndex: number,
): ArtifactJsonQueryCursor {
  return {
    version: ArtifactJsonQueryCursorVersion,
    kind: "query",
    ref: options.ref,
    queryHash,
    sourceSha256: options.sourceSha256,
    projectionHash: options.projectionHash,
    nextIndex,
  };
}

function decodeIndexCursor(value: string | undefined): ArtifactJsonIndexCursor | undefined {
  return decodeCursor(value, ArtifactJsonIndexCursorSchema, "index");
}

function decodeQueryCursor(value: string | undefined): ArtifactJsonQueryCursor | undefined {
  return decodeCursor(value, ArtifactJsonQueryCursorSchema, "query");
}

function decodeCursor<T>(value: string | undefined, schema: z.ZodType<T>, kind: string): T | undefined {
  if (!value) return undefined;
  try {
    return schema.parse(parseJsonText(Buffer.from(value, "base64url").toString("utf8"), "Artifact JSON cursor"));
  } catch {
    throw new Error(`Artifact JSON ${kind} cursor is invalid.`);
  }
}

function encodeCursor(cursor: ArtifactJsonIndexCursor | ArtifactJsonQueryCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function assertIndexCursor(cursor: ArtifactJsonIndexCursor | undefined, options: AgentArtifactJsonIndexOptions): void {
  if (!cursor) return;
  if (
    cursor.ref !== options.ref ||
    cursor.sourceSha256 !== options.sourceSha256 ||
    cursor.index !== artifactJsonIndexIdentityToken(options.indexIdentity) ||
    cursor.projectionHash !== options.projectionHash ||
    !pathsEqual(cursor.sourcePath ?? [], indexSourcePath(options.request))
  ) {
    throw new Error("Artifact JSON index cursor does not match the selected source and projection policy.");
  }
}

function assertQueryCursor(
  cursor: ArtifactJsonQueryCursor | undefined,
  options: AgentArtifactJsonQueryOptions,
  queryHash: string,
): void {
  if (!cursor) return;
  if (
    cursor.ref !== options.ref ||
    cursor.queryHash !== queryHash ||
    cursor.sourceSha256 !== options.sourceSha256 ||
    cursor.projectionHash !== options.projectionHash
  ) {
    throw new Error("Artifact JSON query cursor does not match the selected source, query, and projection policy.");
  }
}

function createArrayPipeline(
  source: Readable,
  sourcePath: readonly string[],
): {
  output: Readable;
  dispose(): void;
} {
  const parserStream = parser.asStream({ streamValues: false });
  const picker =
    sourcePath.length === 0
      ? undefined
      : pick.asStream({
          filter: (stack) => pathsEqual(stack, sourcePath),
          once: true,
          maxDepth: Infinity,
        });
  const output = streamArray.asStream();
  const forwardError = (error: Error): void => {
    output.destroy(error);
  };
  source.once("error", forwardError);
  parserStream.once("error", forwardError);
  picker?.once("error", forwardError);
  source.pipe(parserStream);
  (picker ? parserStream.pipe(picker) : parserStream).pipe(output);
  return {
    output,
    dispose: () => {
      source.removeListener("error", forwardError);
      parserStream.removeListener("error", forwardError);
      picker?.removeListener("error", forwardError);
      source.destroy();
      parserStream.destroy();
      picker?.destroy();
      output.destroy();
    },
  };
}

function projectQueryIdentity(query: ArtifactJsonQuery): {
  sourcePath: string[];
  select?: string[];
  where?: ArtifactJsonQuery["where"];
} {
  return {
    sourcePath: [...(query.sourcePath ?? [])],
    ...(query.select ? { select: [...query.select] } : {}),
    ...(query.where ? { where: query.where } : {}),
  };
}

function indexSourcePath(request: ArtifactJsonIndexViewRequest): string[] {
  return [...(request.sourcePath ?? [])];
}

function pathsEqual(stack: readonly (string | number | null)[], path: readonly string[]): boolean {
  return stack.length === path.length && stack.every((segment, index) => segment === path[index]);
}

function matchesPredicates(value: unknown, predicates: ArtifactJsonQuery["where"]): boolean {
  if (!predicates || predicates.length === 0) return true;
  const record = asRecord(value);
  return predicates.every((predicate) => PredicateOperators[predicate.operator](record?.[predicate.field], predicate));
}

function selectFields(value: unknown, fields: ArtifactJsonQuery["select"]): unknown {
  if (!fields) return value;
  const record = asRecord(value);
  if (!record) return value;
  return Object.fromEntries(fields.flatMap((field) => (Object.hasOwn(record, field) ? [[field, record[field]]] : [])));
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readPredicateValue(predicate: ArtifactJsonPredicate): unknown {
  return "value" in predicate ? predicate.value : undefined;
}

function comparableJson(value: unknown): string {
  try {
    return value === undefined ? "undefined" : stringifyAgentCanonicalJson(value);
  } catch {
    return String(value);
  }
}

function compareOrdered(left: unknown, right: unknown, accept: (order: number) => boolean): boolean {
  if (typeof left === "number" && typeof right === "number") return accept(left - right);
  if (typeof left === "string" && typeof right === "string") return accept(left < right ? -1 : left > right ? 1 : 0);
  return false;
}

function containsValue(container: unknown, expected: unknown): boolean {
  if (typeof container === "string" && typeof expected === "string") return container.includes(expected);
  return Array.isArray(container) && container.some((entry) => comparableJson(entry) === comparableJson(expected));
}
