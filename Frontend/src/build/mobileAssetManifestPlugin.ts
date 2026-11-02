import type { OutputBundle, OutputChunk } from "rollup";
import type { Plugin } from "vite";

export const MobileAssetManifestFile = ".vite/mobile-assets.json";

/** Preserve dependency edges before Vite removes standalone CSS chunks. */
export function mobileAssetManifestPlugins(entryNames: readonly string[]): Plugin[] {
  const dependencies = new Map<string, OutputBundle[string]>();
  return [
    {
      name: "senera-mobile-asset-dependencies",
      apply: "build",
      generateBundle: {
        order: "pre",
        handler(_options, bundle) {
          dependencies.clear();
          const visit = (file: string): void => {
            if (dependencies.has(file)) return;
            const output = bundle[file];
            if (!output) throw new Error(`Mobile frontend dependency is missing: ${file}`);
            dependencies.set(file, output);
            if (output.type !== "chunk") return;
            for (const dependency of readChunkDependencies(output)) visit(dependency);
          };
          for (const name of entryNames) {
            const roots = Object.values(bundle).filter((chunk) => chunk.type === "chunk" && chunk.name === name);
            if (roots.length !== 1) throw new Error(`Mobile frontend requires exactly one ${name} module.`);
            visit(roots[0]!.fileName);
          }
        },
      },
    },
    {
      name: "senera-mobile-asset-manifest",
      apply: "build",
      generateBundle: {
        order: "post",
        handler(_options, bundle) {
          const removedStylesheetChunks = new Set<string>();
          const files = [...dependencies].flatMap(([file, output]) => {
            if (bundle[file]) return [file];
            // Vite replaces pure CSS JavaScript chunks with stylesheet preloads.
            if (output.type === "chunk" && output.viteMetadata?.importedCss.size) {
              removedStylesheetChunks.add(file);
              return [];
            }
            throw new Error(`Mobile frontend asset was removed from the bundle: ${file}`);
          });
          // Workers have their own Vite build and arrive as assets, outside the
          // main Rollup import graph. Follow emitted module URLs as well.
          const included = new Set(files);
          for (const file of included) {
            const output = bundle[file]!;
            const code = output.type === "chunk" ? output.code : file.endsWith(".js") ? output.source : undefined;
            if (typeof code !== "string") continue;
            for (const reference of readModuleReferences(this.parse(code))) {
              const url = new URL(reference, `file:///${file}`);
              const target = decodeURIComponent(url.pathname.slice(1));
              if (url.protocol === "file:" && bundle[target]) included.add(target);
            }
          }
          files.splice(0, files.length, ...included);
          verifyDependencies(files, bundle, removedStylesheetChunks);
          this.emitFile({ type: "asset", fileName: MobileAssetManifestFile, source: JSON.stringify(files.sort()) });
        },
      },
    },
  ];
}

function readModuleReferences(ast: unknown): string[] {
  const references: string[] = [];
  const pending: unknown[] = [ast];
  while (pending.length) {
    const value = pending.pop();
    if (!value || typeof value !== "object") continue;
    const node = value as Record<string, unknown>;
    if (node.type === "NewExpression") {
      const callee = node.callee as Record<string, unknown>;
      const args = node.arguments as Record<string, unknown>[];
      const base = args[1];
      const object = base?.object as Record<string, unknown> | undefined;
      const property = base?.property as Record<string, unknown> | undefined;
      if (
        callee.type === "Identifier" &&
        callee.name === "URL" &&
        base?.type === "MemberExpression" &&
        object?.type === "MetaProperty" &&
        property?.name === "url" &&
        typeof args[0]?.value === "string"
      )
        references.push(args[0].value);
      if (
        callee.type === "Identifier" &&
        (callee.name === "Worker" || callee.name === "SharedWorker") &&
        typeof args[0]?.value === "string"
      )
        references.push(args[0].value);
    }
    if (
      ["ImportDeclaration", "ExportNamedDeclaration", "ExportAllDeclaration", "ImportExpression"].includes(
        String(node.type),
      )
    ) {
      const source = node.source as Record<string, unknown> | undefined;
      if (typeof source?.value === "string" && source.value.startsWith(".")) references.push(source.value);
    }
    for (const child of Object.values(node)) {
      if (Array.isArray(child)) pending.push(...child);
      else if (child && typeof child === "object") pending.push(child);
    }
  }
  return references;
}

function readChunkDependencies(chunk: OutputChunk): string[] {
  return [
    ...chunk.imports,
    ...chunk.dynamicImports,
    ...chunk.referencedFiles,
    ...(chunk.viteMetadata?.importedCss ?? []),
    ...(chunk.viteMetadata?.importedAssets ?? []),
  ];
}

function verifyDependencies(
  files: readonly string[],
  bundle: OutputBundle,
  removedStylesheetChunks: Set<string>,
): void {
  const included = new Set(files);
  for (const file of files) {
    const chunk = bundle[file]!;
    if (chunk.type !== "chunk") continue;
    for (const dependency of readChunkDependencies(chunk)) {
      if (!included.has(dependency) && !removedStylesheetChunks.has(dependency)) {
        throw new Error(`Mobile frontend dependency is not packaged: ${dependency}`);
      }
    }
  }
}
