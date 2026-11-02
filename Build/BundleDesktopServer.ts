import fs from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { build, type Plugin } from "esbuild";
import { init, parse as parseModule } from "es-module-lexer";
import ts from "typescript";
import { isMainModule, isPathWithin } from "../Source/AgentSystem/Core/AgentPath.js";

/**
 * The desktop server runs in an Electron utility process that only needs the
 * application graph. Dependencies retain their package boundaries so native
 * loaders, workers and dynamic package resolution keep their original behavior.
 */
const workspaceRoot = process.cwd();
const distRoot = path.join(workspaceRoot, "Dist");
const entryPath = path.join(distRoot, "Apps", "Desktop", "DesktopServerProcess.js");
const outputPath = path.join(distRoot, "Apps", "Desktop", "DesktopServerProcess.bundle.mjs");
const manifestPath = `${outputPath}.inputs.json`;

const moduleUrlHelper = "__seneraModuleUrl";
const moduleFileHelper = "__seneraModuleFile";
const moduleDirHelper = "__seneraModuleDir";
const AnchoredTokenPattern = /import\.meta\.(url|dirname|filename)/;

export interface DesktopServerBundleResult {
  readonly bytes: number;
  readonly rewrittenFiles: number;
  readonly rewrittenAnchors: number;
  readonly skipped: boolean;
}

/**
 * Bundling moves application modules into one file, so `import.meta` anchors
 * would resolve to the bundle instead of the module's own
 * directory. Rewriting them to the original location keeps asset reads,
 * `createRequire` anchors and spawned worker paths working unchanged.
 */
function moduleAnchorPlugin(counters: { files: number; anchors: number }): Plugin {
  return {
    name: "senera-module-anchors",
    setup(build) {
      build.onLoad({ filter: /\.(js|mjs|cjs)$/ }, async (args) => {
        if (!isPathWithin(distRoot, args.path)) return undefined;
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

export function rewriteModuleAnchors(
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
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isMetaProperty(node.expression) &&
      node.expression.keywordToken === ts.SyntaxKind.ImportKeyword
    ) {
      if (node.name.text === "url") record(node, `${moduleUrlHelper}(${argument})`);
      else if (node.name.text === "filename") record(node, `${moduleFileHelper}(${argument})`);
      else if (node.name.text === "dirname") record(node, `${moduleDirHelper}(${argument})`);
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
    await verifyDesktopServerRuntimeDependencies();
    return {
      bytes: fs.statSync(outputPath).size,
      rewrittenFiles: 0,
      rewrittenAnchors: 0,
      skipped: true,
    };
  }
  const counters = { files: 0, anchors: 0 };
  const result = await build({
    entryPoints: [entryPath],
    outfile: outputPath,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    logLevel: "silent",
    packages: "external",
    metafile: true,
    banner: { js: banner },
    plugins: [moduleAnchorPlugin(counters)],
  });
  const inputs = Object.keys(result.metafile.inputs);
  fs.writeFileSync(manifestPath, JSON.stringify({ inputs, digest: inputDigest(inputs) }));
  await verifyDesktopServerRuntimeDependencies();
  return {
    bytes: fs.statSync(outputPath).size,
    rewrittenFiles: counters.files,
    rewrittenAnchors: counters.anchors,
    skipped: false,
  };
}

/**
 * `packages: "external"` keeps third-party modules outside the server bundle. Every
 * resulting bare import must be a production dependency; otherwise a repository-level
 * `node_modules` directory can conceal a missing package until the desktop app is installed.
 */
async function verifyDesktopServerRuntimeDependencies(): Promise<void> {
  await init;
  const source = fs.readFileSync(outputPath, "utf8");
  const [imports] = parseModule(source);
  const importedPackages = new Set<string>();
  for (const entry of imports) {
    const packageName = packageNameFromSpecifier(entry.n);
    if (packageName) importedPackages.add(packageName);
  }

  const manifest = readPackageManifest();
  const missing = [...importedPackages]
    .filter((packageName) => !(packageName in manifest.dependencies))
    .sort((left, right) => left.localeCompare(right));
  if (missing.length > 0) {
    throw new Error(
      `Desktop server bundle imports packages that are not production dependencies: ${missing.join(", ")}. ` +
        "Move each package from devDependencies to dependencies before packaging.",
    );
  }
}

function packageNameFromSpecifier(specifier: string | null | undefined): string | undefined {
  if (
    !specifier ||
    specifier.startsWith(".") ||
    specifier.startsWith("/") ||
    specifier.startsWith("#") ||
    specifier.includes(":")
  ) {
    return undefined;
  }
  const segments = specifier.split("/");
  return specifier.startsWith("@") ? (segments.length >= 2 ? `${segments[0]}/${segments[1]}` : undefined) : segments[0];
}

function readPackageManifest(): { readonly dependencies: Record<string, unknown> } {
  const filePath = path.join(workspaceRoot, "package.json");
  const parsed: unknown = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!isRecord(parsed) || !isRecord(parsed.dependencies)) {
    throw new Error(`Package manifest does not define a dependency record: ${filePath}`);
  }
  return { dependencies: parsed.dependencies };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * `npm run desktop.live` re-runs the asset step on every launch, and bundling
 * costs seconds, so the bundle is only rebuilt when a compiled module changed.
 */
export function isDesktopServerBundleCurrent(): boolean {
  if (!fs.existsSync(outputPath) || !fs.existsSync(manifestPath)) return false;
  const manifest: unknown = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (typeof manifest !== "object" || manifest === null || !("inputs" in manifest) || !("digest" in manifest))
    return false;
  const { inputs, digest } = manifest;
  if (!Array.isArray(inputs) || !inputs.every((input): input is string => typeof input === "string")) return false;
  return digest === inputDigest(inputs);
}

function inputDigest(inputs: readonly string[]): string | undefined {
  const hash = createHash("sha256");
  // The build runs through tsx; verification runs from Dist. Both must hash the
  // same authoritative build source rather than their different import URLs.
  for (const input of [...inputs, "Build/BundleDesktopServer.ts", "package-lock.json", "tsconfig.json"].sort()) {
    const filePath = path.resolve(workspaceRoot, input);
    if (!fs.existsSync(filePath)) return undefined;
    hash.update(input).update("\0").update(fs.readFileSync(filePath)).update("\0");
  }
  return hash.digest("hex");
}

if (isMainModule(import.meta.url)) {
  const result = await bundleDesktopServer();
  process.stdout.write(
    result.skipped
      ? `Desktop server bundle up to date: ${result.bytes} bytes\n`
      : `Desktop server bundle: ${result.bytes} bytes, anchors rewritten in ${result.rewrittenFiles} files\n`,
  );
}
