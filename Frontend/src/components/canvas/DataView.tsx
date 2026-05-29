import { memo, useMemo, useState } from "react";
import { ChevronRight, ExternalLink, FileText } from "lucide-react";
import { cn } from "../../lib/util";
import { MarkdownRenderer } from "../MarkdownRenderer";

/**
 * 任意结构化数据的渲染——DevTools 风格的缩进树，**不用卡片框**。
 *
 * 设计：
 * - 顶层字段：紧凑的 key | value 行
 * - 嵌套对象/数组：左侧细线 + 缩进，可折叠
 * - key 显示原值，仅做 camelCase / snake_case → 空格的算法化分词（**不维护字典**）
 * - 值按类型智能渲染：数字千位、URL 链接、ISO 时间、长串 markdown
 * - `xxx` + `xxxUnit` 自动合并（算法，不写字典）
 * - 空集合 / 空字符串：muted 占位
 */
export const DataView = memo(function DataView({ value }: { value: unknown }): JSX.Element {
  return <Node value={value} depth={0} />;
});

function Node({ value, depth }: { value: unknown; depth: number }): JSX.Element {
  if (isPrimitive(value)) return <Primitive value={value} />;
  if (Array.isArray(value)) return <ArrayBlock items={value} depth={depth} />;
  if (isPlainObject(value)) {
    const frame = readSourceFrame(value);
    if (frame) {
      return <SourceFrameBlock frame={frame} depth={depth} />;
    }
    return <ObjectBlock entries={Object.entries(value)} depth={depth} />;
  }
  return <span className="text-ink-400">{String(value)}</span>;
}

// ---------- 对象块 ----------

function ObjectBlock({
  entries,
  depth,
}: {
  entries: Array<[string, unknown]>;
  depth: number;
}): JSX.Element {
  const items = useMemo(() => combineUnitPairs(entries), [entries]);

  if (entries.length === 0) {
    return <span className="font-mono text-[11.5px] italic text-ink-400">{`{}`}</span>;
  }

  const wrapperClass =
    depth > 0
      ? "ml-1 border-l border-ink-200/50 pl-3"
      : "";

  return (
    <div className={wrapperClass}>
      {items.map(({ key, value, unit }) => (
        <Row key={key} keyName={key} value={value} unit={unit} depth={depth} />
      ))}
    </div>
  );
}

// ---------- 数组块 ----------

function ArrayBlock({ items, depth }: { items: unknown[]; depth: number }): JSX.Element {
  if (items.length === 0) {
    return <span className="font-mono text-[11.5px] italic text-ink-400">{`[]`}</span>;
  }

  // 全是简单原始值 → chips 横排
  const allPrimitive = items.every(
    (it) => typeof it === "string" || typeof it === "number" || typeof it === "boolean",
  );
  if (allPrimitive && items.length <= 12) {
    return (
      <div className="flex flex-wrap gap-1.5 py-1">
        {items.map((it, i) => (
          <span
            key={i}
            className="inline-flex items-center rounded-full border border-ink-200/70 bg-paper-100 px-2 py-0.5 text-[12px] text-ink-800"
          >
            {String(it)}
          </span>
        ))}
      </div>
    );
  }

  // 复杂或长数组 → 缩进 + 数字索引
  const wrapperClass = depth > 0 ? "ml-1 border-l border-ink-200/50 pl-3" : "";
  return (
    <div className={wrapperClass}>
      {items.map((it, i) => (
        <Row key={i} keyName={`[${i}]`} value={it} depth={depth} indexLike />
      ))}
    </div>
  );
}

// ---------- 单行 ----------

function Row({
  keyName,
  value,
  unit,
  depth,
  indexLike = false,
}: {
  keyName: string;
  value: unknown;
  unit?: string;
  depth: number;
  indexLike?: boolean;
}): JSX.Element {
  const complex = !isPrimitive(value);
  const hasChildren =
    complex &&
    ((Array.isArray(value) && value.length > 0) ||
      (isPlainObject(value) && Object.keys(value).length > 0));
  const [open, setOpen] = useState(depth === 0);

  // 没子节点（含空对象/空数组/原始值）：单行 key|value
  if (!hasChildren) {
    return (
      <div className="grid grid-cols-[minmax(96px,max-content)_minmax(0,1fr)] items-baseline gap-x-4 py-1.5">
        <KeyText name={keyName} indexLike={indexLike} />
        <div className="min-w-0 break-words text-[13px] leading-snug text-ink-900">
          <FormattedValue value={value} unit={unit} />
        </div>
      </div>
    );
  }

  // 有子节点：可折叠
  return (
    <div className="py-1.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="-ml-3 flex items-center gap-1 rounded text-left transition hover:bg-ink-900/[0.03]"
      >
        <ChevronRight
          className={cn(
            "h-3 w-3 shrink-0 text-ink-400 transition",
            open && "rotate-90",
          )}
        />
        <KeyText name={keyName} indexLike={indexLike} />
        <CountHint value={value} />
      </button>
      {open ? (
        <div className="mt-1">
          <Node value={value} depth={depth + 1} />
        </div>
      ) : null}
    </div>
  );
}

function KeyText({ name, indexLike }: { name: string; indexLike: boolean }): JSX.Element {
  return (
    <span
      className={cn(
        "shrink-0 self-start pt-px",
        indexLike
          ? "font-mono text-[11px] text-ink-400"
          : "font-mono text-[11px] text-ink-500",
      )}
    >
      {humanizeAlgo(name)}
    </span>
  );
}

function CountHint({ value }: { value: unknown }): JSX.Element | null {
  if (Array.isArray(value)) {
    return (
      <span className="font-mono text-[10.5px] text-ink-400">[{value.length}]</span>
    );
  }
  if (isPlainObject(value)) {
    const n = Object.keys(value).length;
    return (
      <span className="font-mono text-[10.5px] text-ink-400">{`{${n}}`}</span>
    );
  }
  return null;
}

// ---------- 源码片段 ----------

interface SourceFrame {
  path?: string;
  startLine?: number;
  endLine?: number;
  focusLine?: number;
  code: string;
  metadata: Array<[string, unknown]>;
}

function SourceFrameBlock({ frame, depth }: { frame: SourceFrame; depth: number }): JSX.Element {
  return (
    <div className="space-y-2 py-1">
      <div className="overflow-hidden rounded-md border border-ink-200/80 bg-paper-50">
        <div className="flex min-w-0 items-center gap-2 border-b border-ink-200/70 bg-paper-100 px-3 py-2">
          <FileText className="h-3.5 w-3.5 shrink-0 text-ink-400" />
          <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-ink-700">
            {frame.path ?? "source"}
          </span>
          <span className="shrink-0 font-mono text-[10.5px] text-ink-400">
            {formatLineRange(frame)}
          </span>
        </div>
        <pre className="max-h-[360px] overflow-auto bg-[#f6f2e8] px-0 py-2 font-mono text-[12px] leading-5 text-ink-900 scrollbar-thin">
          <code>
            {frame.code.split(/\r?\n/).map((line, index) => {
              const parsed = parseNumberedLine(line);
              const lineNumber = parsed?.line ?? (frame.startLine ? frame.startLine + index : index + 1);
              const code = parsed?.code ?? line;
              const focused = frame.focusLine === lineNumber;
              return (
                <span
                  key={`${lineNumber}:${index}`}
                  className={cn(
                    "grid grid-cols-[4.25rem_minmax(0,1fr)] px-3",
                    focused && "bg-terra-50/80",
                  )}
                >
                  <span className="select-none border-r border-ink-200/70 pr-3 text-right text-ink-400">
                    {lineNumber}
                  </span>
                  <span className="min-w-0 whitespace-pre-wrap break-words pl-3">
                    {code.length > 0 ? code : " "}
                  </span>
                </span>
              );
            })}
          </code>
        </pre>
      </div>
      {frame.metadata.length > 0 ? (
        <ObjectBlock entries={frame.metadata} depth={depth + 1} />
      ) : null}
    </div>
  );
}

// ---------- 值格式化 ----------

function Primitive({ value }: { value: unknown }): JSX.Element {
  return <FormattedValue value={value} />;
}

function FormattedValue({ value, unit }: { value: unknown; unit?: string }): JSX.Element {
  if (value === null) {
    return <span className="font-mono text-[11.5px] italic text-ink-400">null</span>;
  }
  if (value === undefined) {
    return <span className="font-mono text-[11.5px] italic text-ink-400">—</span>;
  }

  if (typeof value === "boolean") {
    return (
      <span
        className={cn(
          "inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[11px]",
          value ? "bg-moss-50 text-moss-600" : "bg-ink-100 text-ink-500",
        )}
      >
        {value ? "true" : "false"}
      </span>
    );
  }

  if (typeof value === "number") {
    return (
      <span className="tabular-nums text-ink-900">
        {formatNumber(value)}
        {unit ? <span className="ml-1 text-ink-500">{unit}</span> : null}
      </span>
    );
  }

  if (typeof value === "string") {
    return <FormattedString value={value} unit={unit} />;
  }

  // 落到这里说明上层 Row 没把它当 complex 处理（应该是空对象/空数组，已在上面返回）
  if (Array.isArray(value)) return <ArrayBlock items={value} depth={0} />;
  if (isPlainObject(value)) {
    return <ObjectBlock entries={Object.entries(value)} depth={0} />;
  }
  return <span>{String(value)}</span>;
}

function FormattedString({ value, unit }: { value: string; unit?: string }): JSX.Element {
  if (value.length === 0) {
    return <span className="font-mono text-[11.5px] italic text-ink-400">—</span>;
  }

  if (/^https?:\/\//.test(value)) {
    return (
      <a
        href={value}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 break-all text-terra-600 underline decoration-terra-300 underline-offset-2 hover:text-terra-700"
      >
        {value}
        <ExternalLink className="h-3 w-3 shrink-0" />
      </a>
    );
  }

  // ISO 8601 时间戳 → 人话
  if (/^\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}/.test(value)) {
    const formatted = formatIsoDate(value);
    if (formatted) {
      return (
        <span className="text-ink-900">
          {formatted}
          <span className="ml-2 font-mono text-[10.5px] text-ink-400">{value}</span>
        </span>
      );
    }
  }

  const isLong = value.length > 120;
  const hasNewline = value.includes("\n");
  const looksLikeMd = /(^#+\s)|(```)|(^\s*[-*]\s)|(\*\*.+\*\*)/m.test(value);
  if (isLong || hasNewline || looksLikeMd) {
    return (
      <MarkdownRenderer contentClassName="text-[13px] leading-relaxed" compact lightweightCode>
        {value}
      </MarkdownRenderer>
    );
  }

  return (
    <span className="text-ink-900">
      {value}
      {unit ? <span className="ml-1 text-ink-500">{unit}</span> : null}
    </span>
  );
}

// ---------- 工具函数 ----------

/** 算法化分词：camelCase / snake_case / kebab-case → 空格小写；不维护任何字典 */
function humanizeAlgo(key: string): string {
  if (/^\[\d+\]$/.test(key)) return key; // 数组索引保留
  return key
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .replace(/[_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** 合并 `xxx` + `xxxUnit`：把 `temperature: 25, temperatureUnit: "°C"` 合成一行 25 °C */
function combineUnitPairs(
  entries: Array<[string, unknown]>,
): Array<{ key: string; value: unknown; unit?: string }> {
  const result: Array<{ key: string; value: unknown; unit?: string }> = [];
  const consumed = new Set<string>();

  for (const [key, value] of entries) {
    if (consumed.has(key)) continue;

    if (/Unit$/.test(key)) {
      const baseKey = key.replace(/Unit$/, "");
      if (entries.some(([k]) => k === baseKey)) continue;
    }

    consumed.add(key);
    const unitKey = `${key}Unit`;
    const unitEntry = entries.find(([k]) => k === unitKey);
    if (unitEntry && typeof unitEntry[1] === "string") {
      consumed.add(unitKey);
      result.push({ key, value, unit: unitEntry[1] });
    } else {
      result.push({ key, value });
    }
  }
  return result;
}

function formatNumber(n: number): string {
  if (Number.isInteger(n) && Math.abs(n) < 10000) return String(n);
  if (Number.isInteger(n)) return n.toLocaleString();
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function formatIsoDate(iso: string): string | null {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    const now = new Date();
    const sameDay =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();
    const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    if (sameDay) return `今天 ${time}`;
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${time}`;
  } catch {
    return null;
  }
}

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

function isPrimitive(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readSourceFrame(value: Record<string, unknown>): SourceFrame | null {
  const codeEntry = findStringEntry(value, ["snippet", "content", "frameText", "text"]);
  if (!codeEntry) return null;

  const frame = isPlainObject(value.frame) ? value.frame : undefined;
  const position = isPlainObject(value.position) ? value.position : undefined;
  const path = readString(value.path) ?? readString(value.file) ?? readString(value.filePath);
  const startLine = readNumber(value.startLine) ?? readNumber(frame?.startLine);
  const endLine = readNumber(value.endLine) ?? readNumber(frame?.endLine);
  const focusLine = readNumber(value.line) ?? readNumber(position?.line);
  const code = codeEntry[1].trimEnd();
  const hasLocation = Boolean(path) || startLine !== undefined || endLine !== undefined || focusLine !== undefined;
  if (!hasLocation || code.length === 0 || !looksLikeSourceFrame(code)) return null;

  const hidden = new Set([
    codeEntry[0],
    "path",
    "file",
    "filePath",
    "startLine",
    "endLine",
    "line",
    "position",
    "frame",
  ]);
  const metadata = Object.entries(value).filter(([key]) => !hidden.has(key));

  return {
    path,
    startLine,
    endLine,
    focusLine,
    code,
    metadata,
  };
}

function findStringEntry(
  value: Record<string, unknown>,
  preferredKeys: string[],
): [string, string] | null {
  for (const key of preferredKeys) {
    const entry = value[key];
    if (typeof entry === "string" && entry.trim().length > 0) {
      return [key, entry];
    }
  }
  return null;
}

function looksLikeSourceFrame(value: string): boolean {
  return value.includes("\n") || /^\s*\d+\s*[:|]/m.test(value);
}

function parseNumberedLine(line: string): { line: number; code: string } | null {
  const match = /^\s*(\d+)\s*[:|]\s?(.*)$/.exec(line);
  if (!match) return null;
  return {
    line: Number(match[1]),
    code: match[2] ?? "",
  };
}

function formatLineRange(frame: SourceFrame): string {
  if (frame.startLine !== undefined && frame.endLine !== undefined) {
    return frame.startLine === frame.endLine
      ? `L${frame.startLine}`
      : `L${frame.startLine}-L${frame.endLine}`;
  }
  if (frame.focusLine !== undefined) return `L${frame.focusLine}`;
  return "source";
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
