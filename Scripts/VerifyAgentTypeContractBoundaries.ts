import assert from "node:assert/strict";
import path from "node:path";
import fg from "fast-glob";
import ts from "typescript";
import { toPosixRelative } from "./Support/FileWalk.js";

const workspaceRoot = process.cwd();
const agentSystemRoot = path.join(workspaceRoot, "Source", "AgentSystem");
const piProxyRoot = path.join(agentSystemRoot, "PiProxy");
const actionPlannerRoot = path.join(agentSystemRoot, "ActionPlanner");
const agentSystemRuntimePath = path.join(agentSystemRoot, "Runtime", "AgentSystemRuntime.ts");

const removedCompatibilityBarrels = [
  {
    target: path.join(agentSystemRoot, "Types.ts"),
    label: "deleted AgentSystem Types compatibility barrel",
    guidance:
      "import from Types/AgentConfigTypes.js, Types/PluginManifestTypes.js, Types/PluginConfigTypes.js, Types/PluginRuntimeTypes.js, or Types/ToolRuntimeTypes.js",
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

const moduleBoundaryFiles = fg.sync(["Source/**/*.ts", "Scripts/**/*.ts", "Frontend/**/*.ts", "Frontend/**/*.tsx"], {
  cwd: workspaceRoot,
  absolute: true,
  onlyFiles: true,
  ignore: ["Frontend/node_modules/**", "Source/AgentSystem/BamlClient/baml_client/**"],
});
const handWrittenAgentSystemFiles = fg.sync(["Source/AgentSystem/**/*.ts"], {
  cwd: workspaceRoot,
  absolute: true,
  onlyFiles: true,
  ignore: ["Source/AgentSystem/BamlClient/baml_client/**"],
});

const violations = [
  ...moduleBoundaryFiles.flatMap((file) => inspectModuleBoundary(file)),
  ...handWrittenAgentSystemFiles.flatMap((file) => inspectExplicitAny(file)),
  ...removedCompatibilityBarrels.flatMap((barrel) => inspectRemovedBarrel(barrel)),
  ...inspectRuntimeCompositionEntryPoint(),
];

assert.deepEqual(violations, [], ["Agent type contract boundary verification failed.", ...violations].join("\n"));

console.log("Agent type contract boundaries verified.");

function inspectModuleBoundary(file: string): string[] {
  const sourceText = ts.sys.readFile(file);
  assert.ok(sourceText !== undefined, `Unable to read ${file}`);

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

    if (isInsideDirectory(piProxyRoot, file) && isInsideDirectory(actionPlannerRoot, target)) {
      const location = source.getLineAndCharacterOfPosition(node.moduleSpecifier.getStart(source));
      issues.push(
        [
          `${toPosixRelative(workspaceRoot, file)}:${location.line + 1}:${location.character + 1}`,
          "PiProxy must not import ActionPlanner",
          "depend on a PiProxy port or a neutral contract and wire the implementation in Runtime.",
        ].join(" - "),
      );
    }

    const policy = removedCompatibilityBarrels.find((entry) => entry.target === target);
    if (!policy) {
      return;
    }

    const location = source.getLineAndCharacterOfPosition(node.moduleSpecifier.getStart(source));
    issues.push(
      [
        `${toPosixRelative(workspaceRoot, file)}:${location.line + 1}:${location.character + 1}`,
        `must not import ${policy.label}`,
        policy.guidance,
      ].join(" - "),
    );
  });

  return issues;
}

function inspectExplicitAny(file: string): string[] {
  const sourceText = ts.sys.readFile(file);
  assert.ok(sourceText !== undefined, `Unable to read ${file}`);

  const source = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true);
  const issues: string[] = [];

  inspectNode(source);
  return issues;

  function inspectNode(root: ts.Node): void {
    root.forEachChild((node) => {
      if (node.kind === ts.SyntaxKind.AnyKeyword) {
        const location = source.getLineAndCharacterOfPosition(node.getStart(source));
        issues.push(
          [
            `${toPosixRelative(workspaceRoot, file)}:${location.line + 1}:${location.character + 1}`,
            "must not use explicit any",
            "use unknown, a concrete generic bound, or a typed boundary adapter.",
          ].join(" - "),
        );
      }
      inspectNode(node);
    });
  }
}

function inspectRemovedBarrel(policy: { target: string; label: string }): string[] {
  return ts.sys.fileExists(policy.target)
    ? [`${toPosixRelative(workspaceRoot, policy.target)} - ${policy.label} must not exist`]
    : [];
}

function inspectRuntimeCompositionEntryPoint(): string[] {
  const sourceText = ts.sys.readFile(agentSystemRuntimePath);
  assert.ok(sourceText !== undefined, `Unable to read ${agentSystemRuntimePath}`);
  const source = ts.createSourceFile(agentSystemRuntimePath, sourceText, ts.ScriptTarget.Latest, true);
  const runtimeClass = source.statements.find(
    (node): node is ts.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === "AgentSystemRuntime",
  );
  if (!runtimeClass) {
    return ["Source/AgentSystem/Runtime/AgentSystemRuntime.ts must declare AgentSystemRuntime."];
  }

  const constructors = runtimeClass.members.filter(ts.isConstructorDeclaration);
  if (constructors.length !== 1) {
    return ["AgentSystemRuntime must have one composition constructor."];
  }

  const parameters = constructors[0].parameters;
  const type = parameters[0]?.type;
  const usesCompositionOptions =
    parameters.length === 1 &&
    type !== undefined &&
    ts.isTypeReferenceNode(type) &&
    ts.isIdentifier(type.typeName) &&
    type.typeName.text === "AgentSystemRuntimeCompositionOptions";

  return usesCompositionOptions
    ? []
    : [
        [
          "AgentSystemRuntime constructor must accept only AgentSystemRuntimeCompositionOptions.",
          "Add dependencies to the typed composition options and assemble them in AgentSystemRuntimeComposition.",
        ].join(" "),
      ];
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

function isInsideDirectory(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}
