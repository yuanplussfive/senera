import assert from "node:assert/strict";
import path from "node:path";
import fg from "fast-glob";
import ts from "typescript";

const workspaceRoot = process.cwd();
const agentSystemRoot = path.join(workspaceRoot, "Source", "AgentSystem");

const removedCompatibilityBarrels = [
  {
    target: path.join(agentSystemRoot, "Types.ts"),
    label: "deleted AgentSystem Types compatibility barrel",
    guidance: "import from Types/AgentConfigTypes.js, Types/PluginManifestTypes.js, Types/PluginConfigTypes.js, Types/PluginRuntimeTypes.js, or Types/ToolRuntimeTypes.js",
  },
  {
    target: path.join(agentSystemRoot, "Types", "PluginContractTypes.ts"),
    label: "deleted plugin contract compatibility barrel",
    guidance: "import from Types/PluginManifestTypes.js, Types/PluginConfigTypes.js, or Types/PluginRuntimeTypes.js",
  },
].map((policy) => ({
  ...policy,
  target: normalizePath(policy.target),
}));

const files = fg.sync([
  "Source/**/*.ts",
  "Scripts/**/*.ts",
  "Frontend/**/*.ts",
  "Frontend/**/*.tsx",
], {
  cwd: workspaceRoot,
  absolute: true,
  onlyFiles: true,
  ignore: [
    "Frontend/node_modules/**",
  ],
});

const violations = [
  ...files.flatMap((file) => inspectFile(file)),
  ...removedCompatibilityBarrels.flatMap((barrel) => inspectRemovedBarrel(barrel)),
];

assert.deepEqual(
  violations,
  [],
  [
    "Workspace modules must not import deleted AgentSystem type barrels.",
    ...violations,
  ].join("\n"),
);

console.log("Agent type contract boundaries verified.");

function inspectFile(file: string): string[] {
  const sourceText = ts.sys.readFile(file);
  assert.ok(sourceText !== undefined, `Unable to read ${file}`);

  const normalizedFile = normalizePath(file);
  const source = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true);
  const issues: string[] = [];

  source.forEachChild((node) => {
    if (!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) {
      return;
    }
    if (!node.moduleSpecifier || !ts.isStringLiteral(node.moduleSpecifier)) {
      return;
    }

    const specifier = node.moduleSpecifier.text;
    const target = resolveTypeScriptModulePath(file, specifier);
    if (!target) {
      return;
    }

    const policy = removedCompatibilityBarrels.find((entry) => entry.target === target);
    if (!policy) {
      return;
    }

    const location = source.getLineAndCharacterOfPosition(node.moduleSpecifier.getStart(source));
    issues.push([
      `${relativePath(file)}:${location.line + 1}:${location.character + 1}`,
      `must not import ${policy.label}`,
      policy.guidance,
    ].join(" - "));
  });

  return issues;
}

function inspectRemovedBarrel(policy: {
  target: string;
  label: string;
}): string[] {
  return ts.sys.fileExists(policy.target)
    ? [`${relativePath(policy.target)} - ${policy.label} must not exist`]
    : [];
}

function resolveTypeScriptModulePath(importer: string, specifier: string): string | undefined {
  if (!specifier.startsWith(".")) {
    return undefined;
  }

  const resolved = path.resolve(path.dirname(importer), specifier);
  const withTsExtension = resolved.endsWith(".js")
    ? `${resolved.slice(0, -".js".length)}.ts`
    : resolved.endsWith(".ts")
      ? resolved
      : `${resolved}.ts`;

  return normalizePath(withTsExtension);
}

function normalizePath(value: string): string {
  return path.normalize(value);
}

function relativePath(value: string): string {
  return path.relative(workspaceRoot, value).replaceAll(path.sep, "/");
}
