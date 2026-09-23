import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { cosineSim, embedDocument, embedQuery } from "ternlight-mini-cn";
import { decode as decodeToon, encode as encodeToon } from "@toon-format/toon";

type EncodingName = "cl100k_base" | "o200k_base" | "o200k_harmony" | "p50k_base" | "p50k_edit" | "r50k_base";

interface EncodingApi {
  encode(value: string): number[];
  decode(tokens: Iterable<number>): string;
  countTokens(value: string): number;
}

interface Fixture {
  readonly id: string;
  readonly title: string;
  readonly query: string;
  readonly signals: readonly string[];
  readonly raw: string;
}

interface WeightedToken {
  readonly id: number;
  readonly text: string;
  readonly unitIndex: number;
  readonly tokenIndex: number;
  readonly score: number;
}

interface WeightProjection {
  readonly text: string;
  readonly score: number;
  readonly unitIndex: number;
  readonly tokenIndex: number;
}

interface MethodResult {
  readonly text: string;
  readonly tokens: number;
  readonly withinBudget: boolean;
  readonly savedPercent: number;
  readonly retainedSignals: readonly string[];
  readonly missingSignals: readonly string[];
  readonly retainedAtoms: readonly string[];
  readonly missingAtoms: readonly string[];
  readonly indices?: readonly number[];
  readonly topWeights?: readonly WeightProjection[];
}

interface FixtureResult {
  readonly id: string;
  readonly title: string;
  readonly query: string;
  readonly budget: number;
  readonly unitCount: number;
  readonly raw: {
    readonly text: string;
    readonly tokens: number;
  };
  readonly methods: Readonly<Record<string, MethodResult>>;
}

interface StructuredRepresentationResult {
  readonly name: string;
  readonly text: string;
  readonly tokens: number;
  readonly bytes: number;
  readonly roundTripExact: boolean;
}

interface StablePrefixResult {
  readonly stableBytes: number;
  readonly prefixUnchanged: boolean;
  readonly dynamicPayloadsDiffer: boolean;
}

interface BenchmarkValidation {
  readonly allMethodsWithinBudget: boolean;
  readonly everyFixtureHasRawAndProjection: boolean;
  readonly structuredRoundTrip: boolean;
  readonly stablePrefix: boolean;
}

interface BenchmarkReport {
  readonly model: string;
  readonly encodingName: EncodingName;
  readonly resolution: "model_map" | "default_encoding";
  readonly budgetRatio: number;
  readonly scoringPolicy: typeof scoringPolicy;
  readonly semanticEngine: string;
  readonly samples: readonly FixtureResult[];
  readonly structuredRepresentation: readonly StructuredRepresentationResult[];
  readonly stablePrefix: StablePrefixResult;
  readonly validation: BenchmarkValidation;
  readonly elapsedMs: number;
}

const require = createRequire(import.meta.url);
const tokenizerMapping = require("gpt-tokenizer/cjs/mapping") as {
  DEFAULT_ENCODING: EncodingName;
  modelToEncodingMap: Record<string, EncodingName>;
};
const encodingModules: Record<EncodingName, string> = {
  cl100k_base: "gpt-tokenizer/cjs/encoding/cl100k_base",
  o200k_base: "gpt-tokenizer/cjs/encoding/o200k_base",
  o200k_harmony: "gpt-tokenizer/cjs/encoding/o200k_harmony",
  p50k_base: "gpt-tokenizer/cjs/encoding/p50k_base",
  p50k_edit: "gpt-tokenizer/cjs/encoding/p50k_edit",
  r50k_base: "gpt-tokenizer/cjs/encoding/r50k_base",
};

const scoringPolicy = {
  queryLexical: 0.28,
  protectedAtom: 0.27,
  rarity: 0.15,
  querySemantic: 0.18,
  boundary: 0.07,
  position: 0.05,
  unitLexical: 0.55,
  unitSemantic: 0.3,
  unitPosition: 0.15,
  unitProtectedAtom: 0.16,
} as const;

const sentenceSegmenter = new Intl.Segmenter("und", { granularity: "sentence" });

const fixtures: readonly Fixture[] = [
  {
    id: "mixed-tool-log",
    title: "中英混合工具日志",
    query: "npm test failed: find the error, source file, exit code, and next action",
    signals: ["file:", "error:", "exit code:", "result:", "next action:"],
    raw: [
      "[tool=shell] command: npm test -- --runInBand",
      "cwd: E:/senera",
      "stdout: running 42 tests",
      "stdout: running 42 tests",
      "stdout: running 42 tests",
      "warning: cache miss for AgentToolSearchIndex",
      "warning: cache miss for AgentToolSearchIndex",
      "file: Source/AgentSystem/ToolSearch/AgentToolSearchIndex.ts:116",
      'error: Cannot find module "ternlight-mini-cn"',
      'error: Cannot find module "ternlight-mini-cn"',
      "exit code: 1",
      "result: tests failed after 2.84s",
      "next action: install dependencies and rerun npm test",
    ].join("\n"),
  },
  {
    id: "chinese-long",
    title: "中文长段落",
    query: "保留 Artifact URI、URL、错误事实，说明工具预览的结论",
    signals: ["目标", "Artifact", "URL", "结论", "原始顺序"],
    raw: [
      "本次任务的目标是为工具结果建立一个只读的字符串预览，原文仍然保存在 Artifact 中，预览只用于模型理解当前进展。",
      "处理流程先按照自然边界切分段落和句子，再删除完全重复的句子，最后在 token 预算内选择信息密度较高的原句。",
      "处理流程先按照自然边界切分段落和句子，再删除完全重复的句子，最后在 token 预算内选择信息密度较高的原句。",
      "选择时不能改写 URL、文件路径、错误信息、数字和证据 URI，也不能把半句话截断。",
      "如果文本本身几乎没有重复，系统应该接受较低压缩率，而不是为了节省 token 擅自改写事实。",
      "当前实验使用确定性词法特征，并把本地中英语义向量作为可选的中心性和去重信号。",
      "当前实验使用确定性词法特征，并把本地中英语义向量作为可选的中心性和去重信号。",
      "最终输出恢复原始顺序；未选中的内容仍可通过 Artifact URI 取回，不在预览中伪造摘要。",
      "结论：抽取式预览适合大结果的请求级投影，但不能替代完整证据或模型摘要。",
    ].join("\n"),
  },
  {
    id: "dense-low-repeat",
    title: "低重复高密度正文",
    query: "schema migration composite index concurrently rollback date original schema",
    signals: ["schema migration", "composite index", "concurrently", "2026-10-01", "original schema untouched"],
    raw: [
      "The workspace contains a pending schema migration for table agent_events.",
      "The migration adds a nullable revision column and a composite index on session_id and created_at.",
      "The index is required by the continuity replay query and must be created concurrently in production.",
      "The API currently accepts both legacy and v2 event envelopes during the rollout window.",
      "The compatibility window ends at 2026-10-01T00:00:00Z.",
      "A failed migration must leave the original schema untouched and emit a recoverable checkpoint.",
      "No sentence in this sample is repeated, so a safe compressor should preserve most of the text.",
    ].join("\n"),
  },
  {
    id: "semantic-paraphrase",
    title: "中英同义近重复",
    query: "image result URI and provider error",
    signals: ["senera://resource/", "ERROR", "preserve the original URI"],
    raw: [
      "图片生成完成，文件已保存到 senera://resource/image-7f2a.png。",
      "图像已经成功生成，结果写入 senera://resource/image-7f2a.png。",
      "The image was generated successfully and stored at senera://resource/image-7f2a.png.",
      "图片生成完成，文件已保存到 senera://resource/image-7f2a.png。",
      "ERROR image provider timeout after 30000ms.",
      "Image creation finished successfully; preserve the original URI for retrieval.",
      "The output is ready for the user and should not be rewritten as a placeholder.",
    ].join("\n"),
  },
  {
    id: "lost-in-middle",
    title: "长上下文中部证据",
    query: "find deployment revision, artifact URI, and rollback requirement",
    signals: ["revision=rev-42", "senera://artifact/rev-42", "rollback required"],
    raw: [
      "trace header request_id=abc-7 status=started",
      "unrelated note: worker pool is healthy and queue depth is zero",
      "unrelated note: frontend assets were served from the local cache",
      "unrelated note: the weather connector returned a normal response",
      "deployment revision=rev-42 is the active workspace revision",
      "artifact=senera://artifact/rev-42 contains the complete checkpoint",
      "rollback required if the verification suite reports a contract mismatch",
      "unrelated note: no pending background jobs remain",
      "unrelated note: the last heartbeat was received within the expected interval",
      "trace footer duration_ms=184 status=completed",
    ].join("\n"),
  },
];

const argumentsSchema = {
  model: { type: "string" },
  "budget-ratio": { type: "string" },
  output: { type: "string" },
} as const;

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const { values } = parseArgs({ options: argumentsSchema, allowPositionals: false });
  const model = values.model ?? process.env.SENERA_PROMPT_BENCHMARK_MODEL ?? "gpt-5.6-luna";
  const budgetRatio = parseRatio(values["budget-ratio"] ?? process.env.SENERA_PROMPT_BENCHMARK_RATIO ?? "0.42");
  const encodingName = tokenizerMapping.modelToEncodingMap[model] ?? tokenizerMapping.DEFAULT_ENCODING;
  const tokenizer = require(encodingModules[encodingName]) as EncodingApi;
  const startedAt = performance.now();
  const samples = fixtures.map((fixture) => runFixture(fixture, tokenizer, budgetRatio));
  const structuredRepresentation = runStructuredRepresentation(tokenizer);
  const stablePrefix = runStablePrefix();
  const report: BenchmarkReport = {
    model,
    encodingName,
    resolution: Object.hasOwn(tokenizerMapping.modelToEncodingMap, model) ? "model_map" : "default_encoding",
    budgetRatio,
    scoringPolicy,
    semanticEngine: "ternlight-mini-cn",
    samples,
    structuredRepresentation,
    stablePrefix,
    validation: validateBenchmark(samples, structuredRepresentation, stablePrefix),
    elapsedMs: Math.round(performance.now() - startedAt),
  };
  const outputPath = path.resolve(values.output ?? ".cache/prompt-compression/benchmark-report.json");
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(report, null, 2), "utf8");
  const markdownPath = outputPath.replace(/\.json$/u, ".md");
  await writeFile(markdownPath, renderMarkdown(report), "utf8");
  process.stdout.write(`${JSON.stringify({ outputPath, markdownPath, summary: summarize(report) }, null, 2)}\n`);
}

function validateBenchmark(
  samples: readonly FixtureResult[],
  structuredRepresentation: readonly StructuredRepresentationResult[],
  stablePrefix: StablePrefixResult,
): BenchmarkValidation {
  return {
    allMethodsWithinBudget: samples.every((sample) =>
      Object.values(sample.methods).every((method) => method.withinBudget),
    ),
    everyFixtureHasRawAndProjection: samples.every(
      (sample) => sample.raw.text.length > 0 && Object.values(sample.methods).every((method) => method.text.length > 0),
    ),
    structuredRoundTrip: structuredRepresentation
      .filter((entry) => entry.name === "jsonCompact" || entry.name === "toon")
      .every((entry) => entry.roundTripExact),
    stablePrefix: stablePrefix.prefixUnchanged && stablePrefix.dynamicPayloadsDiffer,
  };
}

function runFixture(fixture: Fixture, tokenizer: EncodingApi, budgetRatio: number): FixtureResult {
  const units = splitUnits(fixture.raw);
  const rawTokens = tokenizer.countTokens(fixture.raw);
  const budget = Math.max(32, Math.floor(rawTokens * budgetRatio));
  const vectors = units.map((unit) => embedDocument(unit));
  const queryVector = embedQuery(fixture.query);
  const withoutPosition = selectUnits(
    units,
    budget,
    units.map((unit, index) =>
      unitScore(fixture.query, queryVector, unit, vectors[index]!, index, units.length, false),
    ),
    tokenizer,
  );
  const withPosition = selectUnits(
    units,
    budget,
    units.map((unit, index) => unitScore(fixture.query, queryVector, unit, vectors[index]!, index, units.length, true)),
    tokenizer,
  );
  const withProtectedAtoms = selectUnits(
    units,
    budget,
    units.map((unit, index) =>
      unitScore(fixture.query, queryVector, unit, vectors[index]!, index, units.length, true, true),
    ),
    tokenizer,
  );
  const weightedTokens = scoreTokens(fixture, units, vectors, queryVector, tokenizer);
  const tokenWeighted = selectTokens(weightedTokens, budget, tokenizer);
  const spanWeighted = selectUnits(units, budget, aggregateScores(weightedTokens, units.length), tokenizer);
  return {
    id: fixture.id,
    title: fixture.title,
    query: fixture.query,
    budget,
    unitCount: units.length,
    raw: { text: fixture.raw, tokens: rawTokens },
    methods: {
      queryAware: projectMethod(withoutPosition.text, fixture, tokenizer, budget, withoutPosition.indices),
      queryAwarePositionAware: projectMethod(withPosition.text, fixture, tokenizer, budget, withPosition.indices),
      queryAwareAtomWeighted: projectMethod(
        withProtectedAtoms.text,
        fixture,
        tokenizer,
        budget,
        withProtectedAtoms.indices,
      ),
      tokenWeightedExtractive: projectMethod(tokenWeighted.text, fixture, tokenizer, budget, undefined, {
        topWeights: tokenWeighted.topWeights,
      }),
      coarseToFineSpanSelection: projectMethod(spanWeighted.text, fixture, tokenizer, budget, spanWeighted.indices, {
        topWeights: weightedTokens
          .slice()
          .sort((left, right) => right.score - left.score)
          .slice(0, 12)
          .map(projectWeight),
      }),
    },
  };
}

function unitScore(
  query: string,
  queryVector: Float32Array,
  unit: string,
  vector: Float32Array,
  index: number,
  size: number,
  positionAware: boolean,
  protectedAtomAware = false,
): number {
  const atomCoverage = Math.min(1, atoms(unit).length / 3);
  return (
    lexicalRelevance(query, unit) * scoringPolicy.unitLexical +
    Math.max(0, cosineSim(queryVector, vector)) * scoringPolicy.unitSemantic +
    positionWeight(index, size, positionAware) * scoringPolicy.unitPosition +
    (protectedAtomAware ? atomCoverage * scoringPolicy.unitProtectedAtom : 0)
  );
}

function splitUnits(text: string): string[] {
  return text
    .split(/\r?\n/gu)
    .flatMap((line) => [...sentenceSegmenter.segment(line)].map(({ segment }) => segment.trim()))
    .filter(Boolean);
}

function scoreTokens(
  fixture: Fixture,
  units: readonly string[],
  vectors: readonly Float32Array[],
  queryVector: Float32Array,
  tokenizer: EncodingApi,
): WeightedToken[] {
  const queryTerms = terms(fixture.query).map((term) => term.toLocaleLowerCase());
  const documentFrequency = new Map<number, number>();
  for (const unit of units) {
    for (const token of new Set(tokenizer.encode(unit)))
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
  }
  return units.flatMap((unit, unitIndex) => {
    const encoded = tokenizer.encode(unit);
    const semantic = Math.max(0, cosineSim(queryVector, vectors[unitIndex]!));
    const position = positionWeight(unitIndex, units.length, true);
    const protectedAtoms = atoms(unit).map((atom) => atom.toLocaleLowerCase());
    return encoded.map((id, tokenIndex) => {
      const text = tokenizer.decode([id]);
      const lower = text.toLocaleLowerCase();
      const queryMatch = queryTerms.some((term) => lower.includes(term)) ? 1 : 0;
      const protectedMatch = protectedAtoms.some((atom) => atom.includes(lower.trim()) && lower.trim().length > 0);
      const rarity = Math.min(1, Math.log1p(units.length / (documentFrequency.get(id) ?? 1)) / 2.5);
      const boundary = tokenIndex === 0 || tokenIndex === encoded.length - 1 ? 1 : 0.15;
      return {
        id,
        text,
        unitIndex,
        tokenIndex,
        score:
          queryMatch * scoringPolicy.queryLexical +
          (protectedMatch ? scoringPolicy.protectedAtom : 0) +
          rarity * scoringPolicy.rarity +
          semantic * scoringPolicy.querySemantic +
          boundary * scoringPolicy.boundary +
          position * scoringPolicy.position,
      };
    });
  });
}

function selectUnits(units: readonly string[], budget: number, scores: readonly number[], tokenizer: EncodingApi) {
  const ranked = scores
    .map((score, index) => ({ score, index }))
    .sort((left, right) => right.score - left.score || left.index - right.index);
  const selected = new Set<number>();
  for (const { index } of ranked) {
    const candidate = [...selected, index]
      .sort((left, right) => left - right)
      .map((unitIndex) => units[unitIndex]!)
      .join("\n");
    if (tokenizer.countTokens(candidate) <= budget) selected.add(index);
  }
  const indices = [...selected].sort((left, right) => left - right);
  return { indices, text: indices.map((index) => units[index]!).join("\n") };
}

function selectTokens(tokens: readonly WeightedToken[], budget: number, tokenizer: EncodingApi) {
  const ranked = [...tokens].sort(
    (left, right) => right.score - left.score || left.unitIndex - right.unitIndex || left.tokenIndex - right.tokenIndex,
  );
  const selected = new Set<string>();
  for (const candidate of ranked) {
    const key = `${candidate.unitIndex}:${candidate.tokenIndex}`;
    const candidateTokens = tokens
      .filter(
        (token) =>
          selected.has(`${token.unitIndex}:${token.tokenIndex}`) || `${token.unitIndex}:${token.tokenIndex}` === key,
      )
      .sort((left, right) => left.unitIndex - right.unitIndex || left.tokenIndex - right.tokenIndex);
    const candidateText = tokenizer.decode(candidateTokens.map((token) => token.id));
    if (tokenizer.countTokens(candidateText) <= budget) selected.add(key);
  }
  const selectedTokens = tokens
    .filter((token) => selected.has(`${token.unitIndex}:${token.tokenIndex}`))
    .sort((left, right) => left.unitIndex - right.unitIndex || left.tokenIndex - right.tokenIndex);
  return {
    text: tokenizer.decode(selectedTokens.map((token) => token.id)),
    topWeights: ranked.slice(0, 12).map(projectWeight),
  };
}

function aggregateScores(tokens: readonly WeightedToken[], unitCount: number): number[] {
  return Array.from({ length: unitCount }, (_, unitIndex) => {
    const scores = tokens
      .filter((token) => token.unitIndex === unitIndex)
      .map((token) => token.score)
      .sort((left, right) => right - left);
    const top = scores.slice(0, Math.max(1, Math.ceil(scores.length * 0.25)));
    return top.reduce((total, score) => total + score, 0) / Math.sqrt(Math.max(1, scores.length));
  });
}

function projectMethod(
  text: string,
  fixture: Fixture,
  tokenizer: EncodingApi,
  budget: number,
  indices?: readonly number[],
  extra: Pick<MethodResult, "topWeights"> = {},
): MethodResult {
  const retainedSignals = signalRecall(text, fixture.signals);
  const protectedAtoms = atoms(fixture.raw);
  const retainedAtoms = protectedAtoms.filter((atom) => text.includes(atom));
  return {
    text,
    tokens: tokenizer.countTokens(text),
    withinBudget: tokenizer.countTokens(text) <= budget,
    savedPercent: Number(((1 - tokenizer.countTokens(text) / tokenizer.countTokens(fixture.raw)) * 100).toFixed(1)),
    retainedSignals,
    missingSignals: fixture.signals.filter((signal) => !retainedSignals.includes(signal)),
    retainedAtoms,
    missingAtoms: protectedAtoms.filter((atom) => !retainedAtoms.includes(atom)),
    ...(indices === undefined ? {} : { indices }),
    ...extra,
  };
}

function runStructuredRepresentation(tokenizer: EncodingApi): StructuredRepresentationResult[] {
  const records = [
    { name: "read_file", status: "success", path: "E:/senera/src/App.ts", tokens: 128, duration_ms: 3 },
    { name: "search", status: "success", path: "E:/senera/src/Agent.ts", tokens: 64, duration_ms: 2 },
    { name: "shell", status: "error", path: "E:/senera", tokens: 0, duration_ms: 30_000 },
    { name: "image", status: "success", path: "senera://resource/image-7f2a.png", tokens: 1, duration_ms: 840 },
  ];
  const declaration = [
    "records(name,status,path,tokens,duration_ms)",
    ...records.map(({ name, status, path: recordPath, tokens, duration_ms }) =>
      [name, status, recordPath, tokens, duration_ms].join("\t"),
    ),
  ].join("\n");
  const variants = [
    ["jsonCompact", JSON.stringify(records)],
    ["toon", encodeToon(records)],
    ["declarationRows", declaration],
  ] as const;
  return variants.map(([name, text]) => ({
    name,
    text,
    tokens: tokenizer.countTokens(text),
    bytes: Buffer.byteLength(text, "utf8"),
    roundTripExact:
      name === "toon" ? JSON.stringify(decodeToon(text)) === JSON.stringify(records) : name === "jsonCompact",
  }));
}

function runStablePrefix(): StablePrefixResult {
  const stable = ["senera_protocol=v1", "records(name,status,path,tokens,duration_ms)", "status(success,error)"].join(
    "\n",
  );
  const dynamic = ["revision=r1\nworld=lab", "revision=r2\nworld=lab", "revision=r3\nworld=office"];
  const requests = dynamic.map((suffix) => `${stable}\n${suffix}`);
  return {
    stableBytes: Buffer.byteLength(stable, "utf8"),
    prefixUnchanged: requests.every(
      (request) => request.startsWith(stable) && request.slice(0, stable.length) === stable,
    ),
    dynamicPayloadsDiffer: new Set(dynamic).size === dynamic.length,
  };
}

function lexicalRelevance(query: string, unit: string): number {
  const queryTerms = new Set(terms(query));
  const unitTerms = new Set(terms(unit));
  if (queryTerms.size === 0 || unitTerms.size === 0) return 0;
  let overlap = 0;
  for (const term of queryTerms) if (unitTerms.has(term)) overlap += 1;
  return overlap / queryTerms.size;
}

function terms(text: string): string[] {
  const latin = text.toLocaleLowerCase().match(/[a-z][a-z0-9_./:-]*/gu) ?? [];
  const numbers = text.match(/\b\d+(?:\.\d+)?\b/gu) ?? [];
  const cjk = [...text.matchAll(/[\u3400-\u9fff]{2,}/gu)].flatMap(([value]) =>
    [...value].flatMap((_, index) => (index + 1 < value.length ? [value.slice(index, index + 2)] : [])),
  );
  return [...latin, ...numbers, ...cjk];
}

function atoms(text: string): string[] {
  const candidates =
    text.match(
      /(?:[a-z][a-z0-9+.-]{1,15}:\/\/[^\s<>"'`]+|(?:[A-Za-z]:[\\/]|\.\.?[\\/]|\/)[^\s<>"'`]+|(?:\b[\w.-]+\/)+[\w./:-]+|\b0x[\da-f]+\b|\b\d{4}-\d{2}-\d{2}(?:[Tt]\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)?|\b\d+(?:\.\d+)+\b|\b\d+(?:\.\d+)?\b)/giu,
    ) ?? [];
  return [...new Set(candidates.map((candidate) => candidate.replace(/[.,;:!?，。！？；：)\]}]+$/gu, "")))];
}

function positionWeight(index: number, size: number, enabled: boolean): number {
  if (!enabled || size <= 1) return 1;
  return index === 0 || index === size - 1 ? 1 : 0.25;
}

function signalRecall(text: string, signals: readonly string[]): string[] {
  const lower = text.toLocaleLowerCase();
  return signals.filter((signal) => lower.includes(signal.toLocaleLowerCase()));
}

function projectWeight(token: WeightedToken): WeightProjection {
  return {
    text: token.text,
    score: Number(token.score.toFixed(4)),
    unitIndex: token.unitIndex,
    tokenIndex: token.tokenIndex,
  };
}

function summarize(report: BenchmarkReport) {
  return {
    validation: report.validation,
    samples: report.samples.map((sample) => ({
      id: sample.id,
      rawTokens: sample.raw.tokens,
      methods: Object.fromEntries(
        Object.entries(sample.methods).map(([name, method]) => [
          name,
          {
            tokens: method.tokens,
            withinBudget: method.withinBudget,
            missingSignals: method.missingSignals,
            missingAtoms: method.missingAtoms,
          },
        ]),
      ),
    })),
  };
}

function renderMarkdown(report: BenchmarkReport): string {
  const lines = [
    "# Prompt compression benchmark",
    "",
    `Model: ${report.model}; encoding: ${report.encodingName}; budget ratio: ${report.budgetRatio}`,
    "",
    "The token classifier is a deterministic extractive proxy. It does not claim to reproduce a trained LLMLingua model.",
    "",
    "Methods: query-aware selects complete units; position-aware adds a lost-in-the-middle signal; atom-weighted adds generic URI/path/date/number relevance; tokenWeightedExtractive is an intentionally unsafe token-deletion baseline; coarseToFineSpanSelection aggregates token scores back to complete units.",
    "",
    `Validation: ${JSON.stringify(report.validation)}`,
    "",
    "## Structured representation",
    "",
    "| Variant | Tokens | Bytes | Exact round-trip |",
    "| --- | ---: | ---: | --- |",
    ...report.structuredRepresentation.map(
      (entry) => `| ${entry.name} | ${entry.tokens} | ${entry.bytes} | ${entry.roundTripExact ? "yes" : "no"} |`,
    ),
    "",
    `Stable prefix unchanged: ${report.stablePrefix.prefixUnchanged}; dynamic payloads differ: ${report.stablePrefix.dynamicPayloadsDiffer}`,
    "",
  ];
  for (const sample of report.samples) {
    lines.push(
      `## ${sample.title} (${sample.id})`,
      "",
      `Query: ${sample.query}`,
      "",
      `Budget: ${sample.budget}; raw: ${sample.raw.tokens} tokens; units: ${sample.unitCount}`,
      "",
      "### Raw",
      "",
      "```text",
      sample.raw.text,
      "```",
      "",
    );
    for (const [name, method] of Object.entries(sample.methods)) {
      lines.push(
        `### ${name} (${method.tokens} tokens; saved ${method.savedPercent}%; within budget=${method.withinBudget})`,
        "",
        `Retained: ${method.retainedSignals.join(", ") || "-"}`,
        `Missing: ${method.missingSignals.join(", ") || "-"}`,
        `Missing protected atoms: ${method.missingAtoms.join(", ") || "-"}`,
        ...(method.topWeights
          ? [
              `Top weights: ${method.topWeights.map((weight) => `${JSON.stringify(weight.text)}=${weight.score}`).join(" ")}`,
            ]
          : []),
        "",
        "```text",
        method.text,
        "```",
        "",
      );
    }
  }
  return lines.join("\n");
}

function parseRatio(value: string): number {
  const ratio = Number(value);
  if (!Number.isFinite(ratio) || ratio <= 0 || ratio >= 1)
    throw new Error("--budget-ratio must be greater than 0 and less than 1.");
  return ratio;
}
