"use strict";

const path = require("node:path");
const ts = require("typescript");
const { splitLines } = require("./TextFile.js");
const { toWorkspacePath } = require("./Context.js");

function analyzeFile(context, config, filePath, text) {
  const relativePath = toWorkspacePath(context, filePath);
  const lines = splitLines(text);
  const analyzer = selectAnalyzer(config, filePath);
  const genericChunks = createLineWindowChunks(config, relativePath, lines, analyzer.name);

  if (analyzer.strategy === "typescript_ast") {
    const ast = analyzeTypeScript(context, analyzer, filePath, relativePath, text, lines);
    const chunks = config.chunking.strategy === "syntax_and_window"
      ? mergeChunks([...ast.chunks, ...genericChunks])
      : ast.chunks.length > 0
        ? ast.chunks
        : genericChunks;
    return {
      language: analyzer.name,
      analyzer: analyzer.strategy,
      chunks,
      symbols: ast.symbols
    };
  }

  return {
    language: analyzer.name,
    analyzer: analyzer.strategy,
    chunks: genericChunks,
    symbols: []
  };
}

function selectAnalyzer(config, filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const exact = config.analyzers.find((analyzer) =>
    analyzer.extensions.some((item) => item.toLowerCase() === extension));
  if (exact) {
    return exact;
  }
  const wildcard = config.analyzers.find((analyzer) => analyzer.extensions.includes("*"));
  if (!wildcard) {
    throw new Error(`没有可处理扩展名 ${extension || "(none)"} 的分析器。`);
  }
  return wildcard;
}

function analyzeTypeScript(context, analyzer, filePath, relativePath, text, lines) {
  const sourceFile = ts.createSourceFile(
    filePath,
    text,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFromPath(filePath)
  );
  const imports = collectImports(sourceFile);
  const symbols = [];
  const chunks = [];

  function visit(node) {
    const symbol = shouldCollectSymbol(sourceFile, analyzer, node)
      ? symbolFromNode(sourceFile, analyzer, relativePath, node, imports)
      : undefined;
    if (symbol) {
      symbols.push(symbol);
      chunks.push(chunkFromRange(relativePath, lines, symbol.startLine, symbol.endLine, analyzer.name, symbol.name));
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return {
    chunks: mergeChunks(chunks),
    symbols
  };
}

function shouldCollectSymbol(sourceFile, analyzer, node) {
  if (analyzer.symbolScope !== "top_level_and_members") {
    return true;
  }
  return node.parent === sourceFile || ts.isClassLike(node.parent);
}

function scriptKindFromPath(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".tsx") {
    return ts.ScriptKind.TSX;
  }
  if (extension === ".jsx") {
    return ts.ScriptKind.JSX;
  }
  if (extension === ".js" || extension === ".mjs" || extension === ".cjs") {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}

function symbolFromNode(sourceFile, analyzer, relativePath, node, imports) {
  const declaration = readDeclaration(sourceFile, analyzer, node);
  if (!declaration) {
    return undefined;
  }

  const startLine = lineNumber(sourceFile, node.getStart(sourceFile));
  const endLine = Math.max(startLine, lineNumber(sourceFile, node.getEnd()));
  return {
    id: `${relativePath}:${startLine}:${declaration.name}`,
    name: declaration.name,
    kind: declaration.kind,
    path: relativePath,
    line: startLine,
    startLine,
    endLine,
    signature: firstLine(sourceFile.text.slice(node.getStart(sourceFile), node.getEnd())),
    exported: isExported(node),
    imports: {
      item: imports
    },
    score: 0
  };
}

function readDeclaration(sourceFile, analyzer, node) {
  if (ts.isFunctionDeclaration(node) && node.name) {
    return {
      name: node.name.text,
      kind: isComponentDeclaration(sourceFile, analyzer, node.name.text, node) ? "component" : "function"
    };
  }
  if (ts.isClassDeclaration(node) && node.name) {
    return {
      name: node.name.text,
      kind: "class"
    };
  }
  if (ts.isInterfaceDeclaration(node)) {
    return {
      name: node.name.text,
      kind: "interface"
    };
  }
  if (ts.isTypeAliasDeclaration(node)) {
    return {
      name: node.name.text,
      kind: "type"
    };
  }
  if (ts.isEnumDeclaration(node)) {
    return {
      name: node.name.text,
      kind: "enum"
    };
  }
  if (ts.isVariableStatement(node)) {
    const [declaration] = node.declarationList.declarations;
    if (declaration && ts.isIdentifier(declaration.name)) {
      return {
        name: declaration.name.text,
        kind: isComponentDeclaration(sourceFile, analyzer, declaration.name.text, declaration.initializer) ? "component" : "const"
      };
    }
  }
  if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) {
    return {
      name: node.name.text,
      kind: "function"
    };
  }
  return undefined;
}

function isComponentDeclaration(sourceFile, analyzer, name, node) {
  if (!node || analyzer.componentNameStyle !== "pascal_case" || !isPascalCaseName(name)) {
    return false;
  }
  return containsJsx(node);
}

function containsJsx(node) {
  let found = false;
  function visit(current) {
    if (found) {
      return;
    }
    if (
      ts.isJsxElement(current)
      || ts.isJsxSelfClosingElement(current)
      || ts.isJsxFragment(current)
      || ts.isJsxOpeningElement(current)
    ) {
      found = true;
      return;
    }
    ts.forEachChild(current, visit);
  }
  visit(node);
  return found;
}

function isPascalCaseName(value) {
  if (!value) {
    return false;
  }
  const first = value[0];
  return first === first.toUpperCase() && first !== first.toLowerCase();
}

function isExported(node) {
  return Boolean(ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Export);
}

function collectImports(sourceFile) {
  const imports = [];
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      imports.push(statement.moduleSpecifier.text);
    }
  }
  return imports;
}

function lineNumber(sourceFile, position) {
  return sourceFile.getLineAndCharacterOfPosition(position).line + 1;
}

function firstLine(value) {
  return String(value).split(/\r?\n/)[0].trim();
}

function createLineWindowChunks(config, relativePath, lines, analyzerName) {
  if (lines.length <= config.chunking.maxLines) {
    return [chunkFromRange(relativePath, lines, 1, lines.length, analyzerName, "file")];
  }

  const chunks = [];
  const step = config.chunking.maxLines - config.chunking.overlapLines;
  for (let startLine = 1; startLine <= lines.length; startLine += step) {
    const endLine = Math.min(lines.length, startLine + config.chunking.maxLines - 1);
    const lineCount = endLine - startLine + 1;
    if (lineCount >= config.chunking.minLines || chunks.length === 0) {
      chunks.push(chunkFromRange(relativePath, lines, startLine, endLine, analyzerName, "window"));
    }
    if (endLine >= lines.length) {
      break;
    }
  }
  return chunks;
}

function chunkFromRange(relativePath, lines, startLine, endLine, analyzerName, label) {
  const text = lines.slice(startLine - 1, endLine).join("\n").trim();
  return {
    id: `${relativePath}:${startLine}:${endLine}:${label}`,
    path: relativePath,
    startLine,
    endLine,
    text,
    analyzer: analyzerName
  };
}

function mergeChunks(chunks) {
  const seen = new Set();
  const result = [];
  for (const chunk of chunks) {
    if (!chunk.text) {
      continue;
    }
    const key = `${chunk.path}:${chunk.startLine}:${chunk.endLine}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(chunk);
    }
  }
  return result.sort((left, right) => left.path.localeCompare(right.path) || left.startLine - right.startLine);
}

module.exports = {
  analyzeFile,
  createLineWindowChunks
};
