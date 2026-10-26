import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build, type Plugin } from "esbuild";
import ts from "typescript";
import { isMainModule } from "../Source/AgentSystem/Core/AgentPath.js";

/**
 * The desktop server runs in an Electron utility process that only needs the
 * compiled server graph. Loading it as ~5000 unbundled modules costs seconds of
 * file-system and module-resolution work before the window can show anything, so
 * the entry is bundled into one file next to it and `DesktopServerHost` forks that.
 */
const workspaceRoot = process.cwd();
const distRoot = path.join(workspaceRoot, "Dist");
const entryPath = path.join(distRoot, "Apps", "Desktop", "DesktopServerProcess.js");
const outputPath = path.join(distRoot, "Apps", "Desktop", "DesktopServerProcess.bundle.mjs");

/**
 * Packages that must stay unbundled. Native artifacts are loaded from their own
 * package directory at runtime, and `jiti` resolves user files dynamically, so
 * inlining either one breaks the path it resolves against.
 */
const ExternalPackages = [
  "electron",
  "better-sqlite3",
  "sqlite-vec",
  "koffi",
  "@koromix/koffi",
  "@node-rs/jieba",
  "@parcel/watcher",
  "@napi-rs/canvas",
  "@lydell/node-pty",
  "node-pty",
  "cpu-features",
  "ssh2",
  "bufferutil",
  "utf-8-validate",
  "sharp",
  "fsevents",
  "@boundaryml/baml",
  "@agent-context/sift",
  "@zavora-ai/computer-use-mcp",
  "@silvia-odwyer/photon-node",
  "jiti",
] as const;

const moduleUrlHelper = "__seneraModuleUrl";
const moduleFileHelper = "__seneraModuleFile";
const moduleDirHelper = "__seneraModuleDir";
const AnchoredTokenPattern = /import\.meta\.(url|dirname|filename)|__dirname|__filename/;

export interface DesktopServerBundleResult {
  readonly bytes: number;
  readonly rewrittenFiles: number;
  readonly rewrittenAnchors: number;
  readonly externalPackages: readonly string[];
  readonly skipped: boolean;
}

/**
 * Bundling moves every module into one file, so `import.meta.url`, `__dirname`
 * and `__filename` would resolve to the bundle instead of the module's own
 * directory. Rewriting them to the original location keeps asset reads,
 * `createRequire` anchors and spawned worker paths working unchanged.
 */
function moduleAnchorPlugin(counters: { files: number; anchors: number }): Plugin {
  return {
    name: "senera-module-anchors",
    setup(build) {
      build.onLoad({ filter: /\.(js|mjs|cjs)$/ }, async (args) => {
        if (!args.path.startsWith(distRoot) && !args.path.includes(`${path.sep}node_modules${path.sep}`)) {
          return undefined;
        }
        const source = await fs.promises.readFile(args.path, "utf8");
        if (!AnchoredTokenPattern.test(source)) return undefined;
        const relativePath = path.relative(path.dirname(outputPath), args.path).split(path.sep).join("/");
        const rewritten = rewriteModuleAnchors(source, args.path, relativePath);
        if (rewritten === undefined) return undefined;
        counters.files += 1;
        counters.anchors += rewritten.anchors;
        return { contents: rewritten.contents, loader: "js" };
      });
    },
  };
}

function rewriteModuleAnchors(
  source: string,
  filePath: string,
  relativePath: string,
): { contents: string; anchors: number } | undefined {
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const argument = JSON.stringify(relativePath);
  const replacements: { start: number; end: number; text: string }[] = [];
  const record = (node: ts.Node, text: string): void => {
    replacements.push({ start: node.getStart(sourceFile), end: node.getEnd(), text });
  };
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node) && ts.isMetaProperty(node.expression)) {
      if (node.name.text === "url") record(node, `${moduleUrlHelper}(${argument})`);
      else if (node.name.text === "filename") record(node, `${moduleFileHelper}(${argument})`);
      else if (node.name.text === "dirname") record(node, `${moduleDirHelper}(${argument})`);
    } else if (
      ts.isIdentifier(node) &&
      (node.text === "__dirname" || node.text === "__filename") &&
      !isPropertyName(node) &&
      !isLocallyDeclared(node)
    ) {
      const helper = node.text === "__dirname" ? moduleDirHelper : moduleFileHelper;
      record(node, `${helper}(${argument})`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (replacements.length === 0) return undefined;

  let contents = source;
  for (const replacement of replacements.sort((left, right) => right.start - left.start)) {
    contents = `${contents.slice(0, replacement.start)}${replacement.text}${contents.slice(replacement.end)}`;
  }
  return { contents, anchors: replacements.length };
}

function isPropertyName(node: ts.Identifier): boolean {
  const parent = node.parent;
  return (
    (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
    (ts.isPropertyAssignment(parent) && parent.name === node) ||
    (ts.isMethodDeclaration(parent) && parent.name === node) ||
    (ts.isPropertyDeclaration(parent) && parent.name === node)
  );
}

/**
 * A module that declares its own `__dirname`/`__filename` in an enclosing scope
 * owns those references; only the free CommonJS variables are rewritten.
 */
function isLocallyDeclared(node: ts.Identifier): boolean {
  const name = node.text;
  for (let current: ts.Node | undefined = node.parent; current; current = current.parent) {
    if (!ts.isSourceFile(current) && !ts.isBlock(current) && !ts.isModuleBlock(current)) continue;
    for (const statement of current.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.name.text === name) return true;
      }
    }
    if (ts.isSourceFile(current)) break;
  }
  return false;
}

const banner = [
  "import { createRequire as __seneraCreateRequire } from 'node:module';",
  "import __seneraPath from 'node:path';",
  "import { fileURLToPath as __seneraFileURLToPath, pathToFileURL as __seneraPathToFileURL } from 'node:url';",
  "const __seneraBundleDirectory = __seneraPath.dirname(__seneraFileURLToPath(import.meta.url));",
  `const ${moduleUrlHelper} = (relativePath) => __seneraPathToFileURL(__seneraPath.resolve(__seneraBundleDirectory, relativePath)).href;`,
  `const ${moduleFileHelper} = (relativePath) => __seneraPath.resolve(__seneraBundleDirectory, relativePath);`,
  `const ${moduleDirHelper} = (relativePath) => __seneraPath.dirname(${moduleFileHelper}(relativePath));`,
  "const require = __seneraCreateRequire(import.meta.url);",
].join("\n");

export async function bundleDesktopServer(): Promise<DesktopServerBundleResult> {
  if (isDesktopServerBundleCurrent()) {
    return {
      bytes: fs.statSync(outputPath).size,
      rewrittenFiles: 0,
      rewrittenAnchors: 0,
      externalPackages: ExternalPackages,
      skipped: true,
    };
  }
  const counters = { files: 0, anchors: 0 };
  await build({
    entryPoints: [entryPath],
    outfile: outputPath,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    logLevel: "silent",
    external: [...ExternalPackages],
    banner: { js: banner },
    plugins: [moduleAnchorPlugin(counters)],
  });
  return {
    bytes: fs.statSync(outputPath).size,
    rewrittenFiles: counters.files,
    rewrittenAnchors: counters.anchors,
    externalPackages: ExternalPackages,
    skipped: false,
  };
}

/**
 * `npm run desktop.live` re-runs the asset step on every launch, and bundling
 * costs seconds, so the bundle is only rebuilt when a compiled module changed.
 */
function isDesktopServerBundleCurrent(): boolean {
  const bundle = fs.statSync(outputPath, { throwIfNoEntry: false });
  if (!bundle) return false;
  const bundlerChangedAt = fs.statSync(fileURLToPath(import.meta.url)).mtimeMs;
  return newestCompiledModuleChangeMs() <= bundle.mtimeMs && bundlerChangedAt <= bundle.mtimeMs;
}

function newestCompiledModuleChangeMs(): number {
  let newest = 0;
  // The server graph only reaches `Apps` and `Source`; other compiled trees
  // cannot change the bundle and must not trigger a rebuild on every launch.
  const pending = [path.join(distRoot, "Apps"), path.join(distRoot, "Source")];
  while (pending.length > 0) {
    const directory = pending.pop();
    if (directory === undefined) break;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        pending.push(entryPath);
        continue;
      }
      if (entryPath === outputPath || !entry.name.endsWith(".js")) continue;
      const stat = fs.statSync(entryPath);
      if (stat.mtimeMs > newest) newest = stat.mtimeMs;
    }
  }
  return newest;
}

if (isMainModule(import.meta.url)) {
  const result = await bundleDesktopServer();
  process.stdout.write(
    result.skipped
      ? `Desktop server bundle up to date: ${result.bytes} bytes\n`
      : `Desktop server bundle: ${result.bytes} bytes, anchors rewritten in ${result.rewrittenFiles} files\n`,
  );
}
