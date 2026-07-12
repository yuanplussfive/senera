import ts from "typescript";
import type { ContractProjectionNode, ResolvedTypeShape } from "./AgentPromptContractTypes.js";

export class AgentPromptContractAstReader {
  constructor(
    private readonly options: {
      arrayItemName: string;
    },
  ) {}

  readRootTypeDeclaration(sourceFile: ts.SourceFile, typeName?: string): ts.TypeAliasDeclaration {
    const declarations = sourceFile.statements.filter(ts.isTypeAliasDeclaration);
    const declaration = typeName
      ? declarations.find((item) => item.name.text === typeName)
      : this.selectDefaultTypeDeclaration(declarations, sourceFile);
    if (!declaration) {
      throw new Error(
        typeName
          ? `签名文件缺少 type alias ${typeName}：${sourceFile.fileName}`
          : `签名文件缺少可自动选择的 Arguments type alias：${sourceFile.fileName}`,
      );
    }

    return declaration;
  }

  readProperties(
    typeNode: ts.TypeNode,
    sourceFile: ts.SourceFile,
    parentPath: string,
    depth: number,
  ): ContractProjectionNode[] {
    const shape = this.resolveShape(typeNode);
    if (shape.kind !== "object") {
      return [];
    }

    return shape.members.filter(ts.isPropertySignature).flatMap((member) => {
      const name = readPropertyName(member.name);
      const type = member.type;
      if (!name || !type) {
        return [];
      }

      const comment = readNodeComment(member, sourceFile) ?? "";
      const xmlHint = extractXmlHint(comment) ?? "";
      const propertyPath = joinPath(parentPath, name);
      return [
        this.createNode({
          name,
          path: propertyPath,
          depth: depth + 1,
          required: !member.questionToken,
          typeNode: type,
          typeText: type.getText(sourceFile).trim(),
          comment,
          xmlHint,
          sourceFile,
        }),
      ];
    });
  }

  private selectDefaultTypeDeclaration(
    declarations: readonly ts.TypeAliasDeclaration[],
    sourceFile: ts.SourceFile,
  ): ts.TypeAliasDeclaration | undefined {
    if (declarations.length === 1) {
      return declarations[0];
    }

    const argumentDeclarations = declarations.filter((declaration) => declaration.name.text.endsWith("Arguments"));
    if (argumentDeclarations.length === 1) {
      return argumentDeclarations[0];
    }

    if (argumentDeclarations.length > 1) {
      throw new Error(
        `签名文件包含多个 Arguments type alias，请在插件 manifest 的工具上声明 SignatureType：${sourceFile.fileName}`,
      );
    }

    return undefined;
  }

  private createNode(options: {
    name: string;
    path: string;
    depth: number;
    required: boolean;
    typeNode: ts.TypeNode;
    typeText: string;
    comment: string;
    xmlHint: string;
    sourceFile: ts.SourceFile;
  }): ContractProjectionNode {
    const shape = this.resolveShape(options.typeNode);

    return shape.kind === "object"
      ? {
          name: options.name,
          displayName: options.name,
          path: options.path,
          depth: options.depth,
          kind: "object",
          typeText: options.typeText,
          required: options.required,
          comment: options.comment,
          xmlHint: options.xmlHint,
          children: this.readProperties(options.typeNode, options.sourceFile, options.path, options.depth),
          elements: [],
        }
      : shape.kind === "array"
        ? {
            name: options.name,
            displayName: options.name,
            path: options.path,
            depth: options.depth,
            kind: "array",
            typeText: options.typeText,
            required: options.required,
            comment: options.comment,
            xmlHint: options.xmlHint,
            children: [],
            element: this.createArrayElementNode(
              shape.elementType,
              options.sourceFile,
              options.path,
              options.depth + 1,
            ),
            elements: [],
          }
        : {
            name: options.name,
            displayName: options.name,
            path: options.path,
            depth: options.depth,
            kind: "scalar",
            typeText: options.typeText,
            required: options.required,
            comment: options.comment,
            xmlHint: options.xmlHint,
            children: [],
            elements: [],
          };
  }

  private createArrayElementNode(
    elementType: ts.TypeNode,
    sourceFile: ts.SourceFile,
    parentPath: string,
    depth: number,
  ): ContractProjectionNode {
    const shape = this.resolveShape(elementType);
    const elementPath = joinPath(parentPath, this.options.arrayItemName);

    return shape.kind === "object"
      ? {
          name: this.options.arrayItemName,
          displayName: "element",
          path: elementPath,
          depth,
          kind: "object",
          typeText: elementType.getText(sourceFile).trim(),
          required: true,
          comment: "",
          xmlHint: "",
          children: this.readProperties(elementType, sourceFile, elementPath, depth),
          elements: [],
        }
      : shape.kind === "array"
        ? {
            name: this.options.arrayItemName,
            displayName: "element",
            path: elementPath,
            depth,
            kind: "array",
            typeText: elementType.getText(sourceFile).trim(),
            required: true,
            comment: "",
            xmlHint: "",
            children: [],
            element: this.createArrayElementNode(elementType, sourceFile, elementPath, depth + 1),
            elements: [],
          }
        : {
            name: this.options.arrayItemName,
            displayName: "element",
            path: elementPath,
            depth,
            kind: "scalar",
            typeText: normalizeArrayScalarTypeText(elementType.getText(sourceFile).trim()),
            required: true,
            comment: "",
            xmlHint: "",
            children: [],
            elements: [],
          };
  }

  private resolveShape(typeNode: ts.TypeNode): ResolvedTypeShape {
    return matchTypeNode(typeNode, {
      TypeLiteral: (node) => ({
        kind: "object",
        members: node.members,
      }),
      ArrayType: (node) => ({
        kind: "array",
        elementType: node.elementType,
      }),
      TypeReference: (node) => resolveTypeReferenceShape(node),
      ParenthesizedType: (node) => this.resolveShape(node.type),
      default: () => ({
        kind: "scalar",
      }),
    });
  }
}

function normalizeArrayScalarTypeText(typeText: string): string {
  return typeText.endsWith("[]") ? typeText.slice(0, -2).trim() : typeText;
}

function resolveTypeReferenceShape(node: ts.TypeReferenceNode): ResolvedTypeShape {
  const name = node.typeName.getText();
  const argument = node.typeArguments?.[0];

  return name === "Array" && argument
    ? {
        kind: "array",
        elementType: argument,
      }
    : {
        kind: "scalar",
      };
}

function matchTypeNode<TResult>(
  node: ts.TypeNode,
  handlers: {
    TypeLiteral: (node: ts.TypeLiteralNode) => TResult;
    ArrayType: (node: ts.ArrayTypeNode) => TResult;
    TypeReference: (node: ts.TypeReferenceNode) => TResult;
    ParenthesizedType: (node: ts.ParenthesizedTypeNode) => TResult;
    default: (node: ts.TypeNode) => TResult;
  },
): TResult {
  return ts.isTypeLiteralNode(node)
    ? handlers.TypeLiteral(node)
    : ts.isArrayTypeNode(node)
      ? handlers.ArrayType(node)
      : ts.isTypeReferenceNode(node)
        ? handlers.TypeReference(node)
        : ts.isParenthesizedTypeNode(node)
          ? handlers.ParenthesizedType(node)
          : handlers.default(node);
}

function readPropertyName(name: ts.PropertyName): string | undefined {
  return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : undefined;
}

function readNodeComment(node: ts.Node, sourceFile: ts.SourceFile): string | undefined {
  const ranges = ts.getLeadingCommentRanges(sourceFile.text, node.pos) ?? [];
  const lines = ranges.flatMap((range) => readCommentRangeLines(sourceFile.text, range));
  const commentText = lines
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ");

  return commentText.length > 0 ? commentText : undefined;
}

function readCommentRangeLines(sourceText: string, range: ts.CommentRange): string[] {
  const content = sourceText.slice(range.pos, range.end);
  return range.kind === ts.SyntaxKind.SingleLineCommentTrivia ? [content.slice(2)] : readBlockCommentLines(content);
}

function readBlockCommentLines(comment: string): string[] {
  const body = comment.slice(2, Math.max(2, comment.length - 2));
  return body.split(/\r?\n/).map(normalizeBlockCommentLine);
}

function normalizeBlockCommentLine(line: string): string {
  const trimmedStart = line.trimStart();
  return trimmedStart.startsWith("*") ? trimmedStart.slice(1).trimStart() : trimmedStart;
}

function extractXmlHint(comment: string | undefined): string | undefined {
  if (!comment) {
    return undefined;
  }

  const [, content] = partitionComment(comment, "XML 写法：");
  if (!content) {
    return undefined;
  }

  const sentence = content.split("。", 1)[0]?.trim() ?? "";
  return sentence.length > 0 ? sentence : undefined;
}

function partitionComment(text: string, marker: string): [before: string, after?: string] {
  const segments = text.split(marker, 2);
  return segments.length === 2 ? [segments[0] ?? "", segments[1]?.trim()] : [text];
}

function joinPath(parentPath: string, name: string): string {
  return `${parentPath}.${name}`;
}
