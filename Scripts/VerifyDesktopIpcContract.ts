import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

/**
 * The desktop IPC surface is written down four times: the channels the main process
 * handles or sends (`Apps/Desktop/Main.ts`), the methods the preload script exposes
 * (`Apps/Desktop/Preload.ts`), the bridge the frontend compiles against
 * (`Frontend/src/app/desktopBridge.ts`), and the fake main the desktop E2E journey
 * runs against (`Scripts/BrowserE2ETests/DesktopJourney/electronDesktopHarness.cjs`).
 * All four are hand-written, every `SeneraDesktopBridge` method is optional, and
 * `ipcRenderer.invoke` returns `any`, so TypeScript cannot notice a channel that
 * exists on only one side. This check compares the surfaces instead, and fails when
 * a channel is renamed, added, or dropped on one side only.
 */
const workspaceRoot = process.cwd();
const SurfaceSources = {
  main: "Apps/Desktop/Main.ts",
  preload: "Apps/Desktop/Preload.ts",
  bridge: "Frontend/src/app/desktopBridge.ts",
  harness: "Scripts/BrowserE2ETests/DesktopJourney/electronDesktopHarness.cjs",
} as const;
const BridgeInterfaceName = "seneraDesktop";
const BridgeInterfaceDeclaration = "SeneraDesktopBridge";

type SurfaceName = keyof typeof SurfaceSources;

const surfaces = new Map<SurfaceName, ts.SourceFile>();
for (const [name, relativePath] of Object.entries(SurfaceSources) as [SurfaceName, string][]) {
  const absolutePath = path.join(workspaceRoot, relativePath);
  assert.ok(fs.existsSync(absolutePath), `Desktop IPC contract source is missing: ${relativePath}`);
  surfaces.set(
    name,
    ts.createSourceFile(
      absolutePath,
      fs.readFileSync(absolutePath, "utf8"),
      ts.ScriptTarget.ES2022,
      true,
      relativePath.endsWith(".cjs") ? ts.ScriptKind.JS : ts.ScriptKind.TS,
    ),
  );
}

/** Channel name → `file:line` of its first reference, so failures point at a line. */
type ChannelReferences = Map<string, string>;
type ChannelKind = "handled" | "sent" | "invoked" | "listened";

interface ChannelRule {
  readonly surface: SurfaceName;
  readonly kind: ChannelKind;
  readonly matches: (receiver: string, method: string) => boolean;
}

const ChannelRules: readonly ChannelRule[] = [
  { surface: "main", kind: "handled", matches: (receiver, method) => receiver === "ipcMain" && method === "handle" },
  {
    surface: "main",
    kind: "sent",
    matches: (receiver, method) => /(^|\.)webContents\??$/u.test(receiver) && method === "send",
  },
  {
    surface: "preload",
    kind: "invoked",
    matches: (receiver, method) => receiver === "ipcRenderer" && method === "invoke",
  },
  {
    surface: "preload",
    kind: "listened",
    matches: (receiver, method) => receiver === "ipcRenderer" && (method === "on" || method === "removeListener"),
  },
  { surface: "harness", kind: "handled", matches: (receiver, method) => receiver === "ipcMain" && method === "handle" },
];

const channels = new Map<string, ChannelReferences>();
const violations: string[] = [];

for (const rule of ChannelRules) {
  const source = surfaces.get(rule.surface);
  assert.ok(source, `Desktop IPC contract surface is missing: ${rule.surface}`);
  const references = channels.get(channelKey(rule.surface, rule.kind)) ?? new Map<string, string>();
  channels.set(channelKey(rule.surface, rule.kind), references);
  for (const call of readChannelCalls(source, rule.matches)) {
    if (call.channel === undefined) {
      violations.push(`${call.location}: IPC channel must be a string literal.`);
      continue;
    }
    if (!references.has(call.channel)) references.set(call.channel, call.location);
  }
}

assert.deepEqual(violations, [], violations.join("\n"));

const preloadExposed = readBridgeMembers(surfaces.get("preload")!, "preload exposed keys");
const bridgeDeclared = readBridgeMembers(surfaces.get("bridge")!, "frontend bridge members");

assertChannelSetsMatch(
  read("main", "handled"),
  read("preload", "invoked"),
  "Channels the main process handles and channels the preload invokes must match exactly.",
);
assertChannelSetsMatch(
  read("main", "sent"),
  read("preload", "listened"),
  "Channels the main process sends and channels the preload listens to must match exactly.",
);
assertChannelSetsMatch(
  read("main", "handled"),
  read("harness", "handled"),
  "The desktop E2E fake main must handle exactly the channels the real main handles.",
);
assertSetEqual(
  [...preloadExposed.keys()].sort(),
  [...bridgeDeclared.keys()].sort(),
  `The preload script and the ${BridgeInterfaceDeclaration} interface must declare the same members.`,
);

console.log(
  `Desktop IPC contract verification passed (${read("main", "handled").size} handled, ${read("main", "sent").size} sent, ${preloadExposed.size} bridge members).`,
);

function channelKey(surface: SurfaceName, kind: ChannelKind): string {
  return `${surface}:${kind}`;
}

function read(surface: SurfaceName, kind: ChannelKind): ChannelReferences {
  const references = channels.get(channelKey(surface, kind));
  assert.ok(references, `Desktop IPC contract did not read ${surface}:${kind}.`);
  return references;
}

function assertChannelSetsMatch(expected: ChannelReferences, actual: ChannelReferences, description: string): void {
  assertSetEqual(
    [...expected.keys()].sort(),
    [...actual.keys()].sort(),
    description,
    (channel) => `${channel} (${expected.get(channel) ?? actual.get(channel)})`,
  );
}

function assertSetEqual(
  expected: readonly string[],
  actual: readonly string[],
  description: string,
  describe: (value: string) => string = (value) => value,
): void {
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  const missing = [...expectedSet].filter((value) => !actualSet.has(value)).map(describe);
  const extra = [...actualSet].filter((value) => !expectedSet.has(value)).map(describe);
  assert.deepEqual(
    { missing, extra },
    { missing: [], extra: [] },
    `${description} missing=[${missing.join(", ")}] extra=[${extra.join(", ")}]`,
  );
}

interface ChannelCall {
  readonly channel: string | undefined;
  readonly location: string;
}

function readChannelCalls(source: ts.SourceFile, matches: ChannelRule["matches"]): ChannelCall[] {
  const calls: ChannelCall[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = readChannelCallee(node.expression, source);
      if (callee && matches(callee.receiver, callee.method)) {
        calls.push({
          channel: readStringLiteral(node.arguments[0]),
          location: readLocation(source, node),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return calls;
}

function readChannelCallee(
  expression: ts.Expression,
  source: ts.SourceFile,
): { receiver: string; method: string } | undefined {
  if (!ts.isPropertyAccessExpression(expression)) return undefined;
  const receiver = expression.expression.getText(source).replace(/\s+/gu, "");
  return { receiver, method: expression.name.text };
}

function readStringLiteral(node: ts.Expression | undefined): string | undefined {
  if (!node) return undefined;
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : undefined;
}

function readLocation(source: ts.SourceFile, node: ts.Node): string {
  const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
  return `${path.relative(workspaceRoot, source.fileName)}:${line + 1}`;
}

/**
 * The preload surface is the object handed to `contextBridge.exposeInMainWorld`; the
 * frontend surface is the `SeneraDesktopBridge` interface it is asserted against.
 * Both are read from source so a rename on either side fails here instead of at runtime.
 */
function readBridgeMembers(source: ts.SourceFile, description: string): ChannelReferences {
  const members: ChannelReferences = new Map<string, string>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.getText(source).replace(/\s+/gu, "") === "contextBridge.exposeInMainWorld" &&
      readStringLiteral(node.arguments[0]) === BridgeInterfaceName
    ) {
      const exposed = node.arguments[1];
      assert.ok(
        exposed && ts.isObjectLiteralExpression(exposed),
        `${description}: exposeInMainWorld must take an object literal.`,
      );
      for (const property of exposed.properties) {
        assert.ok(
          ts.isPropertyAssignment(property) && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)),
          `${description}: every exposed member must be a plain property (${readLocation(source, property)}).`,
        );
        members.set(property.name.getText(source).replace(/^"|"$/gu, ""), readLocation(source, property));
      }
    }
    if (ts.isInterfaceDeclaration(node) && node.name.text === BridgeInterfaceDeclaration) {
      for (const member of node.members) {
        assert.ok(ts.isPropertySignature(member) && member.name, `${description}: bridge members must be properties.`);
        members.set(member.name.getText(source).replace(/^"|"$/gu, ""), readLocation(source, member));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(members.size > 0, `${description}: no bridge members were read from ${source.fileName}.`);
  return members;
}
