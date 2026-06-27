import fs from "node:fs";
import ts from "typescript";
import { createGenerator } from "ts-json-schema-generator/dist/factory/generator.js";
import { AgentXmlCodec } from "./AgentXmlCodec.js";
import { createXmlProtocolSpec } from "./AgentXmlPolicy.js";

export interface AgentPromptContractProperty {
  name: string;
  displayName: string;
  path: string;
  depth: number;
  kind: "scalar" | "object" | "array";
  typeText: string;
  required: boolean;
  comment: string;
  xmlHint: string;
  children: AgentPromptContractProperty[];
  element?: AgentPromptContractProperty;
  elements: AgentPromptContractProperty[];
}

export interface AgentPromptContractView {
  tsHintLines: string[];
  xmlPreview: string;
  properties: AgentPromptContractProperty[];
  jsonSchema: Record<string, unknown>;
}

interface ContractProjectionNode {
  name: string;
  displayName: string;
  path: string;
  depth: number;
  kind: "scalar" | "object" | "array";
  typeText: string;
  required: boolean;
  comment: string;
  xmlHint: string;
  children: ContractProjectionNode[];
  element?: ContractProjectionNode;
  elements: ContractProjectionNode[];
}

type ResolvedTypeShape =
  | {
      kind: "object";
      members: ts.NodeArray<ts.TypeElement>;
    }
  | {
      kind: "array";
      elementType: ts.TypeNode;
    }
  | {
      kind: "scalar";
    };

export class AgentPromptContractProjector {
  private readonly protocol = createXmlProtocolSpec();
  private readonly xmlCodec = new AgentXmlCodec(this.protocol);
  private readonly arrayItemName = this.protocol.items.arrayItem;

  projectFromFile(
    signatureFile: string | undefined,
    rootName: string,
    typeName?: string,
  ): AgentPromptContractView | undefined {
    if (!signatureFile) {
      return undefined;
    }

    const sourceText = fs.readFileSync(signatureFile, "utf8");
    return this.projectFromSource(sourceText, signatureFile, rootName, typeName);
  }

  projectFromSource(
    sourceText: string,
    sourceFilePath: string,
    rootName: string,
    typeName?: string,
  ): AgentPromptContractView {
    const sourceFile = ts.createSourceFile(
      sourceFilePath,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const rootDeclaration = this.readRootTypeDeclaration(sourceFile, typeName);
    const properties = this.readProperties(rootDeclaration.type, sourceFile, rootName, 0);

    return {
      tsHintLines: this.renderTsHintLines(rootName, properties),
      xmlPreview: this.renderXmlPreview(rootName, properties),
      properties: properties.map((property) => this.toPromptProperty(property)),
      jsonSchema: this.createJsonSchema(sourceFilePath, rootDeclaration.name.text),
    };
  }

  private readRootTypeDeclaration(sourceFile: ts.SourceFile, typeName?: string): ts.TypeAliasDeclaration {
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

  private selectDefaultTypeDeclaration(
    declarations: readonly ts.TypeAliasDeclaration[],
    sourceFile: ts.SourceFile,
  ): ts.TypeAliasDeclaration | undefined {
    if (declarations.length === 1) {
      return declarations[0];
    }

    const argumentDeclarations = declarations.filter((declaration) =>
      declaration.name.text.endsWith("Arguments"));
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

  private readProperties(
    typeNode: ts.TypeNode,
    sourceFile: ts.SourceFile,
    parentPath: string,
    depth: number,
  ): ContractProjectionNode[] {
    const shape = this.resolveShape(typeNode);
    if (shape.kind !== "object") {
      return [];
    }

    return shape.members
      .filter(ts.isPropertySignature)
      .flatMap((member) => {
        const name = this.readPropertyName(member.name);
        const type = member.type;
        if (!name || !type) {
          return [];
        }

        const comment = this.readNodeComment(member, sourceFile) ?? "";
        const xmlHint = this.extractXmlHint(comment) ?? "";
        const propertyPath = this.joinPath(parentPath, name);
        return [this.createNode({
          name,
          path: propertyPath,
          depth: depth + 1,
          required: !member.questionToken,
          typeNode: type,
          typeText: type.getText(sourceFile).trim(),
          comment,
          xmlHint,
          sourceFile,
        })];
      });
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
          children: this.readProperties(
            options.typeNode,
            options.sourceFile,
            options.path,
            options.depth,
          ),
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
    const elementPath = this.joinPath(parentPath, this.arrayItemName);

    return shape.kind === "object"
      ? {
          name: this.arrayItemName,
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
            name: this.arrayItemName,
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
            name: this.arrayItemName,
            displayName: "element",
            path: elementPath,
            depth,
            kind: "scalar",
            typeText: this.normalizeArrayScalarTypeText(elementType.getText(sourceFile).trim()),
            required: true,
            comment: "",
            xmlHint: "",
            children: [],
            elements: [],
          };
  }

  private normalizeArrayScalarTypeText(typeText: string): string {
    return typeText.endsWith("[]") ? typeText.slice(0, -2).trim() : typeText;
  }

  private resolveShape(typeNode: ts.TypeNode): ResolvedTypeShape {
    return this.matchTypeNode(typeNode, {
      TypeLiteral: (node) => ({
        kind: "object",
        members: node.members,
      }),
      ArrayType: (node) => ({
        kind: "array",
        elementType: node.elementType,
      }),
      TypeReference: (node) => this.resolveTypeReferenceShape(node),
      ParenthesizedType: (node) => this.resolveShape(node.type),
      default: () => ({
        kind: "scalar",
      }),
    });
  }

  private resolveTypeReferenceShape(node: ts.TypeReferenceNode): ResolvedTypeShape {
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

  private matchTypeNode<TResult>(
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

  private readPropertyName(name: ts.PropertyName): string | undefined {
    return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : undefined;
  }

  private readNodeComment(node: ts.Node, sourceFile: ts.SourceFile): string | undefined {
    const ranges = ts.getLeadingCommentRanges(sourceFile.text, node.pos) ?? [];
    const lines = ranges.flatMap((range) =>
      this.readCommentRangeLines(sourceFile.text, range),
    );
    const commentText = lines
      .map((line) => line.trim())
      .filter(Boolean)
      .join(" ");

    return commentText.length > 0 ? commentText : undefined;
  }

  private readCommentRangeLines(
    sourceText: string,
    range: ts.CommentRange,
  ): string[] {
    const content = sourceText.slice(range.pos, range.end);
    return range.kind === ts.SyntaxKind.SingleLineCommentTrivia
      ? [content.slice(2)]
      : this.readBlockCommentLines(content);
  }

  private readBlockCommentLines(comment: string): string[] {
    const body = comment.slice(2, Math.max(2, comment.length - 2));
    return body
      .split(/\r?\n/)
      .map((line) => this.normalizeBlockCommentLine(line));
  }

  private normalizeBlockCommentLine(line: string): string {
    const trimmedStart = line.trimStart();
    return trimmedStart.startsWith("*")
      ? trimmedStart.slice(1).trimStart()
      : trimmedStart;
  }

  private extractXmlHint(comment: string | undefined): string | undefined {
    if (!comment) {
      return undefined;
    }

    const [, content] = this.partitionComment(comment, "XML 写法：");
    if (!content) {
      return undefined;
    }

    const sentence = content.split("。", 1)[0]?.trim() ?? "";
    return sentence.length > 0 ? sentence : undefined;
  }

  private partitionComment(
    text: string,
    marker: string,
  ): [before: string, after?: string] {
    const segments = text.split(marker, 2);
    return segments.length === 2
      ? [segments[0] ?? "", segments[1]?.trim()]
      : [text];
  }

  private renderTsHintLines(rootName: string, properties: ContractProjectionNode[]): string[] {
    return [
      `${rootName}: {`,
      ...properties.flatMap((property) => this.renderTsHintProperty(property, 1)),
      "}",
    ];
  }

  private renderTsHintProperty(property: ContractProjectionNode, depth: number): string[] {
    const indent = "  ".repeat(depth);
    const suffix = property.required ? "" : "?";

    return property.kind === "scalar"
      ? [`${indent}${property.name}${suffix}: ${property.typeText}`]
      : property.kind === "object"
        ? [
            `${indent}${property.name}${suffix}: {`,
            ...property.children.flatMap((child) => this.renderTsHintProperty(child, depth + 1)),
            `${indent}}`,
          ]
        : [
            `${indent}${property.name}${suffix}: [`,
            ...(property.element ? this.renderTsHintArrayElement(property.element, depth + 1) : []),
            `${indent}]`,
          ];
  }

  private renderTsHintArrayElement(property: ContractProjectionNode, depth: number): string[] {
    const indent = "  ".repeat(depth);

    return property.kind === "scalar"
      ? [`${indent}${property.typeText}`]
      : property.kind === "object"
        ? [
            `${indent}{`,
            ...property.children.flatMap((child) => this.renderTsHintProperty(child, depth + 1)),
            `${indent}}`,
          ]
        : [
            `${indent}[`,
            ...(property.element ? this.renderTsHintArrayElement(property.element, depth + 1) : []),
            `${indent}]`,
          ];
  }

  private renderXmlPreview(rootName: string, properties: ContractProjectionNode[]): string {
    const objectValue = Object.fromEntries(
      properties.map((property) => [property.name, this.renderXmlPreviewValue(property)]),
    );
    return this.xmlCodec.objectToXml(rootName, objectValue);
  }

  private renderXmlPreviewValue(property: ContractProjectionNode): unknown {
    return property.kind === "scalar"
      ? this.renderLeafPreviewValue(property)
      : property.kind === "object"
        ? Object.fromEntries(
            property.children.map((child) => [child.name, this.renderXmlPreviewValue(child)]),
          )
        : [property.element ? this.renderXmlArrayElementValue(property.element) : this.arrayItemName];
  }

  private renderXmlArrayElementValue(property: ContractProjectionNode): unknown {
    return property.kind === "scalar"
      ? this.renderLeafPreviewValue(property)
      : property.kind === "object"
        ? Object.fromEntries(
            property.children.map((child) => [child.name, this.renderXmlPreviewValue(child)]),
          )
        : [property.element ? this.renderXmlArrayElementValue(property.element) : this.arrayItemName];
  }

  private renderLeafPreviewValue(property: ContractProjectionNode): string {
    return property.xmlHint || this.sampleScalar(property.typeText) || property.name;
  }

  private sampleScalar(typeText: string): string | undefined {
    const normalized = typeText.trim();
    return ({
      string: "text",
      number: "0",
      boolean: "false",
    } as const)[normalized];
  }

  private toPromptProperty(property: ContractProjectionNode): AgentPromptContractProperty {
    return {
      name: property.name,
      displayName: property.displayName,
      path: property.path,
      depth: property.depth,
      kind: property.kind,
      typeText: property.typeText,
      required: property.required,
      comment: property.comment,
      xmlHint: property.xmlHint,
      children: property.children.map((child) => this.toPromptProperty(child)),
      element: property.element ? this.toPromptProperty(property.element) : undefined,
      elements: property.element ? [this.toPromptProperty(property.element)] : [],
    };
  }

  private joinPath(parentPath: string, name: string): string {
    return `${parentPath}.${name}`;
  }

  private createJsonSchema(sourceFilePath: string, typeName: string): Record<string, unknown> {
    try {
      return createGenerator({
        path: sourceFilePath,
        type: typeName,
        skipTypeCheck: true,
        expose: "none",
        topRef: false,
        jsDoc: "extended",
        additionalProperties: false,
        functions: "hide",
      }).createSchema(typeName) as Record<string, unknown>;
    } catch (error) {
      throw new Error(
        [
          `ToolSignature JSON Schema 生成失败：${sourceFilePath}`,
          `type: ${typeName}`,
          `cause: ${formatContractProjectionError(error)}`,
        ].join("\n"),
        { cause: error },
      );
    }
  }
}

function formatContractProjectionError(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }

  const cause = error.cause instanceof Error
    ? `; ${error.cause.name}: ${error.cause.message}`
    : "";
  return `${error.name}: ${error.message}${cause}`;
}
