import fs from "node:fs";
import path from "node:path";
import { Temporal } from "@js-temporal/polyfill";
import { z } from "zod";
import { isMissingFileError, listDirectoryNamesSync, writeFileAtomicSync } from "../Core/AgentFs.js";
import { sha256HexOfCanonicalJson } from "../Core/AgentHash.js";
import {
  AgentMemoryDiaryDocumentSchema,
  AgentMemoryDiaryKeySchema,
  type AgentMemoryDiaryDocument,
  type AgentMemoryDiaryEntry,
} from "./AgentMemoryDiaryContract.js";

const MetadataSchema = z
  .object({
    version: z.literal(1),
    revision: z.string().min(1),
    contentHash: z.string().min(1),
    episodeUris: z.array(z.string()),
    sourceUris: z.array(z.string()),
    importedFrom: z.string().optional(),
  })
  .strict();
export type AgentMemoryDiaryMetadata = Omit<z.infer<typeof MetadataSchema>, "version" | "contentHash">;
export interface AgentMemoryDiaryRead extends AgentMemoryDiaryEntry {
  readonly body: string;
  readonly metadata?: AgentMemoryDiaryMetadata;
}

/** Markdown is authoritative. Sidecars hold provenance, never another copy of the diary. */
export class AgentMemoryDiaryStore {
  constructor(readonly root: string) {}

  forSubject(subject: string): AgentMemoryDiaryStore {
    if (!subject.trim()) throw new Error("A diary requires its host-resolved subject.");
    const root = path.join(this.root, "subjects", Buffer.from(subject, "utf8").toString("base64url"));
    this.assertNoSymlinks(root);
    return new AgentMemoryDiaryStore(root);
  }

  subjects(): readonly string[] {
    const root = path.join(this.root, "subjects");
    this.assertNoSymlinks(root);
    return listDirectoryNamesSync(root).map((name) => {
      const subject = Buffer.from(name, "base64url").toString("utf8");
      if (!subject || Buffer.from(subject, "utf8").toString("base64url") !== name)
        throw new Error("Invalid diary subject directory.");
      return subject;
    });
  }

  pathFor(key: string): string {
    const segments = AgentMemoryDiaryKeySchema.parse(key).split("-");
    const target = path.join(this.root, ...segments, "diary.md");
    this.assertNoSymlinks(path.dirname(target));
    return target;
  }

  read(key: string): AgentMemoryDiaryRead | undefined {
    const file = this.pathFor(key);
    const markdown = readOptional(file);
    if (markdown === undefined) return undefined;
    const heading = /^# ([^\r\n]+)\r?\n\r?\n([\s\S]+)$/u.exec(markdown);
    if (!heading) throw new Error(`Invalid diary Markdown: ${file}`);
    const document = AgentMemoryDiaryDocumentSchema.parse({ title: heading[1], body: heading[2] });
    const rawMetadata = readOptional(this.metadataPath(key));
    const metadata = rawMetadata === undefined ? undefined : MetadataSchema.parse(JSON.parse(rawMetadata));
    return {
      key,
      ...document,
      path: this.relativePath(key),
      ...(metadata?.contentHash === sha256HexOfCanonicalJson(markdown) ? { metadata } : {}),
    };
  }

  write(key: string, document: AgentMemoryDiaryDocument, metadata: AgentMemoryDiaryMetadata): void {
    const value = AgentMemoryDiaryDocumentSchema.parse(document);
    const markdown = `# ${value.title}\n\n${value.body}\n`;
    const state = MetadataSchema.parse({ ...metadata, version: 1, contentHash: sha256HexOfCanonicalJson(markdown) });
    // A crash between these two renames leaves readable Markdown and an uncommitted revision.
    writeFileAtomicSync(this.pathFor(key), markdown, { mode: 0o600, directoryMode: 0o700, fsync: true });
    writeFileAtomicSync(this.metadataPath(key), `${JSON.stringify(state)}\n`, { mode: 0o600, fsync: true });
  }

  remove(key: string): void {
    for (const file of [this.pathFor(key), this.metadataPath(key)]) fs.rmSync(file, { force: true });
  }

  archiveLegacy(key: string, id: string, body: string): void {
    AgentMemoryDiaryKeySchema.parse(key);
    const directory = path.join(this.root, "legacy");
    this.assertNoSymlinks(directory);
    writeFileAtomicSync(path.join(directory, `${sha256HexOfCanonicalJson(id)}.md`), `# ${key}\n\n${body}\n`, {
      mode: 0o600,
      directoryMode: 0o700,
      fsync: true,
    });
  }

  list(input: { from?: string; to?: string; period?: "day" | "month" } = {}): AgentMemoryDiaryEntry[] {
    for (const key of [input.from, input.to]) if (key) AgentMemoryDiaryKeySchema.parse(key);
    const keys: string[] = [];
    this.assertNoSymlinks(this.root);
    for (const year of listDirectoryNamesSync(this.root)
      .filter((name) => /^\d{4}$/u.test(name))
      .sort()) {
      this.assertNoSymlinks(path.join(this.root, year));
      for (const month of listDirectoryNamesSync(path.join(this.root, year))
        .filter((name) => /^\d{2}$/u.test(name))
        .sort()) {
        const monthKey = `${year}-${month}`;
        if (!AgentMemoryDiaryKeySchema.safeParse(monthKey).success) continue;
        const directory = path.dirname(this.pathFor(monthKey));
        if (input.period !== "day") keys.push(monthKey);
        if (input.period !== "month") {
          for (const day of listDirectoryNamesSync(directory).filter((name) => /^\d{2}$/u.test(name))) {
            const key = `${monthKey}-${day}`;
            if (AgentMemoryDiaryKeySchema.safeParse(key).success) keys.push(key);
          }
        }
      }
    }
    return keys
      .sort()
      .filter((key) => (!input.from || key >= input.from) && (!input.to || key <= input.to))
      .flatMap((key) => {
        const value = this.read(key);
        return value ? [{ key, title: value.title, path: value.path }] : [];
      });
  }

  recentIndex(today: string, days: number): string {
    const date = Temporal.PlainDate.from(today);
    const entries = Array.from({ length: days }, (_, offset) => date.subtract({ days: offset + 1 }).toString())
      .reverse()
      .flatMap((key) => {
        const entry = this.read(key);
        return entry ? [entry] : [];
      });
    return renderAgentMemoryDiaryIndex(entries);
  }

  writeIndex(today: string, days: number): void {
    const index = this.recentIndex(today, days);
    this.assertNoSymlinks(this.root);
    writeFileAtomicSync(path.join(this.root, "index.md"), `${index || "# Memory index\n"}\n`, {
      mode: 0o600,
      directoryMode: 0o700,
    });
  }

  invalidateSources(episodeUris: ReadonlySet<string>, sourceUris: ReadonlySet<string>): void {
    const months = new Set<string>();
    for (const { key } of this.list()) {
      const value = this.read(key)!;
      const provenance = value.metadata;
      // Unknown provenance must never survive a source-erasure request.
      if (
        !provenance ||
        (!provenance.episodeUris.length && !provenance.sourceUris.length) ||
        provenance.episodeUris.some((uri) => episodeUris.has(uri)) ||
        provenance.sourceUris.some((uri) => sourceUris.has(uri))
      ) {
        this.remove(key);
        months.add(key.slice(0, 7));
      }
    }
    for (const month of months) this.remove(month);
    // Migration archives may lack exact source provenance. Erase these owned exports on any source erasure.
    const legacyRoot = path.join(this.root, "legacy");
    this.assertNoSymlinks(legacyRoot);
    for (const file of listDirectoryNamesSync(legacyRoot).filter((name) => /^[a-f0-9]{64}\.md$/u.test(name)))
      fs.rmSync(path.join(legacyRoot, file), { force: true });
  }

  private relativePath(key: string): string {
    return path.relative(this.root, this.pathFor(key)).split(path.sep).join("/");
  }
  private metadataPath(key: string): string {
    return path.join(path.dirname(this.pathFor(key)), ".diary.json");
  }
  private assertNoSymlinks(directory: string): void {
    let current = directory;
    for (;;) {
      try {
        if (fs.lstatSync(current).isSymbolicLink())
          throw new Error(`Diary paths may not contain symbolic links: ${current}`);
      } catch (error) {
        if (!isMissingFileError(error)) throw error;
      }
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
}

export function renderAgentMemoryDiaryIndex(entries: readonly AgentMemoryDiaryEntry[]): string {
  if (!entries.length) return "";
  return [
    "# Memory index",
    "",
    ...entries.map((entry) => `- [${escapeLinkText(entry.title)}](${entry.path}) — ${entry.key}`),
    "",
    "Titles are discovery hints, not evidence. Read a diary with senera diary read YYYY-MM-DD or YYYY-MM; use senera diary list YYYY-MM to explore an older month.",
  ].join("\n");
}

function readOptional(file: string): string | undefined {
  try {
    if (fs.lstatSync(file).isSymbolicLink()) throw new Error(`Diary files may not be symbolic links: ${file}`);
    return fs.readFileSync(file, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) return undefined;
    throw error;
  }
}
function escapeLinkText(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("[", "\\[").replaceAll("]", "\\]");
}
