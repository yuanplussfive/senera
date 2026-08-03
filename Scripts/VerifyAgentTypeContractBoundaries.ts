import assert from "node:assert/strict";
import path from "node:path";
import fg from "fast-glob";
import ts from "typescript";
import { toPosixRelative } from "./Support/FileWalk.js";
import { isSeneraProtocolType } from "../Source/AgentSystem/Core/AgentProtocolIdentity.js";

const workspaceRoot = process.cwd();
const agentSystemRoot = path.join(workspaceRoot, "Source", "AgentSystem");
const piRoot = path.join(agentSystemRoot, "Pi");
const piProxyRoot = path.join(agentSystemRoot, "PiProxy");
const actionPlannerRoot = path.join(agentSystemRoot, "ActionPlanner");
const agentSystemRuntimePath = path.join(agentSystemRoot, "Runtime", "AgentSystemRuntime.ts");

const removedCompatibilityBarrels = [
  {
    target: path.join(agentSystemRoot, "Types.ts"),
    label: "deleted AgentSystem Types compatibility barrel",
    guidance: "import from the owning AgentConfig, AgentToolContract, AgentToolRuntime, or ToolRuntime type module",
  },
  {
    target: path.join(agentSystemRoot, "Types", "PluginContractTypes.ts"),
    label: "deleted extension contract compatibility barrel",
    guidance: "import from Types/AgentToolContractTypes.js or Types/AgentToolRuntimeTypes.js",
  },
].map((policy) => ({
  ...policy,
  target: normalizePath(policy.target),
}));

const moduleBoundaryPolicies = [
  {
    sourceRoot: piRoot,
    forbiddenRoot: piProxyRoot,
    label: "Pi must not import PiProxy",
    guidance: "move shared protocol contracts to PiShared and wire adapters in Runtime.",
  },
  {
    sourceRoot: actionPlannerRoot,
    forbiddenRoot: piProxyRoot,
    label: "ActionPlanner must not import PiProxy",
    guidance: "depend on an ActionPlanner-owned port or a neutral shared contract.",
  },
  {
    sourceRoot: piProxyRoot,
    forbiddenRoot: piRoot,
    label: "PiProxy must not import Pi",
    guidance: "move shared protocol contracts to PiShared and wire implementations in Runtime.",
  },
  {
    sourceRoot: piProxyRoot,
    forbiddenRoot: actionPlannerRoot,
    label: "PiProxy must not import ActionPlanner",
    guidance: "depend on a PiProxy port or a neutral contract and wire the implementation in Runtime.",
  },
] as const;

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
const productionProtocolFiles = fg.sync(
  ["Source/**/*.ts", "Apps/**/*.ts", "Frontend/src/**/*.ts", "Frontend/src/**/*.tsx"],
  {
    cwd: workspaceRoot,
    absolute: true,
    onlyFiles: true,
    ignore: ["Source/AgentSystem/BamlClient/baml_client/**"],
  },
);

const violations = [
  ...moduleBoundaryFiles.flatMap((file) => inspectModuleBoundary(file)),
  ...handWrittenAgentSystemFiles.flatMap((file) => inspectExplicitAny(file)),
  ...productionProtocolFiles.flatMap((file) => inspectVersionedSeneraProtocolLiterals(file)),
  ...removedCompatibilityBarrels.flatMap((barrel) => inspectRemovedBarrel(barrel)),
  ...inspectRuntimeCompositionEntryPoint(),
  ...inspectRuntimeDependencyCycles(),
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

    for (const boundary of moduleBoundaryPolicies) {
      if (!isInsideDirectory(boundary.sourceRoot, file) || !isInsideDirectory(boundary.forbiddenRoot, target)) {
        continue;
      }
      const location = source.getLineAndCharacterOfPosition(node.moduleSpecifier.getStart(source));
      issues.push(
        [
          `${toPosixRelative(workspaceRoot, file)}:${location.line + 1}:${location.character + 1}`,
          boundary.label,
          boundary.guidance,
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

function inspectRuntimeDependencyCycles(): string[] {
  const files = handWrittenAgentSystemFiles.map(normalizePath).sort();
  const fileSet = new Set(files);
  const dependencies = new Map(files.map((file) => [file, runtimeDependencies(file, fileSet)]));
  const states = new Map<string, "visiting" | "visited">();
  const stack: string[] = [];
  const stackIndexes = new Map<string, number>();

  for (const file of files) {
    if (states.has(file)) continue;
    const cycle = visit(file);
    if (cycle) {
      return [
        `Runtime dependency cycle detected: ${cycle
          .map((entry) => toPosixRelative(workspaceRoot, entry))
          .join(" -> ")}`,
      ];
    }
  }
  return [];

  function visit(file: string): string[] | undefined {
    states.set(file, "visiting");
    stackIndexes.set(file, stack.length);
    stack.push(file);

    for (const dependency of dependencies.get(file) ?? []) {
      const state = states.get(dependency);
      if (state === "visiting") {
        const cycleStart = stackIndexes.get(dependency);
        assert.ok(cycleStart !== undefined);
        return [...stack.slice(cycleStart), dependency];
      }
      if (state === "visited") continue;
      const cycle = visit(dependency);
      if (cycle) return cycle;
    }

    stack.pop();
    stackIndexes.delete(file);
    states.set(file, "visited");
    return undefined;
  }
}

function runtimeDependencies(file: string, fileSet: ReadonlySet<string>): string[] {
  const sourceText = ts.sys.readFile(file);
  assert.ok(sourceText !== undefined, `Unable to read ${file}`);
  const source = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true);
  const dependencies = new Set<string>();

  source.forEachChild((node) => {
    if (!isRuntimeModuleReference(node) || !node.moduleSpecifier || !ts.isStringLiteral(node.moduleSpecifier)) {
      return;
    }
    const target = resolveTypeScriptModulePath(file, node.moduleSpecifier.text);
    if (target && fileSet.has(target)) dependencies.add(target);
  });
  return [...dependencies].sort();
}

function isRuntimeModuleReference(node: ts.Node): node is ts.ImportDeclaration | ts.ExportDeclaration {
  if (ts.isImportDeclaration(node)) {
    const clause = node.importClause;
    if (!clause) return true;
    if (clause.isTypeOnly) return false;
    if (clause.name || !clause.namedBindings || ts.isNamespaceImport(clause.namedBindings)) return true;
    return (
      clause.namedBindings.elements.length === 0 || clause.namedBindings.elements.some((entry) => !entry.isTypeOnly)
    );
  }
  if (!ts.isExportDeclaration(node)) return false;
  if (node.isTypeOnly) return false;
  if (!node.exportClause || ts.isNamespaceExport(node.exportClause)) return true;
  return node.exportClause.elements.length === 0 || node.exportClause.elements.some((entry) => !entry.isTypeOnly);
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

function inspectVersionedSeneraProtocolLiterals(file: string): string[] {
  const sourceText = ts.sys.readFile(file);
  assert.ok(sourceText !== undefined, `Unable to read ${file}`);

  const source = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true);
  const issues: string[] = [];
  inspectNode(source);
  return issues;

  function inspectNode(root: ts.Node): void {
    root.forEachChild((node) => {
      if (ts.isStringLiteralLike(node) && isSeneraProtocolType(node.text)) {
        const location = source.getLineAndCharacterOfPosition(node.getStart(source));
        issues.push(
          [
            `${toPosixRelative(workspaceRoot, file)}:${location.line + 1}:${location.character + 1}`,
            "must not declare a versioned Senera protocol as a raw string",
            "declare it with defineSeneraProtocol in the owning contract module.",
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
