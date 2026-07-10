import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  FrontendEventCatalogPath,
  renderFrontendEventCatalogSource,
} from "../Build/FrontendEventCatalogSource.js";

const workspaceRoot = process.cwd();
const IgnoredDirectories = new Set([
  ".git",
  ".sandbox",
  "Dist",
  "Release",
  "build",
  "dist",
  "node_modules",
]);

const generatedEventCatalogPath = path.join(workspaceRoot, ...FrontendEventCatalogPath.split("/"));
assert.equal(
  normalizeLineEndings(fs.readFileSync(generatedEventCatalogPath, "utf8")),
  normalizeLineEndings(renderFrontendEventCatalogSource()),
  `${FrontendEventCatalogPath} is stale. Run npm run generatefrontendevents.`,
);

const backendKinds = parseConstObject(
  path.join(workspaceRoot, "Source", "AgentSystem", "Events", "AgentEventCatalog.ts"),
  "AgentEventKinds",
);
const frontendKinds = parseConstObject(
  generatedEventCatalogPath,
  "EventKinds",
);

assert.deepEqual(
  valuesOnlyIn(frontendKinds, backendKinds),
  [],
  "Frontend EventKinds contains values that are not defined by backend AgentEventKinds.",
);
assert.deepEqual(
  valuesOnlyIn(backendKinds, frontendKinds),
  [],
  "Backend AgentEventKinds contains values that are missing from frontend EventKinds.",
);

const producers = collectBackendEventProducers();
const consumers = collectFrontendEventConsumers();

assert.deepEqual(
  missingIds([...backendKinds.keys()], producers),
  [],
  "Backend AgentEventKinds contains events with no runtime producer.",
);
assert.deepEqual(
  missingIds([...frontendKinds.keys()], consumers),
  [],
  "Frontend EventKinds contains events with no frontend consumer.",
);

assert.deepEqual(
  missingIds([...producers.keys()], consumers),
  [],
  "Backend produces runtime events that frontend never consumes.",
);
assert.deepEqual(
  missingIds([...consumers.keys()], producers),
  [],
  "Frontend consumes runtime events that backend never produces.",
);

const retiredEventRefs = [
  "session.history.snapshot",
  "session.history.entry",
  "prompt.rendered",
  "model.stream.opened",
  "model.stream.aborted",
  "tool.results",
  "tool.results.detail",
  "SessionHistorySnapshot",
  "PromptRendered",
  "ModelStreamOpened",
  "ModelStreamAborted",
  "ToolResultsDetail",
];

assert.deepEqual(
  findRetiredEventReferences(retiredEventRefs),
  [],
  "Retired runtime event names are still referenced.",
);

console.log("Runtime event contract verified.");

function parseConstObject(filePath: string, objectName: string): Map<string, string> {
  const text = fs.readFileSync(filePath, "utf8");
  const marker = `export const ${objectName} = {`;
  const start = text.indexOf(marker);
  assert.notEqual(start, -1, `Missing ${objectName} in ${relativePath(filePath)}.`);

  const bodyStart = text.indexOf("{", start) + 1;
  const bodyEnd = text.indexOf("} as const", bodyStart);
  assert.notEqual(bodyEnd, -1, `Cannot find end of ${objectName} in ${relativePath(filePath)}.`);

  const entries = new Map<string, string>();
  const body = text.slice(bodyStart, bodyEnd);
  for (const match of body.matchAll(/(\w+):\s*"([^"]+)"/g)) {
    entries.set(match[1] ?? "", match[2] ?? "");
  }
  return entries;
}

function collectBackendEventProducers(): Map<string, string[]> {
  const files = [
    ...walk(path.join(workspaceRoot, "Source")),
    ...walk(path.join(workspaceRoot, "Apps")),
  ].filter((filePath) => !isBackendNonProducer(filePath));

  return collectIdentifierReferences(files, /AgentEventKinds\.([A-Z]\w*)/g);
}

function collectFrontendEventConsumers(): Map<string, string[]> {
  const files = walk(path.join(workspaceRoot, "Frontend", "src"))
    .filter((filePath) => !normalizedPath(filePath).endsWith("Frontend/src/api/eventTypes.ts"));

  return collectIdentifierReferences(files, /EventKinds\.([A-Z]\w*)/g);
}

function collectIdentifierReferences(files: string[], pattern: RegExp): Map<string, string[]> {
  const references = new Map<string, string[]>();
  for (const filePath of files) {
    const text = fs.readFileSync(filePath, "utf8");
    for (const match of text.matchAll(pattern)) {
      const identifier = match[1];
      if (!identifier) continue;
      const paths = references.get(identifier) ?? [];
      paths.push(relativePath(filePath));
      references.set(identifier, paths);
    }
  }

  return new Map(
    [...references.entries()].map(([identifier, paths]) => [
      identifier,
      [...new Set(paths)].sort((left, right) => left.localeCompare(right)),
    ]),
  );
}

function valuesOnlyIn(left: Map<string, string>, right: Map<string, string>): string[] {
  const rightValues = new Set(right.values());
  return [...left.entries()]
    .filter(([, value]) => !rightValues.has(value))
    .map(([identifier, value]) => `${identifier}=${value}`)
    .sort((a, b) => a.localeCompare(b));
}

function missingIds(ids: string[], references: Map<string, string[]>): string[] {
  return ids
    .filter((id) => !references.has(id))
    .sort((left, right) => left.localeCompare(right));
}

function findRetiredEventReferences(retiredNames: string[]): string[] {
  const ignoredFiles = new Set([
    "Scripts/VerifyRuntimeEventContract.ts",
  ]);
  const files = [
    ...walk(path.join(workspaceRoot, "Source")),
    ...walk(path.join(workspaceRoot, "Apps")),
    ...walk(path.join(workspaceRoot, "Frontend", "src")),
    ...walk(path.join(workspaceRoot, "Scripts")),
  ];

  const matches: string[] = [];
  for (const filePath of files) {
    const relative = relativePath(filePath);
    if (ignoredFiles.has(relative)) continue;
    const text = fs.readFileSync(filePath, "utf8");
    for (const name of retiredNames) {
      if (text.includes(name)) {
        matches.push(`${relative}: ${name}`);
      }
    }
  }
  return matches.sort((left, right) => left.localeCompare(right));
}

function isBackendNonProducer(filePath: string): boolean {
  const relative = relativePath(filePath);
  return [
    /Source\/AgentSystem\/Events\/AgentEventCatalog\.ts$/,
    /Source\/AgentSystem\/Events\/AgentEvent\.ts$/,
    /Source\/AgentSystem\/Events\/AgentEventRuntime\.ts$/,
    /Source\/AgentSystem\/Events\/AgentRunEventHistoryPolicy\.ts$/,
    /Source\/AgentSystem\/.*EventTypes\.ts$/,
    /Source\/AgentSystem\/Diagnostics\//,
    /Source\/AgentSystem\/TerminalDisplay\//,
  ].some((pattern) => pattern.test(relative));
}

function walk(directory: string): string[] {
  if (!fs.existsSync(directory)) {
    return [];
  }

  const files: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (IgnoredDirectories.has(entry.name)) continue;
      files.push(...walk(entryPath));
      continue;
    }
    if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
      files.push(entryPath);
    }
  }
  return files;
}

function relativePath(filePath: string): string {
  return normalizedPath(path.relative(workspaceRoot, filePath));
}

function normalizedPath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}
