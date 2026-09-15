import { compose, Transform, type Duplex, type Readable, type TransformCallback } from "node:stream";
import { parser, type Token } from "stream-json/parser.js";
import { pick } from "stream-json/filters/pick.js";
import { z } from "zod";
import { defineSeneraProtocol } from "../Core/AgentProtocolIdentity.js";

export const AgentArtifactJsonStructureProtocol = defineSeneraProtocol("artifact_json_structure", 1);

export const AgentArtifactJsonValueTypeSchema = z.enum(["array", "boolean", "null", "number", "object", "string"]);

export type AgentArtifactJsonValueType = z.infer<typeof AgentArtifactJsonValueTypeSchema>;

export const AgentArtifactJsonStructureFieldSchema = z
  .object({
    kind: z.literal("field"),
    index: z.number().int().nonnegative(),
    name: z.string(),
    valueType: AgentArtifactJsonValueTypeSchema,
    itemCount: z.number().int().nonnegative().optional(),
  })
  .strict();

export const AgentArtifactJsonStructureSummarySchema = z
  .object({
    kind: z.literal("summary"),
    format: z.literal(AgentArtifactJsonStructureProtocol.type),
    rootType: AgentArtifactJsonValueTypeSchema,
    rootItemCount: z.number().int().nonnegative().optional(),
    fieldCount: z.number().int().nonnegative(),
  })
  .strict();

export const AgentArtifactJsonStructureRecordSchema = z.discriminatedUnion("kind", [
  AgentArtifactJsonStructureFieldSchema,
  AgentArtifactJsonStructureSummarySchema,
]);

export type AgentArtifactJsonStructureField = z.infer<typeof AgentArtifactJsonStructureFieldSchema>;
export type AgentArtifactJsonStructureSummary = z.infer<typeof AgentArtifactJsonStructureSummarySchema>;
export type AgentArtifactJsonStructureRecord = z.infer<typeof AgentArtifactJsonStructureRecordSchema>;

interface JsonContainerFrame {
  readonly type: "array" | "object";
  readonly root: boolean;
  itemCount: number;
  currentKey?: string;
  field?: AgentArtifactJsonStructureField;
}

export function artifactJsonStructurePath(sourcePath: string): string {
  return `${sourcePath}.structure.ndjson`;
}

export function createArtifactJsonStructureTransform(): Duplex {
  return compose(parser.asStream({ streamValues: false }), new ArtifactJsonStructureTokenTransform());
}

export function createArtifactJsonStructureStream(
  source: Readable,
  sourcePath: readonly string[],
  startByte = 0,
): Readable {
  const structure = createArtifactJsonPathStructureTransform(sourcePath);
  const output = startByte > 0 ? compose(structure, new ArtifactByteOffsetTransform(startByte)) : structure;
  const forwardError = (error: Error): void => {
    output.destroy(error);
  };
  source.once("error", forwardError);
  output.once("close", () => {
    source.removeListener("error", forwardError);
    source.destroy();
  });
  source.pipe(structure);
  return output;
}

export function createArtifactJsonStructureTokenTransform(): Transform {
  return new ArtifactJsonStructureTokenTransform();
}

function createArtifactJsonPathStructureTransform(sourcePath: readonly string[]): Duplex {
  if (sourcePath.length === 0) return createArtifactJsonStructureTransform();
  return compose(
    parser.asStream({ streamValues: false }),
    pick.asStream({ filter: (stack) => pathsEqual(stack, sourcePath), once: true, maxDepth: Infinity }),
    createArtifactJsonStructureTokenTransform(),
  );
}

class ArtifactJsonStructureTokenTransform extends Transform {
  private readonly builder = new ArtifactJsonStructureBuilder((record) => {
    this.push(`${JSON.stringify(record)}\n`);
  });

  constructor() {
    super({ writableObjectMode: true });
  }

  override _transform(token: Token, _encoding: BufferEncoding, callback: TransformCallback): void {
    try {
      this.builder.consume(token);
      callback();
    } catch (error) {
      callback(error as Error);
    }
  }

  override _flush(callback: TransformCallback): void {
    try {
      this.builder.finish();
      callback();
    } catch (error) {
      callback(error as Error);
    }
  }
}

class ArtifactByteOffsetTransform extends Transform {
  private remaining: number;

  constructor(startByte: number) {
    super();
    this.remaining = startByte;
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    const retained = chunk.subarray(Math.min(this.remaining, chunk.byteLength));
    this.remaining = Math.max(0, this.remaining - chunk.byteLength);
    callback(undefined, retained);
  }
}

class ArtifactJsonStructureBuilder {
  private readonly frames: JsonContainerFrame[] = [];
  private rootType?: AgentArtifactJsonValueType;
  private rootItemCount?: number;
  private fieldCount = 0;

  constructor(private readonly emit: (record: AgentArtifactJsonStructureRecord) => void) {}

  consume(token: Token): void {
    switch (token.name) {
      case "keyValue":
        this.recordKey(token.value);
        return;
      case "startArray":
        this.beginContainer("array");
        return;
      case "startObject":
        this.beginContainer("object");
        return;
      case "endArray":
        this.endContainer("array");
        return;
      case "endObject":
        this.endContainer("object");
        return;
      case "stringValue":
        this.recordValue("string");
        return;
      case "numberValue":
        this.recordValue("number");
        return;
      case "trueValue":
      case "falseValue":
        this.recordValue("boolean");
        return;
      case "nullValue":
        this.recordValue("null");
        return;
      default:
        return;
    }
  }

  finish(): void {
    if (this.frames.length > 0 || !this.rootType) {
      throw new Error("Artifact JSON stream ended before a complete root value was parsed.");
    }
    this.emit({
      kind: "summary",
      format: AgentArtifactJsonStructureProtocol.type,
      rootType: this.rootType,
      ...(this.rootItemCount === undefined ? {} : { rootItemCount: this.rootItemCount }),
      fieldCount: this.fieldCount,
    });
  }

  private recordKey(key: string): void {
    const frame = this.frames.at(-1);
    if (!frame || frame.type !== "object") {
      throw new Error("Artifact JSON parser emitted an object key outside an object.");
    }
    frame.currentKey = key;
  }

  private beginContainer(type: JsonContainerFrame["type"]): void {
    const field = this.recordValue(type, type === "array");
    this.frames.push({
      type,
      root: this.frames.length === 0,
      itemCount: 0,
      ...(field ? { field } : {}),
    });
  }

  private endContainer(type: JsonContainerFrame["type"]): void {
    const frame = this.frames.pop();
    if (!frame || frame.type !== type) {
      throw new Error(`Artifact JSON parser closed ${type} out of sequence.`);
    }
    if (type !== "array") return;
    if (frame.root) this.rootItemCount = frame.itemCount;
    if (frame.field) this.emit({ ...frame.field, itemCount: frame.itemCount });
  }

  private recordValue(
    valueType: AgentArtifactJsonValueType,
    deferArrayField = false,
  ): AgentArtifactJsonStructureField | undefined {
    const parent = this.frames.at(-1);
    if (!parent) {
      if (this.rootType) throw new Error("Artifact JSON stream contains more than one root value.");
      this.rootType = valueType;
      return undefined;
    }
    if (parent.type === "array") {
      parent.itemCount += 1;
      return undefined;
    }

    const name = parent.currentKey;
    parent.currentKey = undefined;
    if (name === undefined) throw new Error("Artifact JSON parser emitted an object value without a key.");
    if (!parent.root) return undefined;

    const field: AgentArtifactJsonStructureField = {
      kind: "field",
      index: this.fieldCount,
      name,
      valueType,
    };
    this.fieldCount += 1;
    if (deferArrayField) return field;
    this.emit(field);
    return undefined;
  }
}

function pathsEqual(stack: readonly (string | number | null)[], path: readonly string[]): boolean {
  return stack.length === path.length && stack.every((segment, index) => segment === path[index]);
}
